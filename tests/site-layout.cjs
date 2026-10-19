const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseURL = new URL(process.env.SITE_TEST_URL || "http://127.0.0.1:8766");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(baseURL.hostname), "Use a local preview, not production.");
const output = process.env.SITE_SCREENSHOT_DIR || path.join(os.tmpdir(), "magazadanal-web-layout");
const themeKey = "magazadanal.web.theme.v1";

async function verify() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    headless: true,
  });
  let checked = 0;
  try {
    for (const width of [320, 390, 768, 1280]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.route("**/*.supabase.co/**", route => {
          if (new URL(route.request().url()).pathname === "/rest/v1/rpc/get_public_runtime_status"
              && route.request().method() === "POST") {
            return route.fulfill({ status: 200, contentType: "application/json",
              body: JSON.stringify([{ customer_web_account_enabled: true }]) });
          }
          errors.push("Unexpected backend request during visual tests.");
          return route.abort();
        });
        await page.addInitScript(({ key, theme }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, theme);
        }, { key: themeKey, theme });
        const response = await page.goto(baseURL.href);
        assert.equal(response.status(), 200);
        await page.locator(".theme-toggle").waitFor();
        await page.locator(".home-brand-grid img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
        assert.equal(await page.locator(".home-brand-grid img").count(), 30);
        assert.equal(await page.locator("#home-account-link").count(), 1);
        assert.equal(await page.locator("header #home-account-link").count(), 1);
        assert.equal(await page.getByText("Seçili mağazalardan ve birçok markadan alışveriş yap.", { exact: true }).count(), 0);
        assert.equal(await page.locator(".home-brand-grid img[alt='Gap']").getAttribute("src"), "/assets/brands/logo_gap.svg");
        const logos = await page.locator(".home-brand-grid img").evaluateAll(images => images.map(image => ({
          alt: image.alt, loaded: image.complete && image.naturalWidth > 0,
          background: getComputedStyle(image.parentElement).backgroundColor,
          filter: getComputedStyle(image).filter,
        })));
        assert.ok(logos.every(logo => logo.loaded && logo.background === "rgb(255, 255, 255)" && logo.filter === "none"));
        assert.equal(new Set(logos.map(logo => logo.alt)).size, 30);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Home overflow at ${width}.`);
        const brand = await page.locator("header .brand").boundingBox();
        const account = await page.locator("#home-account-link").boundingBox();
        const toggle = await page.locator(".theme-toggle").boundingBox();
        assert.ok(account.x >= brand.x + brand.width && toggle.x >= account.x + account.width);
        assert.ok(toggle.x + toggle.width <= width && Math.abs(account.y - toggle.y) < 5);
        await page.screenshot({ path: path.join(output, `home-${width}-${theme}.png`), fullPage: true });
        if (width === 1280) {
          await page.locator(".home-brand-grid").screenshot({ path: path.join(output, `brands-${theme}.png`) });
        }
        const nextTheme = theme === "dark" ? "light" : "dark";
        await page.locator(".theme-toggle").click();
        assert.equal(await page.locator("html").getAttribute("data-theme"), nextTheme);
        await page.reload();
        assert.equal(await page.locator("html").getAttribute("data-theme"), nextTheme);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), themeKey), nextTheme);

        await page.locator("#home-account-link").click();
        await page.locator("#login-email").waitFor();
        assert.equal(new URL(page.url()).pathname, "/hesabim/");
        assert.equal(await page.getByText("Müşteri hesabı", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("heading", { name: "Hesabına giriş yap", exact: true }).count(), 0);
        assert.equal(await page.locator("#auth-view").getAttribute("aria-label"), "Giriş formu");
        await page.locator("#login-password").fill("local-layout-test");
        await page.locator("#show-login-password").check();
        assert.equal(await page.locator("#login-password").getAttribute("type"), "text");
        await page.locator("#show-login-password").uncheck();
        assert.equal(await page.locator("#login-password").getAttribute("type"), "password");
        await page.locator("#login-password").fill("");
        await page.screenshot({ path: path.join(output, `login-${width}-${nextTheme}.png`), fullPage: true });
        await page.locator("#login-button").click();
        assert.ok(await page.locator("#auth-status").isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Login overflow at ${width}.`);
        assert.deepEqual(errors, [], `Browser errors at ${width}/${theme}.`);
        await context.close();
        checked++;
      }
    }
    console.log(`PASS: ${checked} viewport/theme combinations; 30 logos, header layout, theme persistence and login controls. Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });

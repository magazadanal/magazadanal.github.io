const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseURL = new URL(process.env.SITE_TEST_URL || "http://127.0.0.1:8766");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(baseURL.hostname), "Local preview only.");
const output = process.env.SITE_SCREENSHOT_DIR || path.join(os.tmpdir(), "magazadanal-not-found");

async function verify() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  let checked = 0;
  try {
    const context = await browser.newContext();
    for (const pathname of ["/missing-page/", "/missing/nested/page", "/supabase/config.toml", "/.env", "/.git/HEAD", "/tests/not-found.test.cjs", "/bad%ZZ"]) {
      const response = await context.request.get(new URL(pathname, baseURL).href);
      assert.equal(response.status(), 404, pathname);
      assert.match(await response.text(), /<h1>Sayfa bulunamadı<\/h1>/);
      assert.equal(response.headers()["x-frame-options"], "DENY");
      assert.equal(response.headers()["cache-control"], "no-store");
      assert.match(response.headers()["content-security-policy"], /frame-ancestors 'none'/);
      const head = await context.request.head(new URL(pathname, baseURL).href);
      assert.equal(head.status(), 404);
      assert.equal((await head.body()).length, 0);
      checked++;
    }
    assert.equal((await context.request.post(new URL("/missing/", baseURL).href)).status(), 405);
    for (const pathname of ["/", "/hesabim/", "/privacy/", "/assets/not-found.css", "/theme.js"]) {
      assert.equal((await context.request.get(new URL(pathname, baseURL).href)).status(), 200, pathname);
    }
    await context.close();
    for (const width of [320, 390, 1280]) {
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
        const page = await ctx.newPage();
        const failures = [];
        page.on("pageerror", error => failures.push(error.message));
        page.on("request", request => {
          if (new URL(request.url()).origin !== baseURL.origin) failures.push("Unexpected external request");
        });
        await page.addInitScript(() => {
          localStorage.setItem("ma-synthetic-session", "keep-this-session");
          sessionStorage.setItem("ma-synthetic-draft", "keep-this-draft");
        });
        const response = await page.goto(new URL("/missing/nested/?next=https://example.invalid/&text=%3Cscript%3E", baseURL).href);
        assert.equal(response.status(), 404);
        await page.locator(".theme-toggle").waitFor();
        await page.locator(".brand-logo").evaluate(image => image.decode());
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        assert.equal(await page.locator("h1").innerText(), "Sayfa bulunamadı");
        assert.equal(await page.getByText("example.invalid", { exact: false }).count(), 0);
        assert.deepEqual(await page.evaluate(() => [localStorage.getItem("ma-synthetic-session"), sessionStorage.getItem("ma-synthetic-draft")]), ["keep-this-session", "keep-this-draft"]);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${width}/${theme}`);
        const heading = await page.locator("h1").boundingBox();
        const actions = await page.locator(".not-found-actions").boundingBox();
        assert.ok(actions.y > heading.y + heading.height);
        assert.deepEqual(failures, []);
        await page.screenshot({ path: path.join(output, `not-found-${width}-${theme}.png`), fullPage: true });
        await page.getByRole("link", { name: "Ana sayfa", exact: true }).click();
        assert.equal(new URL(page.url()).pathname, "/");
        await ctx.close();
        checked++;
      }
    }
    console.log(`PASS: ${checked} missing-path/layout scenarios; HTTP 404, HEAD, safe assets, unchanged storage and valid-page recovery.`);
  } finally { await browser.close(); }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });

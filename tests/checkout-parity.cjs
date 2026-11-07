const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8767";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-parity-20261107";
const owner = "10000000-0000-4000-8000-000000000001";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const [width, theme] of [[1280, "light"], [1280, "dark"], [390, "light"], [320, "dark"]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [], calls = [];
      page.setDefaultTimeout(12000);
      page.on("pageerror", e => errors.push(e.message));
      await page.addInitScript(({ owner, theme }) => {
        localStorage.setItem("magazadanal.web.theme.v1", theme);
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "https://example.invalid/product", writeText: async () => {} } });
      }, { owner, theme });
      await page.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === base) return route.continue();
        calls.push({ path: url.pathname, hostname: url.hostname, body: req.postDataJSON() });
        if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co");
        let data;
        if (url.pathname.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/functions/v1/web-store-search") {
          assert.equal(req.postDataJSON().store, "Beymen");
          assert.equal(req.postDataJSON().query, "Beymen");
          data = { results: [{ name: "Beymen Test Şube", latitude: 41.07, longitude: 28.99 }] };
        }
        else if (url.pathname === "/rest/v1/profiles") {
          await new Promise(resolve => setTimeout(resolve, 250));
          data = [{ id: owner, full_name: "Test Multiple Surname", phone: "+447700900123", role: "customer", is_active: true }];
        } else if (url.pathname === "/rest/v1/customer_billing_profiles") data = [{ invoice_type: "individual", company_name: "Preserved Company", billing_address: "Preserved address" }];
        else if (url.pathname === "/rest/v1/customer_profile_photos") data = [];
        else if (["/rest/v1/orders", "/rest/v1/customer_addresses", "/rest/v1/rpc/list_order_activity", "/rest/v1/rpc/list_support_tickets_v3"].includes(url.pathname)) data = [];
        else throw Error(`Unexpected request/write: ${url.pathname}`);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      });
      await page.goto(base + "/hesabim/", { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator("#auth-view").isVisible(), false, "Restoring a valid session never flashes the login form");
      await page.locator("#portal-view").waitFor();
      assert.equal(await page.locator('#welcome-title, .portal-toolbar').count(), 0);
      assert.ok(await page.locator('[data-panel="shop"]').isVisible());
      assert.equal(calls.filter(c => c.path === "/auth/v1/token").length, 0, "Valid access tokens are not needlessly rotated");
      assert.equal(await page.locator("#last-updated").count(), 0);
      assert.equal(await page.locator("#logout-button").isVisible(), false);
      await page.locator('[data-view="home"]').click();
      await page.locator("#view-home > *").first().waitFor();
      assert.ok(await page.locator(".portal-tabs").isVisible());
      assert.equal(await page.getByText("Hesabıma git", { exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, `signed-home-${width}-${theme}.png`), fullPage: true });
      await page.locator('[data-view="orders"]').click();
      assert.equal(await page.locator(".tracking-placeholder .order-timeline li").count(), 4);
      assert.equal(await page.locator(".tracking-placeholder .is-complete").count(), 0);
      assert.ok(await page.getByText("Aktif sipariş yok", { exact: true }).isVisible());
      await page.screenshot({ path: path.join(output, `empty-tracking-${width}-${theme}.png`), fullPage: true });
      await page.locator('[data-view="profile"]').click();
      assert.equal(await page.locator("#profile-name").textContent(), "Test");
      assert.equal(await page.locator("#profile-surname").textContent(), "Multiple Surname");
      assert.ok(await page.locator("#logout-button").isVisible());
      assert.equal(await page.locator("#view-profile").getByText("Hesap", { exact: true }).count(), 0);
      await page.locator("#profile-edit").click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.locator('[name="profile_first_name"]').inputValue(), "Test");
      assert.equal(await dialog.locator('[name="profile_last_name"]').inputValue(), "Multiple Surname");
      assert.equal(await dialog.locator('[name="profile_phone_country"]').inputValue(), "+44");
      assert.equal(await dialog.locator('[name="profile_phone_number"]').inputValue(), "7700900123");
      const corporate = ["company_name", "tax_office", "tax_number", "billing_address", "postal_code"];
      for (const name of corporate) assert.equal(await dialog.locator(`[name="${name}"]`).isVisible(), false);
      await page.screenshot({ path: path.join(output, `profile-individual-${width}-${theme}.png`), fullPage: true });
      await dialog.locator('[name="invoice_type"]').selectOption("corporate");
      for (const name of corporate) assert.ok(await dialog.locator(`[name="${name}"]`).isVisible());
      assert.equal(await dialog.locator('[name="company_name"]').inputValue(), "Preserved Company");
      await dialog.locator('[name="invoice_type"]').selectOption("individual");
      await page.keyboard.press("Escape");
      await page.locator('[data-view="shop"]').click();
      await page.getByRole("button", { name: "Beymen", exact: true }).click();
      await page.locator('[name="product_link"]').waitFor();
      assert.equal(await page.locator('.product-photo-preview img').count(), 0);
      assert.ok(await page.locator('.product-photo-frame').isHidden());
      assert.ok(await page.locator('[name="branch"]').isVisible());
      assert.equal(await page.locator('details').filter({hasText:'Bu şubeden al'}).count(), 0);
      await page.getByRole("button", { name: "Yapıştır", exact: true }).click();
      assert.equal(await page.locator('[name="product_link"]').inputValue(), "https://example.invalid/product");
      await page.locator('[name="product_photo"]').setInputFiles(path.join(__dirname, "../assets/magazadanal-logo.png"));
      await page.locator('.product-photo-preview img[src^="data:image/jpeg"]').waitFor();
      const photo = await page.locator(".product-photo-preview").boundingBox();
      assert.ok(photo.width >= 200 && photo.height >= 200);
      assert.equal(await page.getByText("Fotoğrafı kaldır", { exact: true }).count(), 0);
      const back = page.getByRole("button", { name: "Geri", exact: true });
      if (width >= 900) {
        const menu = await page.locator(".portal-tabs").boundingBox(), b = await back.boundingBox();
        assert.ok(b.x >= menu.x + menu.width);
        await page.evaluate(() => scrollTo(0, 450));
        assert.ok(Math.abs((await back.boundingBox()).y - b.y) < 1);
      }
      await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
      assert.ok(await page.locator("#order-status").isVisible());
      assert.ok(await page.locator("#order-status").evaluate(n => n.compareDocumentPosition(document.querySelector('[data-panel="shop"]')) & Node.DOCUMENT_POSITION_PRECEDING));
      await page.getByText("Bu şubeden al", { exact: true }).click();
      await page.getByRole("button", { name: "Mağaza konumu seç", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Haritayı aç", exact: true }).count(), 0);
      assert.ok(await page.locator('.app-map').isVisible());
      assert.equal(await page.locator('[name="map_search"]').inputValue(), "Beymen");
      await page.getByRole("button", { name: "Beymen Test Şube", exact: true }).click();
      await page.getByRole("button", { name: "Bu konumu kullan", exact: true }).click();
      await page.getByRole("button", { name: "Fotoğrafı kaldır", exact: true }).click();
      assert.equal(await page.locator('.product-photo-preview img[src^="data:image/jpeg"]').count(), 0);
      assert.ok(await page.locator('.product-photo-frame').isHidden());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(base + "/");
      assert.ok(await page.locator("#home-sidebar").isVisible());
      assert.equal(await page.locator("#home-account-link").isVisible(), false);
      await page.locator('#home-sidebar [href="/hesabim/?view=shop"]').click();
      await page.locator("#portal-view").waitFor();
      assert.equal(await page.locator("#auth-view").isVisible(), false);
      assert.equal(calls.filter(c => c.path === "/auth/v1/token").length, 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("PASS: four viewport/theme cases: session restore without login flash/token rotation, homepage sidebar, empty timeline, profile/phone/billing, paste, photo remove, fixed back, bottom errors, brand map search. External APIs fully mocked.");
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-ui-20261106";
const owner = "10000000-0000-4000-8000-000000000001";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const [width, theme] of [[1280, "light"], [1280, "dark"], [390, "light"], [320, "dark"], [768, "light"]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
      await page.addInitScript(theme => localStorage.setItem("magazadanal.web.theme.v1", theme), theme);
      await page.route("**/*", async route => {
        const url = new URL(route.request().url()); if (url.origin === base) return route.continue();
        if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co"); let data;
        if (url.pathname.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/functions/v1/web-store-search") data = { results: [] };
        else if (url.pathname === "/auth/v1/token") data = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: owner, email: "test@example.invalid" } };
        else if (url.pathname === "/rest/v1/profiles") data = [{ id: owner, full_name: "Test Müşteri", phone: "+905301234567", role: "customer", is_active: true }];
        else if (["/rest/v1/customer_addresses", "/rest/v1/orders", "/rest/v1/rpc/list_order_activity", "/rest/v1/rpc/list_support_tickets_v3"].includes(url.pathname)) data = [];
        else throw Error(`Unexpected backend write/request: ${url.pathname}`);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      async function shot(name) {
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); window.scrollTo(0, 0); });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(output, `${name}-${width}-${theme}.png`), fullPage: true });
      }
      await page.goto(base + "/");
      assert.equal(await page.getByRole("link", { name: "Sipariş ver", exact: true }).count(), 0);
      assert.equal(await page.getByText("Ücretler ve alışveriş koşulları", { exact: true }).count(), 0);
      await shot("home");
      await page.locator("#home-account-link").click();
      await page.locator("#login-button:not(:disabled)").waitFor();
      assert.equal(await page.getByText("Ücretler ve alışveriş koşulları", { exact: true }).count(), 0);
      await shot("login");
      await page.locator("#login-email").fill("test@example.invalid"); await page.locator("#login-password").fill("mock-password"); await page.locator("#login-button").click();
      await page.locator("#portal-view").waitFor(); await page.locator('[data-view="shop"]').click();
      await page.getByRole("button", { name: "Beymen", exact: true }).waitFor();
      const grid = await page.locator(".store-grid").boundingBox();
      const custom = await page.getByRole("button", { name: "Farklı mağaza girişi", exact: true }).boundingBox();
      const multi = await page.getByRole("button", { name: "Çoklu mağaza seç", exact: true }).boundingBox();
      assert.ok(custom.y + custom.height <= grid.y); assert.ok(multi.y >= grid.y + grid.height);
      if (width >= 900) {
        const nav = await page.locator(".portal-tabs").boundingBox(), content = await page.locator(".portal-content").boundingBox();
        assert.ok(nav.x + nav.width < content.x, "Desktop navigation is a left sidebar");
        const tabs = await page.locator(".portal-tab").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().y));
        assert.ok(tabs.every((y, i) => i === 0 || y > tabs[i - 1]), "Navigation items are vertically stacked");
      }
      await shot("stores");
      await page.getByRole("button", { name: "Beymen", exact: true }).click();
      assert.equal(await page.locator('[name="product_name"], [name="alternative_size"], [name="alternative_color"]').count(), 0);
      assert.equal(await page.getByRole("button", { name: "Mağazalar", exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Ürün bağlantısı", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Ürün linki", { exact: true }).count(), 1);
      assert.equal(await page.getByLabel("Sipariş notu", { exact: true }).count(), 1);
      assert.ok(await page.locator('[name="product_link"]').evaluate(n => n.parentElement.nextElementSibling.matches("section.store-pickup") && n.parentElement.nextElementSibling.querySelector("h3").textContent === "Bu şubeden al"));
      assert.ok(await page.locator('[name="estimated_price"]').evaluate(n => n.parentElement.nextElementSibling.querySelector('[name="order_note"]') !== null));
      async function fillProduct(note) {
        await page.locator('[name="product_link"]').fill("https://example.com/product");
        await page.locator('[name="size"]').fill("M"); await page.locator('[name="color"]').fill("Siyah");
        await page.locator('[name="estimated_price"]').fill("100"); await page.locator('[name="order_note"]').fill(note);
        await page.getByText("Bu şubeden al", { exact: true }).click();
        await page.locator('[name="branch"]').fill("Test Şube");
        await page.getByRole("button", { name: "Mağaza konumu seç", exact: true }).click();
        assert.ok(await page.locator('.app-map').isVisible());
        await page.locator(".app-map").click({ position: { x: 130, y: 160 } });
        await page.getByRole("button", { name: "Bu konumu kullan", exact: true }).click();
      }
      await fillProduct("WEB DÜZEN TESTİ"); await shot("product");
      await page.reload(); await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="shop"]').click();
      assert.equal(await page.locator('[name="order_note"]').inputValue(), "WEB DÜZEN TESTİ");
      assert.equal(await page.locator('[name="estimated_price"]').inputValue(), "100");
      await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
      assert.equal(await page.locator(".cart-item").count(), 1);
      assert.ok(await page.getByText("Ürün 1", { exact: true }).isVisible());
      if (width === 1280 && theme === "light") {
        await page.getByRole("button", { name: "Düzenle", exact: true }).click();
        await page.locator('[name="estimated_price"]').fill("110");
        await page.getByRole("button", { name: "Değişiklikleri kaydet", exact: true }).click();
        assert.equal(await page.locator(".cart-item").count(), 1);
        await page.getByRole("button", { name: "Başka ürün / mağaza ekle", exact: true }).click();
        await page.getByRole("button", { name: "Çoklu mağaza seç", exact: true }).click();
        await page.getByRole("button", { name: "Beymen", exact: true }).click();
        await page.getByRole("button", { name: "Ürünlere geç", exact: true }).click();
        assert.match(await page.locator("#order-status").textContent(), /en az iki/);
        await page.getByRole("button", { name: "Zara", exact: true }).click();
        await page.getByRole("button", { name: "Nike", exact: true }).click();
        assert.equal(await page.locator('.store-button[aria-pressed="true"]').count(), 3);
        await page.getByRole("button", { name: "Ürünlere geç", exact: true }).click();
        await fillProduct("ÇOKLU MAĞAZA TESTİ");
        await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
        await page.getByRole("heading", { name: "Nike", exact: true }).waitFor();
        assert.equal(await page.locator('[name="branch"]').inputValue(), "", "Next store cannot reuse the previous store's coordinates");
        await page.locator('[data-view="cart"]').click();
        await page.getByRole("button", { name: "Ödemeye geç", exact: true }).click();
        assert.match(await page.locator("#order-status").textContent(), /Nike/);
        await page.locator('[data-view="shop"]').click();
        await fillProduct("ÇOKLU MAĞAZA SON ÜRÜN");
        await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
        assert.equal(await page.locator(".cart-item").count(), 3);
        const stored = await page.evaluate(owner => JSON.parse(sessionStorage.getItem(`magazadanal.web.draft.v1.${owner}`)), owner);
        assert.equal(stored.draft.items[1].store, "Zara"); assert.equal(stored.draft.items[1].product_name, "Ürün 1");
        await page.getByRole("button", { name: "Başka ürün / mağaza ekle", exact: true }).click();
        await page.getByRole("button", { name: "Farklı mağaza girişi", exact: true }).click();
        await page.locator('[name="custom_store"]').fill("<script>");
        await page.getByRole("button", { name: "Bu mağazadan al", exact: true }).click();
        assert.match(await page.locator("#order-status").textContent(), /Geçerli bir mağaza/);
        await page.locator('[name="custom_store"]').fill("Yerel Mağaza");
        await page.getByRole("button", { name: "Bu mağazadan al", exact: true }).click();
        await fillProduct("FARKLI MAĞAZA TESTİ");
        await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
        assert.equal(await page.locator(".cart-item").count(), 4);
        assert.ok(await page.locator("#cart-flow").getByText("Yerel Mağaza", { exact: true }).isVisible());
      }
      assert.deepEqual(errors, []); await context.close();
    }
    console.log("PASS: five viewport/theme layouts, desktop sidebar, requested field order/removals, draft restore/edit, multi-store minimum and custom store flow. All backend requests mocked.");
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

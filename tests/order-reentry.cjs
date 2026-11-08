const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const R = require("../hesabim/order-rules.js");
const legal = require("../assets/legal-v8.json");
const catalog = require("../assets/order-catalog.json");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-order-reentry-20261107";
const owner = "10000000-0000-4000-8000-000000000001";
const orderID = "20000000-0000-4000-8000-000000000008";
const draftKey = `magazadanal.web.draft.v1.${owner}`;

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  let runs = 0;
  try {
    for (const width of [390, 1280]) for (const action of ["brand", "custom", "multi", "new-cart", "pending"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [], attempts = [];
      page.on("pageerror", error => errors.push(error.message));
      const draft = R.newDraft(); draft.express = true; draft.payment = "bank_transfer";
      draft.items = [{ client_item_id: crypto.randomUUID(), store: "Beymen", branch: "Test", product_name: "Test", size: "M", color: "Siyah", estimated_price: 100, product_link: "https://example.com", store_latitude: 41, store_longitude: 29 }];
      draft.address = { district: "Şişli", neighborhood: "Test", address_line: "Sokak", building_no: "1", building_name: "Bina", directions: "Kapı", customer_name: "Test", customer_phone: "+905301234567", latitude: 41, longitude: 29 };
      const payload = R.payload(draft, await R.documents(draft, legal, "test@example.invalid", catalog.stores));
      const result = R.result({ authorized: true, result: "success", order_id: orderID, amount: 460, transfer_code: "000008" }, 460);
      const stored = { owner, updated: 0, draft, frozen: { payload: action === "pending" ? payload : null, result: action === "pending" ? null : result, expectedAmount: 460 }, stage: "stores", checkout: true };
      await page.addInitScript(({ owner, draftKey, stored }) => {
        if (sessionStorage.getItem("test.seeded")) return;
        sessionStorage.setItem("test.seeded", "true");
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ refreshToken: "mock-refresh", accessToken: "mock-access", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
        sessionStorage.setItem(draftKey, JSON.stringify(stored));
      }, { owner, draftKey, stored });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) return route.continue();
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co", "No unmocked external request");
        let data;
        if (url.pathname.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/auth/v1/token") data = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: owner, email: "test@example.invalid" } };
        else if (url.pathname === "/rest/v1/profiles") data = [{ id: owner, full_name: "Test Müşteri", phone: "+905301234567", role: "customer", is_active: true }];
        else if (url.pathname === "/rest/v1/customer_addresses" || url.pathname === "/rest/v1/orders" || url.pathname.endsWith("list_order_activity") || url.pathname.endsWith("list_support_tickets_v3")) data = [];
        else if (url.pathname.endsWith("create_customer_order_v7")) { attempts.push(request.postDataJSON()); data = [result]; }
        else throw Error(`Unexpected request ${url.pathname}`);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      await page.goto(base + "/hesabim/?view=shop"); await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="cart"]').click();
      if (action !== "pending") await page.getByRole("heading", { name: "Sipariş talebi alındı", exact: true }).waitFor();
      await page.reload(); await page.locator("#portal-view").waitFor();
      if (action === "new-cart") {
        await page.locator('[data-view="cart"]').click();
        await page.getByRole("button", { name: "Yeni sepet", exact: true }).click();
        await page.getByText("Sepetin boş.", { exact: true }).waitFor();
      }
      await page.locator('[data-view="shop"]').click();
      if (action === "custom") {
        await page.getByRole("button", { name: "Farklı mağaza girişi", exact: true }).click();
        await page.locator('[name="custom_store"]').fill("Yeni Test Mağazası");
        await page.getByRole("button", { name: "Bu mağazadan al", exact: true }).click();
      } else if (action === "multi") {
        await page.getByRole("button", { name: "Çoklu mağaza seç", exact: true }).click();
        await page.getByRole("button", { name: "Beymen", exact: true }).click();
        await page.getByRole("button", { name: "Zara", exact: true }).click();
        await page.getByRole("button", { name: "Ürünlere geç", exact: true }).click();
      } else await page.getByRole("button", { name: "Beymen", exact: true }).click();
      assert.equal(attempts.length, 0, "Selecting stores must never create or retry an order");
      if (action === "pending") {
        assert.ok(await page.locator('[data-panel="cart"]').isVisible(), "Uncertain requests must show the recovery screen");
        await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).waitFor();
        const kept = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
        assert.equal(kept.draft.requestID, draft.requestID);
        assert.deepEqual(kept.frozen.payload, payload, "Uncertain request payload and identity are preserved");
        await page.reload(); await page.locator("#portal-view").waitFor();
        await page.locator('[data-view="cart"]').click();
        await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).click();
        await page.getByRole("heading", { name: "Sipariş talebi alındı", exact: true }).waitFor();
        assert.equal(attempts.length, 1); assert.deepEqual(attempts[0], payload);
        await page.locator('[data-view="shop"]').click();
        await page.getByRole("button", { name: "Beymen", exact: true }).click();
      }
      await page.locator('[name="size"]').waitFor({ timeout: 2000 });
      assert.equal(await page.locator('[name="size"]').inputValue(), "");
      const next = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
      assert.notEqual(next.draft.requestID, draft.requestID); assert.ok(R.UUID.test(next.draft.requestID));
      assert.equal(next.frozen, null); assert.equal(next.checkout, false);
      assert.deepEqual(next.draft.items, []); assert.deepEqual(next.draft.address, {});
      assert.equal(next.draft.express, null); assert.equal(next.draft.payment, null);
      assert.deepEqual(next.draft.buyer, { full_name: "Test Müşteri", phone: "+905301234567" });
      assert.equal(next.draft.editing.store, action === "custom" ? "Yeni Test Mağazası" : "Beymen");
      assert.deepEqual(next.draft.selectedStores, action === "multi" ? ["Beymen", "Zara"] : [next.draft.editing.store]);
      assert.equal(await page.locator("#order-status").innerText(), "");
      if (action === "brand") await page.screenshot({ path: path.join(output, `new-product-${width}.png`), fullPage: true });
      await page.locator('[name="size"]').fill("Yeni beden");
      await page.reload(); await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="shop"]').click();
      assert.equal(await page.locator('[name="size"]').inputValue(), "Yeni beden", "The new draft survives reload");
      const restored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
      assert.equal(restored.draft.requestID, next.draft.requestID);
      assert.equal(attempts.length, action === "pending" ? 1 : 0);
      assert.deepEqual(errors, []);
      await context.close(); runs++;
    }
    console.log(`PASS: ${runs} desktop/mobile confirmed-order reentries, custom/multi stores, new-draft reload and uncertain-request recovery.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

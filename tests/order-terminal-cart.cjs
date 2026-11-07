const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const R = require("../hesabim/order-rules.js");
const legal = require("../assets/legal-v6.json");
const catalog = require("../assets/order-catalog.json");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8768";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-terminal-cart-20261108";
const owner = "10000000-0000-4000-8000-000000000001";
const orderID = "20000000-0000-4000-8000-000000000009";
const draftKey = `magazadanal.web.draft.v1.${owner}`;
const scenarios = ["cancelled", "delivered", "live-cancel", "live-delivery", "active", "missing", "uncertain", "new-draft", "malformed", "unrelated", "offline"];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const results = [];
  try {
    for (const width of [390, 1280]) for (const scenario of scenarios) {
      console.log(`Checking ${width}px ${scenario}`);
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      context.setDefaultTimeout(7000);
      const page = await context.newPage(), errors = [], writes = [];
      page.on("pageerror", error => errors.push(error.message));
      const draft = R.newDraft(); draft.express = false; draft.payment = "bank_transfer";
      draft.items = [{ client_item_id: crypto.randomUUID(), store: "Beymen", branch: "Test", product_name: "Test", size: "M", color: "Siyah", estimated_price: 100, product_link: "https://example.com", store_latitude: 41, store_longitude: 29 }];
      draft.address = { district: "Şişli", neighborhood: "Test", address_line: "Sokak", building_no: "1", building_name: "Bina", directions: "Kapı", customer_name: "Test", customer_phone: "+905301234567", latitude: 41, longitude: 29 };
      const payload = R.payload(draft, await R.documents(draft, legal, "test@example.invalid", catalog.stores));
      const result = R.result({ authorized: true, result: "success", order_id: orderID, amount: 460, transfer_code: "000009" }, 460);
      const stored = {
        owner, updated: Date.now(), draft,
        frozen: scenario === "new-draft" ? null : {
          payload: scenario === "uncertain" ? payload : null,
          result: scenario === "uncertain" ? null : scenario === "malformed" ? { ...result, order_id: "not-an-order-id" } : result,
          expectedAmount: 460
        }, stage: "stores", checkout: scenario !== "new-draft"
      };
      let status = scenario.startsWith("live-") || ["active", "offline"].includes(scenario) ? "payment_waiting" : scenario === "delivered" ? "delivered" : "cancelled";
      let failOrders = false, orderReads = 0;
      await page.addInitScript(({ owner, draftKey, stored }) => {
        if (sessionStorage.getItem("test.seeded")) return;
        sessionStorage.setItem("test.seeded", "true");
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ refreshToken: "mock-refresh", accessToken: "mock-access", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
        sessionStorage.setItem(draftKey, JSON.stringify(stored));
      }, { owner, draftKey, stored });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) return route.continue();
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co", "All external API requests must be mocked");
        let data;
        if (url.pathname.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/auth/v1/token") data = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: owner, email: "test@example.invalid" } };
        else if (url.pathname === "/rest/v1/profiles") data = [{ id: owner, full_name: "Test Müşteri", phone: "+905301234567", role: "customer", is_active: true }];
        else if (url.pathname === "/rest/v1/orders") {
          orderReads++;
          if (failOrders) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
          data = scenario === "missing" ? [] : [{ id: scenario === "unrelated" ? "20000000-0000-4000-8000-000000000002" : orderID, order_no: "000009", status, payment_method: "bank_transfer", customer_total: 460, created_at: "2026-11-07T20:00:00Z", selected_store_count: 1, order_items: [] }];
        } else if (url.pathname === "/rest/v1/customer_addresses" || ["list_order_activity", "list_support_tickets_v3", "get_order_delivery_code", "get_order_courier_position"].some(name => url.pathname.endsWith(name))) data = [];
        else { writes.push(url.pathname); throw Error(`Unexpected mutation or request ${url.pathname}`); }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      await page.goto(base + "/hesabim/?view=cart");
      await page.locator("#portal-view").waitFor();
      await page.locator("#cart-flow h2").waitFor();
      if (scenario.startsWith("live-") || scenario === "offline") {
        await page.getByRole("heading", { name: "Sipariş talebi alındı", exact: true }).waitFor();
        const previousReads = orderReads;
        if (scenario === "offline") failOrders = true;
        else status = scenario === "live-cancel" ? "cancelled" : "delivered";
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await page.waitForFunction(() => document.querySelector("#portal-status")?.textContent?.includes("yenilenemedi") || document.querySelector("#cart-flow")?.textContent?.includes("Sepetin boş."), null, { timeout: 5000 });
        assert.ok(orderReads > previousReads, "Live state was fetched again");
      }
      const cleared = ["cancelled", "delivered", "live-cancel", "live-delivery"].includes(scenario);
      if (cleared) {
        await page.getByText("Sepetin boş.", { exact: true }).waitFor({ timeout: 2000 });
        assert.equal(await page.getByText("Ödeme henüz doğrulanmadı.", { exact: true }).count(), 0);
        assert.equal(await page.locator("#cart-flow .bank-details").count(), 0);
        const next = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
        assert.notEqual(next.draft.requestID, draft.requestID);
        assert.equal(next.frozen, null); assert.equal(next.checkout, false);
        assert.deepEqual(next.draft.items, []);
        if (scenario === "cancelled") await page.screenshot({ path: path.join(output, `cancelled-cart-${width}.png`), fullPage: true });
        await page.reload(); await page.locator("#portal-view").waitFor();
        await page.getByText("Sepetin boş.", { exact: true }).waitFor();
        const restored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
        assert.equal(restored.draft.requestID, next.draft.requestID, "Terminal cleanup is idempotent across reload");
        await page.locator('[data-view="profile"]').click();
        await page.locator("#profile-history").click();
        assert.ok(await page.locator(`[data-order-id="${orderID}"]`).isVisible(), "Order history is retained");
      } else {
        const kept = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);
        assert.equal(kept.draft.requestID, draft.requestID, "Unresolved or independent drafts retain their idempotency key");
        assert.deepEqual(kept.frozen, stored.frozen);
        if (scenario === "uncertain") await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).waitFor();
        if (scenario === "new-draft") assert.deepEqual(kept.draft.items, draft.items, "A separate unsubmitted cart is preserved");
      }
      assert.deepEqual(writes, [], "Cleanup must never create/retry/cancel an order or reserve a new code");
      assert.deepEqual(errors, []);
      results.push({ width, scenario, passed: true });
      await context.close();
    }
    await fs.writeFile(path.join(output, "terminal-cart-verification.json"), JSON.stringify({ results, mockedApis: true, productionWrites: false }, null, 2) + "\n");
    console.log(`PASS: ${results.length} terminal-cart and preserved-draft browser cases; no order/payment mutations.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

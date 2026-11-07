const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const R = require("../hesabim/order-rules.js");
const legal = require("../assets/legal-v6.json");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-checkout-reference-20261108";
const owner = "10000000-0000-4000-8000-000000000001", orderID = "20000000-0000-4000-8000-000000000001";
const key = `magazadanal.web.draft.v1.${owner}`;
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const scenario of ["normal", "duplicate", "unavailable", "mismatch", "existing", "late-result"]) {
      console.log(`Checking ${scenario}`);
      const context = await browser.newContext({ viewport: { width: scenario === "duplicate" ? 390 : 1280, height: 900 } });
      const draft = R.newDraft(); draft.express = true; draft.payment = "bank_transfer";
      draft.items = [{ client_item_id: crypto.randomUUID(), store: "Beymen", branch: "Synthetic", product_name: "Test", product_link: "https://example.invalid/product", size: "M", color: "Siyah", estimated_price: 100, store_latitude: 41.06, store_longitude: 28.99 }];
      draft.address = { district: "Şişli", neighborhood: "Test", address_line: "Test", building_no: "1", building_name: "Test", directions: "Test", customer_name: "Test", customer_phone: "+905300000000", latitude: 41.06, longitude: 28.99 };
      const seed = { owner, updated: Date.now(), draft, stage: "stores", checkout: true, frozen: null };
      await context.addInitScript(({ owner, key, seed }) => {
        if (sessionStorage.getItem("test.seeded")) return;
        sessionStorage.setItem("test.seeded", "true");
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ accessToken: "mock", refreshToken: "mock", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
        sessionStorage.setItem(key, JSON.stringify(seed));
      }, { owner, key, seed });
      let createCalls = [], reservations = [], created = scenario === "existing";
      let answer, started;
      const delayed = new Promise(resolve => { answer = resolve; });
      const reservationStarted = new Promise(resolve => { started = resolve; });
      const codes = new Map();
      await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === base && url.pathname === "/assets/checkout-reference.json") return route.fulfill({ contentType: "application/json", body: '{"enabled":true}' });
        if (url.origin === base) return route.continue();
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co", "External operations are mocked");
        let data;
        if (url.pathname.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/auth/v1/token") data = { access_token: "mock", refresh_token: "mock", expires_in: 3600, user: { id: owner, email: "test@example.invalid" } };
        else if (url.pathname === "/rest/v1/profiles") data = [{ id: owner, full_name: "Test Buyer", phone: "+905300000000", role: "customer", is_active: true }];
        else if (url.pathname === "/rest/v1/customer_addresses" || ["list_support_tickets_v3", "list_order_activity", "get_order_delivery_code", "get_order_courier_position"].some(name => url.pathname.endsWith(name))) data = [];
        else if (url.pathname === "/rest/v1/orders") data = created ? [{ id: orderID, order_no: "000123", status: scenario === "existing" ? "delivered" : "payment_waiting", created_at: new Date().toISOString(), customer_total: 460, order_items: [] }] : [];
        else if (url.pathname.endsWith("reserve_customer_checkout_reference")) {
          const id = req.postDataJSON().p_client_request_id; reservations.push(id);
          started(); if (scenario === "late-result") await delayed;
          if (scenario === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
          if (!codes.has(id)) codes.set(id, String(123 + codes.size).padStart(6, "0"));
          data = [{ authorized: true, result: scenario === "existing" ? "already_created" : "reserved", reference_code: codes.get(id), order_id: scenario === "existing" ? orderID : null }];
        } else if (url.pathname.endsWith("list_customer_legal_acknowledgements")) data = legal.profile.map(d => ({ document_type: d.p_document_type, document_version: d.p_document_version, document_hash: d.p_document_hash }));
        else if (url.pathname === "/auth/v1/logout") data = {};
        else if (url.pathname.endsWith("create_customer_order_v7")) {
          const body = req.postDataJSON(); createCalls.push(body); created = true;
          data = [{ authorized: true, result: "success", order_id: orderID, amount: 460, transfer_code: scenario === "mismatch" ? "999999" : codes.get(body.p_client_request_id) }];
        } else throw Error(url.pathname);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
      page.setDefaultTimeout(8000);
      await page.goto(base + "/hesabim/?view=cart"); await page.locator("#portal-view").waitFor();
      if (scenario === "late-result") {
        await reservationStarted;
        await page.locator('[data-view="profile"]').click();
        await Promise.all([page.waitForEvent("framenavigated", frame => frame === page.mainFrame()), page.locator("#logout-button").click()]);
        await page.locator("#auth-view").waitFor(); answer();
        await page.waitForTimeout(100);
        assert.equal(await page.getByText("000123", { exact: true }).count(), 0);
        assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
        assert.equal(createCalls.length, 0);
      } else if (scenario === "unavailable") {
        await page.getByRole("button", { name: "Açıklama kodunu yeniden al", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Öde ve onayla", exact: true }).isEnabled(), false);
        assert.equal(await page.locator(".legal-approval:enabled").count(), 0); assert.equal(createCalls.length, 0);
      } else if (scenario === "existing") {
        await page.locator('[data-panel="history"]').waitFor({ state: "visible" });
        assert.equal(createCalls.length, 0, "An already-created draft navigates to the existing order, never rewrites legal evidence");
      } else {
        await page.getByText("000123", { exact: true }).waitFor();
        assert.equal(createCalls.length, 0, "Previewing a reference must not create an order");
        const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
        assert.equal(saved.draft.checkoutReference.owner, owner); assert.equal(saved.draft.requestID, draft.requestID);
        await page.reload(); await page.getByText("000123", { exact: true }).waitFor();
        assert.equal(codes.size, 1, "Reload retains the same reference");
        if (scenario === "duplicate") {
          const second = await context.newPage(); await second.goto(base + "/hesabim/?view=cart");
          await second.getByText("000124", { exact: true }).waitFor();
          const copy = await second.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
          assert.notEqual(copy.draft.requestID, draft.requestID); assert.equal(copy.draft.checkoutReference.code, "000124");
          assert.equal(createCalls.length, 0); await second.close();
        } else {
          await page.getByRole("button", { name: /Ön Bilgilendirme, Mesafeli Sözleşme/ }).click();
          const content = await page.getByRole("dialog").innerText(); assert.ok(content.includes("000123")); assert.ok(!content.includes(draft.requestID));
          await page.getByRole("button", { name: "Okudum ve kabul ediyorum", exact: true }).click();
          await page.locator(".legal-approval").nth(1).click();
          await page.getByRole("button", { name: "Okudum ve kabul ediyorum", exact: true }).click();
          if (scenario === "normal") await page.screenshot({ path: path.join(output, "payment-reserved-local.png"), fullPage: true });
          await page.getByRole("button", { name: "Öde ve onayla", exact: true }).click();
          await page.getByRole("heading", { name: "Sipariş talebi alındı", exact: true }).waitFor();
          assert.equal(createCalls.length, 1); assert.equal(createCalls[0].p_client_request_id, draft.requestID);
          assert.ok(createCalls[0].legal_acceptances.every(d => !d.content.includes(draft.requestID)));
          if (scenario === "mismatch") {
            await page.getByText("Sunucunun açıklama kodu beklenenden farklı. Para göndermeden önce Bize Ulaşın üzerinden kontrol iste.", { exact: true }).waitFor();
            assert.equal(await page.locator(".bank-details").count(), 0);
          } else { assert.equal(await page.locator("#order-status").isVisible(), false); }
        }
      }
      assert.deepEqual(errors, []); await context.close();
    }
    console.log("PASS: reference-only preview, owner binding, reload stability, duplicated-tab fork, full mocked checkout, server mismatch, unavailable RPC and existing-order recovery.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

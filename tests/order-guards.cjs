const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const R = require("../hesabim/order-rules.js");
const legal = require("../assets/legal-v6.json");
const catalog = require("../assets/order-catalog.json");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const owner = "10000000-0000-4000-8000-000000000001";
async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const scenario of ["storage", "maintenance", "other-owner", "stale-result", "address-profile-support"]) {
      const context = await browser.newContext(); const page = await context.newPage();
      let writes = 0, refreshIdentity = owner, mutatedProfile = null, addressSaved = null, supportSent = null, addresses = [], deleted = false;
      let respond;
      const deferred = new Promise((resolve) => { respond = resolve; });
      const draft = R.newDraft(); draft.express = true; draft.items = [{ client_item_id: crypto.randomUUID(), store: "Beymen", branch: "Test", product_name: "Test", size: "M", color: "Siyah", estimated_price: 100, product_link: "https://example.com", store_latitude: 41, store_longitude: 29 }];
      draft.address = { district: "Şişli", neighborhood: "Test", address_line: "Sokak", building_no: "1", building_name: "Bina", directions: "Kapı", customer_name: "Test", customer_phone: "+905301234567", latitude: 41, longitude: 29 };
      const payload = R.payload(draft, await R.documents(draft, legal, "test@example.invalid", catalog.stores));
      const data = { owner: scenario === "other-owner" ? "different-owner" : owner, updated: 0, draft, frozen: { payload, expectedAmount: 460 }, stage: "stores", checkout: true };
      await page.addInitScript(({ owner, data, scenario }) => {
        if (sessionStorage.getItem("test.seeded")) return;
        sessionStorage.setItem("test.seeded", "true");
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ refreshToken: "mock-refresh", accessToken: "mock-access", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
        sessionStorage.setItem(`magazadanal.web.draft.v1.${owner}`, JSON.stringify(data));
        if (scenario === "storage") {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) { if (key.includes("draft.v1")) throw new DOMException("Quota", "QuotaExceededError"); return original.call(this, key, value); };
        }
      }, { owner, data, scenario });
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url()); if (url.origin === base) return route.continue();
        if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co");
        const p = url.pathname; const body = route.request().postDataJSON(); let result;
        if (p.endsWith("get_public_runtime_status")) result = [{ customer_web_account_enabled: true, customer_ordering_enabled: scenario !== "maintenance" }];
        else if (p === "/auth/v1/token") result = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: refreshIdentity, email: "test@example.invalid" } };
        else if (p === "/rest/v1/profiles") result = [{ id: owner, full_name: "Test", phone: "+905301234567", role: "customer", is_active: true }];
        else if (p === "/rest/v1/customer_addresses") result = addresses;
        else if (p === "/rest/v1/orders" || p.endsWith("list_order_activity") || p.endsWith("list_support_tickets_v3")) result = [];
        else if (p === "/rest/v1/customer_billing_profiles") result = [{ invoice_type: "individual", company_name: "Preserved Co", identity_number: "", billing_address: "Preserved address" }];
        else if (p === "/rest/v1/customer_profile_photos") result = [{ photo_base64: "unchanged-photo" }];
        else if (p.endsWith("update_customer_profile_secure")) { mutatedProfile = body; result = "success"; }
        else if (p.endsWith("save_customer_address_v2")) {
          addressSaved = body; const address = {}; for (const [key, value] of Object.entries(body)) address[key.slice(2)] = value;
          address.is_invoice = true; addresses = [address]; result = true;
        }
        else if (p.endsWith("delete_customer_address")) { assert.equal(body.target_address_id, addresses[0].id); addresses = []; deleted = true; result = true; }
        else if (p.endsWith("create_support_ticket_v3")) { supportSent = body; result = [{ id: crypto.randomUUID() }]; }
        else if (p.endsWith("create_customer_order_v7")) {
          writes++;
          if (scenario === "stale-result") await deferred;
          result = [{ authorized: true, result: "success", order_id: "20000000-0000-4000-8000-000000000001", amount: 460, transfer_code: "PRIVATE-OLD-ACCOUNT" }];
        } else if (p === "/auth/v1/logout") { result = {}; }
        else throw Error(p);
        try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) }); } catch { /* Context closed after local logout. */ }
      });
      await page.goto(base + "/hesabim/"); await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="cart"]').click();
      if (scenario !== "other-owner") {
        await page.getByRole("button", { name: "Geri", exact: true }).click();
        assert.ok(await page.locator('[data-panel="orders"]').isVisible());
        assert.equal(writes, 0, "Back from an uncertain request must never resubmit it");
        await page.locator('[data-view="cart"]').click();
        assert.ok(await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).isVisible());
      }
      if (scenario === "other-owner") { await page.getByText("Sepetin boş.", { exact: true }).waitFor(); }
      else if (scenario === "address-profile-support") {
        await page.locator('[data-view="profile"]').click(); await page.locator("#profile-edit").click();
        await page.locator('[name="profile_first_name"]').fill("Updated");
        await page.locator('[name="profile_last_name"]').fill("Test");
        await page.getByRole("button", { name: "Kaydet", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".app-dialog"));
        assert.equal(mutatedProfile.p_full_name, "Updated Test"); assert.equal(mutatedProfile.p_photo_base64, "unchanged-photo");
        assert.equal(mutatedProfile.p_billing_address, "Preserved address"); assert.equal(mutatedProfile.p_company_name, "Preserved Co");
        await page.locator('[data-open-view="support"]').click();
        await page.locator("#support-message").fill("Test mesajı"); await page.locator("#support-submit").click();
        await page.waitForFunction(() => document.querySelector("#support-message").value === "");
        assert.equal(supportSent.p_message, "Test mesajı"); assert.ok(R.UUID.test(supportSent.p_client_request_id));
        await page.locator('[data-view="profile"]').click(); await page.locator('[data-open-view="addresses"]').click();
        await page.getByRole("button", { name: "Yeni adres ekle", exact: true }).click();
        await page.locator('[name="title"]').fill("Ev Test");
        await page.getByRole("dialog").locator('[name="district"]').selectOption("Şişli");
        for (const [key, value] of Object.entries({ neighborhood: "Test Mahallesi", address_line: "Sokak", building_no: "1", building_name: "Bina 1", directions: "Kapı" })) await page.getByRole("dialog").locator(`[name="${key}"]`).fill(value);
        await page.getByRole("button", { name: "Teslimat konumu seç", exact: true }).click();
        await page.getByRole("button", { name: "Haritayı aç", exact: true }).click();
        await page.locator(".app-map").click({ position: { x: 130, y: 160 } });
        await page.getByRole("button", { name: "Bu konumu kullan", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Kaydet", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".app-dialog"));
        assert.equal(addressSaved.p_title, "Ev Test"); assert.ok(R.point(addressSaved.p_latitude, addressSaved.p_longitude));
        await page.getByRole("button", { name: "Düzenle", exact: true }).click();
        await page.getByRole("dialog").locator('[name="building_name"]').fill("Bina 2");
        await page.getByRole("dialog").getByRole("button", { name: "Kaydet", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".app-dialog")); assert.equal(addressSaved.p_building_name, "Bina 2");
        await page.getByRole("button", { name: "Sil", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Sil", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".app-dialog")); assert.equal(deleted, true);
      } else {
        await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).click();
        if (scenario === "stale-result") {
          await page.waitForTimeout(100); assert.equal(writes, 1);
          assert.ok(await page.getByRole("button", { name: "Geri", exact: true }).isDisabled());
          await page.locator('[data-view="profile"]').click();
          await Promise.all([page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()), page.locator("#logout-button").click()]); await page.locator("#auth-view").waitFor(); respond();
          await page.waitForTimeout(100); assert.equal(await page.getByText("PRIVATE-OLD-ACCOUNT", { exact: true }).count(), 0);
          assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.includes("draft.v1")).length), 0);
        } else {
          await page.locator("#order-status").waitFor(); assert.equal(writes, 0, `${scenario} must block order submission`);
        }
      }
      await context.close();
    }
    console.log("PASS: storage failure, maintenance, owner isolation, late response after logout, profile preservation, address CRUD and support.");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

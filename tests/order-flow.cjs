const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const legal = require("../assets/legal-v9.json");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-order-20261105";
const owner = "10000000-0000-4000-8000-000000000001";
const orderID = "20000000-0000-4000-8000-000000000001";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  let runs = 0;
  try {
    for (const [width, theme] of [[390, "light"], [390, "dark"], [1280, "light"], [320, "dark"], [768, "light"]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["geolocation"], geolocation: { latitude: 41.071, longitude: 28.99 } });
      const page = await context.newPage();
      await page.clock.install({ time: new Date() });
      const errors = [], calls = []; let created = false, delivered = false, attempts = [], firstAttempt = true, acks = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.addInitScript((theme) => localStorage.setItem("magazadanal.web.theme.v1", theme), theme);
      await page.route("**/*", async (route) => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base && url.pathname === "/assets/checkout-reference.json") return route.fulfill({ contentType: "application/json", body: '{"enabled":false}' });
        if (url.origin === base) return route.continue();
        if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({contentType:'application/javascript',
          body:'window.turnstile={render(selector,options){setTimeout(()=>options.callback("synthetic-order-login-proof"),30)}};'});
        if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co", "No unmocked external network");
        const p = url.pathname; const body = req.postDataJSON(); calls.push({ path: p, body });
        let data;
        if (p.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (p === "/functions/v1/web-store-search") data = { results: [] };
        else if (p === "/auth/v1/token") {
          if (url.searchParams.get('grant_type') === 'password') assert.equal(body.gotrue_meta_security.captcha_token,'synthetic-order-login-proof');
          data = { access_token: "mock-access-token", refresh_token: "mock-refresh-token", expires_in: 3600, user: { id: owner, email: "customer@example.invalid" } };
        }
        else if (p === "/rest/v1/profiles") data = [{ id: owner, role: "customer", full_name: "Test Müşteri", phone: "+905301234567", is_active: true }];
        else if (p === "/rest/v1/customer_addresses") data = [{ id: "30000000-0000-4000-8000-000000000001", title: "Ev", city: "İstanbul", district: "Şişli", neighborhood: "Test Mahallesi", address_line: "Test Sokak", building_no: "1", building_name: "Bina kat 1 daire 2", directions: "Kapı", latitude: 41.07, longitude: 29, is_invoice: true }];
        else if (p === "/rest/v1/orders") data = created ? [{ id: orderID, order_no: "000001", status: delivered ? "delivered" : "payment_waiting", selected_store_count: 1, customer_total: 460, created_at: new Date().toISOString(), order_items: [] }] : [];
        else if (p.endsWith("list_support_tickets_v3")) data = [{ message: "<img src=x onerror=alert(1)>", status: "closed", created_at: new Date().toISOString(), replies: [{ message: "Test yönetici yanıtı" }] }];
        else if (p.endsWith("list_order_activity")) data = [];
        else if (p === "/rest/v1/customer_profile_photos") data = [];
        else if (p.endsWith("list_customer_legal_acknowledgements")) data = acks;
        else if (p.endsWith("record_customer_legal_acknowledgement")) { acks.push({ document_type: body.p_document_type, document_version: body.p_document_version, document_hash: body.p_document_hash }); data = true; }
        else if (p.endsWith("validate_promotion_code")) data = [{ authorized: true, result: "valid", normalized_code: "TEST10", discount_percent: 10 }];
        else if (p.endsWith("create_customer_order_v7")) {
          attempts.push(body);
          if (firstAttempt) { firstAttempt = false; return route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); }
          created = true;
          data = [{ authorized: true, result: "already_created", order_id: orderID, amount: width === 768 ? 999 : 424, transfer_code: "TEST-TRANSFER" }];
        }
        else if (p.endsWith("get_order_delivery_code")) data = [{ delivery_code: "1234" }];
        else if (p.endsWith("get_order_courier_position")) data = [];
        else if (p === "/auth/v1/logout") { assert.equal(url.searchParams.get("scope"), "local"); data = {}; }
        else throw Error(`Unexpected request: ${p}`);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      const navigation = await page.goto(base + "/hesabim/");
      assert.ok(navigation.headers()["content-security-policy"].includes("https://tile.openstreetmap.org"));
      assert.equal(navigation.headers()["cache-control"], "no-store");
      await page.locator("#login-email").fill("customer@example.invalid");
      await page.locator("#login-password").fill("not-a-real-password");
      await page.locator("#login-button").click();
      await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="shop"]').click();
      await page.getByRole("button", { name: "Beymen", exact: true }).click();
      assert.ok(await page.getByRole("button", { name: "Fotoğraf seç", exact: true }).isVisible());
      assert.equal(await page.locator('[name="product_name"], [name="alternative_size"], [name="alternative_color"]').count(), 0);
      await page.locator('[name="product_link"]').fill("https://example.com/product");
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Fotoğraf seç", exact: true }).click();
      await (await chooser).setFiles(path.join(__dirname, "../assets/magazadanal-logo.png"));
      await page.waitForFunction(() => document.querySelector('.product-photo-preview img')?.src.startsWith('data:image/jpeg'));
      assert.ok(await page.getByRole("button", { name: "Fotoğrafı değiştir", exact: true }).isVisible());
      await page.locator('[name="size"]').fill("M");
      await page.locator('[name="color"]').fill("Siyah");
      await page.locator('[name="estimated_price"]').fill("100");
      await page.getByText("Bu şubeden al", { exact: true }).click();
      await page.locator('[name="branch"]').fill("Test Şube");
      await page.getByRole("button", { name: "Mağaza konumu seç", exact: true }).click();
      assert.ok(await page.locator('.app-map').isVisible());
      await page.locator(".app-map").click({ position: { x: 130, y: 160 } });
      await page.getByRole("button", { name: "Bu konumu kullan" }).click();
      await page.screenshot({ path: path.join(output, `product-${width}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "Sepete ekle", exact: true }).click();
      await page.locator('[name="saved_address"]').selectOption("30000000-0000-4000-8000-000000000001");
      assert.equal(await page.locator('[name="address_line"], [name="building_no"], [name="district"], [name="directions"]').count(), 0);
      assert.equal(await page.getByRole('button',{name:'Teslimat konumu seçildi · Değiştir',exact:true}).count(),0);
      await page.locator('[name="customer_name"]').fill("Other Recipient");
      await page.locator('[name="customer_phone_number"]').fill("5300000000");
      assert.equal(await page.locator('[name="saved_address"]').inputValue(),'30000000-0000-4000-8000-000000000001');
      await page.screenshot({ path: path.join(output, `cart-${width}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "Ödemeye geç", exact: true }).click();
      assert.equal(await page.locator('.choice-row input:checked').count(), 0);
      assert.equal(await page.getByText("Promosyon indirimi", { exact: true }).count(), 0);
      await page.locator('input[name="delivery"]').first().check();
      await page.locator('input[name="payment"]').check();
      await page.locator('[name="promotion"]').fill("TEST10");
      await page.getByRole("button", { name: "Uygula", exact: true }).click();
      await page.getByRole("button", { name: "Kaldır", exact: true }).waitFor();
      assert.equal(await page.locator('.choice-row input:disabled').count(), 1);
      const deliveryOptions = page.locator('fieldset.app-options').first();
      assert.ok((await deliveryOptions.innerText()).includes('Tahmini 1–3 saatte teslim'));
      assert.ok((await deliveryOptions.innerText()).includes('Tahmini gün içinde teslim'));
      await deliveryOptions.screenshot({path:path.join(output,`delivery-options-${width}-${theme}.png`)});
      await page.getByRole("button", { name: "Öde ve onayla", exact: true }).click();
      await page.getByText("Sipariş sözleşmelerini ve hizmet başlangıcını onayla.", { exact: true }).waitFor();
      await page.getByRole("button", { name: /Ön Bilgilendirme, Mesafeli Sözleşme ve İade Koşulları/ }).click();
      const legalText = await page.locator('.app-dialog').innerText();
      for (const text of ['Mağaza şubesi:','Beden / boyut: M','Renk: Siyah','Ürün linki: https://example.com/product',
        'Kanuni azami süre (teslimat seçeneği değildir):']) assert.ok(legalText.includes(text),text);
      await page.getByRole("button", { name: "Okudum ve kabul ediyorum", exact: true }).click();
      await page.locator('.legal-approval').nth(1).click();
      await page.getByRole("button", { name: "Okudum ve kabul ediyorum", exact: true }).click();
      await page.screenshot({ path: path.join(output, `payment-${width}-${theme}.png`), fullPage: true });
      const submit = page.getByRole("button", { name: "Öde ve onayla", exact: true });
      await submit.click();
      await page.getByRole("dialog", { name: "Hesap sözleşmeleri" }).waitFor();
      await page.locator('.app-dialog input[type="checkbox"]').evaluateAll((nodes) => nodes.forEach((n) => n.click()));
      await page.waitForFunction(() => [...document.querySelectorAll('.app-dialog input')].every((n) => n.disabled));
      await page.getByRole("button", { name: "Tamam", exact: true }).click();
      await submit.click();
      await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).waitFor();
      await page.waitForTimeout(100);
      assert.equal(attempts.length, 1);
      await page.reload();
      await page.locator("#portal-view").waitFor();
      await page.locator('[data-view="cart"]').click();
      await page.getByRole("button", { name: "Aynı talebi kontrol et", exact: true }).click();
      await page.getByRole("heading", { name: "Sipariş talebi alındı", exact: true }).waitFor();
      assert.equal(await page.locator("#order-status").isVisible(), false, "A successful order clears stale validation and retry errors");
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[0], attempts[1], "Retries use identical immutable payload and request ID across reload");
      assert.equal(attempts[1].legal_acceptances.length, 4);
      for (const doc of attempts[1].legal_acceptances) {
        assert.equal(doc.document_version, '2026-11-13-model-b-9');
        assert.ok(doc.content.includes(legal.service_data_notice));
      }
      for (const doc of legal.profile) assert.ok(acks.some(ack => ack.document_type === doc.p_document_type && ack.document_version === doc.p_document_version && ack.document_hash === doc.p_document_hash));
      assert.equal(attempts[1].delivery_address.customer_name, "Other Recipient");
      assert.equal(attempts[1].delivery_address.customer_phone, "+905300000000");
      assert.ok(attempts[1].legal_acceptances.some(doc => doc.content.includes("Test Müşteri")));
      assert.ok(!attempts[1].legal_acceptances.some(doc => doc.content.includes("Other Recipient")));
      assert.equal(attempts[1].items[0].product_name, "Ürün 1");
      assert.equal(attempts[1].items[0].alternative_size, "İstemiyorum");
      assert.equal(attempts[1].items[0].alternative_color, "İstemiyorum");
      assert.equal(attempts[1].p_promotion_code, "TEST10");
      assert.ok(await page.getByText("Ödeme henüz doğrulanmadı.", { exact: true }).isVisible());
      assert.equal(await page.getByText("TEST-TRANSFER", { exact: true }).count(), width === 768 ? 0 : 1);
      if (width === 768) assert.ok(await page.getByText("Sunucu tutarı sepet tahmininden farklı. Para göndermeden önce Bize Ulaşın üzerinden kontrol iste.", { exact: true }).isVisible());
      await page.getByRole("button", { name: "Siparişi takip et", exact: true }).click();
      await page.locator('#orders-list').getByText("Sipariş 000001", { exact: true }).waitFor();
      if (width === 390 && theme === "light") {
        delivered = true; await page.clock.fastForward(16000);
        await page.locator("#orders-list .empty-state").waitFor();
        assert.equal(await page.locator("#orders-list .order-card:not(.tracking-placeholder)").count(), 0, "Completed orders leave the active-only tracking screen");
        await page.locator('[data-view="profile"]').click(); await page.locator("#profile-history").click();
        await page.locator("#view-history").waitFor();
        assert.equal(await page.locator("#history-list .status-delivered").count(), 1);
        await page.locator('[data-view="orders"]').click();
      }
      await page.screenshot({ path: path.join(output, `tracking-${width}-${theme}.png`), fullPage: true });
      await page.locator('[data-view="profile"]').click();
      await page.locator('[data-open-view="support"]').click();
      assert.ok(await page.getByText("Test yönetici yanıtı", { exact: true }).isVisible());
      assert.equal(await page.locator("#support-list img").count(), 0, "Support content is text, not HTML");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${width}/${theme}`);
      assert.deepEqual(errors.filter((s) => !s.includes("503")), [], `Browser errors ${width}/${theme}`);
      await page.locator('[data-view="profile"]').click();
      await Promise.all([page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()), page.locator("#logout-button").click()]);
      await page.locator("#auth-view").waitFor();
      assert.ok(await page.locator("#account-sidebar").isVisible(), "Menu remains visible after logout");
      assert.ok(await page.locator("#portal-view").isHidden(), "Private content stays hidden after logout");
      assert.equal(await page.locator("[data-cart-count]").innerText(), "", "Public menu does not retain the previous cart count");
      const submittedBeforeGuestNavigation = calls.filter(c => c.path.endsWith("create_customer_order_v7")).length;
      await page.locator('#account-sidebar [data-view="shop"]').click();
      assert.ok(await page.locator("#auth-view").isHidden());
      assert.ok(await page.locator('[data-panel="shop"]').isVisible());
      assert.ok(await page.locator('[data-panel="profile"]').isHidden());
      assert.equal(calls.filter(c => c.path.endsWith("create_customer_order_v7")).length, submittedBeforeGuestNavigation);
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.includes("draft.v1"))), false);
      assert.ok(calls.every((c) => !c.path.includes("admin_")));
      await context.close(); runs++;
    }
    console.log(`PASS: ${runs} mocked order flows, legal consent, promo, uncertain retry/reload, tracking, logout. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

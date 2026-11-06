const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-tracking-20261106";
const owner = "10000000-0000-4000-8000-000000000001";
const activeID = "20000000-0000-4000-8000-000000000001";
const deliveredID = "20000000-0000-4000-8000-000000000002";
const cancelledID = "20000000-0000-4000-8000-000000000003";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const [width, theme] of [[1280, "light"], [1280, "dark"], [390, "light"], [320, "dark"], [1024, "light"]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Europe/Istanbul" });
      const page = await context.newPage(), errors = [], calls = [];
      let phase = "fresh", status = "on_the_way", longitude = 28.99;
      const created = new Date().toISOString();
      await page.clock.install({ time: new Date() });
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.addInitScript(({ owner, theme }) => {
        localStorage.setItem("magazadanal.web.theme.v1", theme);
        sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
      }, { owner, theme });
      await page.route("**/*", async route => {
        const url = new URL(route.request().url()); if (url.origin === base) return route.continue();
        if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co");
        const p = url.pathname, body = route.request().postDataJSON(); calls.push({ p, body }); let data;
        if (p.endsWith("get_public_runtime_status")) data = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (p === "/auth/v1/token") data = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: owner, email: "test@example.invalid" } };
        else if (p === "/rest/v1/profiles") data = [{ id: owner, role: "customer", full_name: "Test Müşteri", phone: "+905301234567", is_active: true }];
        else if (p === "/rest/v1/orders") data = [[activeID, "000101", status], [deliveredID, "000099", "delivered"], [cancelledID, "000098", "cancelled"]].map(([id, order_no, status]) => ({ id, order_no, status, customer_total: 460, selected_store_count: 1, created_at: created, order_items: [] }));
        else if (p === "/rest/v1/customer_addresses" || p.endsWith("list_support_tickets_v3")) data = [];
        else if (p.endsWith("list_order_activity")) data = [{ id: "30000000-0000-4000-8000-000000000001", order_id: activeID, action: "store_departure_started", current_assignment: true, created_at: created }];
        else if (p.endsWith("get_order_delivery_code")) { assert.equal(body.target_order_id, activeID); data = [{ delivery_code: "1234" }]; }
        else if (p.endsWith("get_order_courier_position")) {
          assert.equal(body.target_order_id, activeID, "History orders must not request courier coordinates");
          const captured = new Date(Date.now() - (phase === "stale" ? 180000 : 0)).toISOString();
          data = [{ latitude: 41.072, longitude, accuracy_meters: 10, captured_at: captured, received_at: captured }];
        } else throw Error(`Unexpected backend request/write: ${p}`);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      await page.goto(base + "/hesabim/"); await page.locator("#portal-view").waitFor();
      await page.locator("#orders-list .courier-coordinates:not([hidden])").waitFor();
      assert.equal(await page.locator('#orders-list .order-card').count(), 1);
      assert.equal(await page.locator('#orders-list .order-card[open]').count(), 1);
      assert.equal(await page.locator('#refresh-button, [data-order-filter]').count(), 0);
      assert.equal(await page.getByRole("button", { name: "Yenile", exact: true }).count(), 0);
      assert.equal(await page.locator('#orders-list .status-delivered, #orders-list .status-cancelled').count(), 0);
      await page.getByRole("button", { name: "Kurye haritasını aç", exact: true }).click();
      await page.locator(".leaflet-overlay-pane path").waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `tracking-${width}-${theme}.png`), fullPage: true });
      if (width >= 900) {
        await page.locator('[data-view="shop"]').click();
        const custom = page.getByRole("button", { name: "Farklı mağaza girişi", exact: true });
        const multi = page.getByRole("button", { name: "Çoklu mağaza seç", exact: true });
        await custom.waitFor();
        assert.ok(Math.abs((await custom.boundingBox()).width - (await multi.boundingBox()).width) < 1);
        const y = (await page.locator(".portal-tabs").boundingBox()).y;
        await page.evaluate(() => window.scrollTo(0, 650));
        assert.ok(Math.abs((await page.locator(".portal-tabs").boundingBox()).y - y) < 1, "Fixed menu must not move with document scroll");
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `stores-${width}-${theme}.png`), fullPage: true });
      }
      await page.locator('[data-view="orders"]').click();
      phase = "stale"; await page.clock.fastForward(11000);
      await page.waitForFunction(() => document.querySelector('#orders-list .courier-coordinates').hidden);
      assert.ok(await page.getByRole("button", { name: "Kurye haritasını aç", exact: true }).isDisabled());
      assert.equal(await page.locator("#orders-list .leaflet-overlay-pane path").count(), 0);
      phase = "fresh"; longitude = 28.991;
      await page.clock.fastForward(11000);
      await page.waitForFunction(() => document.querySelector('#orders-list .courier-coordinates')?.textContent.includes('28.99100'));
      await page.locator("#orders-list .leaflet-overlay-pane path").waitFor();
      status = "delivered"; await page.clock.fastForward(16000);
      await page.locator("#orders-list .empty-state").waitFor();
      assert.equal(await page.locator("#orders-list .order-card").count(), 0);
      assert.equal(await page.locator("#orders-list .courier-location").count(), 0);
      await page.locator('[data-view="profile"]').click(); await page.locator("#profile-history").click();
      await page.locator("#view-history").waitFor();
      assert.equal(await page.locator("#history-list .order-card").count(), 3);
      await page.locator("#history-list .order-card").first().locator("summary").click();
      assert.equal(await page.locator('#history-list .courier-location').count(), 0);
      assert.ok(await page.locator('[data-view="profile"]').evaluate(node => node.classList.contains('is-active')));
      assert.deepEqual(errors, []);
      assert.ok(calls.filter(call => call.p.endsWith("get_order_courier_position")).every(call => call.body.target_order_id === activeID));
      await context.close();
    }
    console.log("PASS: five viewport/theme combinations; full-width store action; fixed sidebar; no refresh/filter buttons; active-only tracking; fresh/stale/moving GPS; completion in separate profile history. All backend/map requests mocked.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

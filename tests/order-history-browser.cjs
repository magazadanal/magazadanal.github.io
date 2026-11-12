const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = new URL(process.env.SITE_TEST_URL || "http://127.0.0.1:8766");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
const owner = "10000000-0000-4000-8000-000000000001";
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const created = "2026-11-12T12:00:00.123456+00:00";

async function run() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const scenario of ["pages", "retry", "logout", "tracking"]) {
      const context = await browser.newContext({ viewport: { width: scenario === "pages" ? 320 : 1280, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const errors = [], historyCursors = [], calls = [];
      let failures = scenario === "retry" ? 1 : 0, release = null, delivered = false;
      const orders = Array.from({ length: 250 }, (_, i) => ({ id: id(250 - i), order_no: String(250 - i).padStart(6, "0"),
        status: i === 249 ? "shopping" : "delivered", customer_total: 1360.5, selected_store_count: 1,
        created_at: created, delivery_address_snapshot: {}, order_items: [] }));
      page.on("pageerror", error => errors.push(error.message));
      await page.clock.install();
      await page.addInitScript(owner => {
        if (!sessionStorage.getItem("history-test-logout")) sessionStorage.setItem("magazadanal.web.session.v1", JSON.stringify({ accessToken: "synthetic-session", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000, user: { id: owner, email: "test@example.invalid" } }));
      }, owner);
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base.origin) return route.continue();
        assert.equal(url.hostname, "zxqqbzggfbxoasyhueqb.supabase.co");
        calls.push(url.pathname + url.search);
        let result;
        if (url.pathname.endsWith("get_public_runtime_status")) result = [{ customer_web_account_enabled: true, customer_ordering_enabled: true }];
        else if (url.pathname === "/rest/v1/profiles") result = [{ id: owner, role: "customer", full_name: "Test Müşteri", phone: "+905301234567", is_active: true }];
        else if (url.pathname === "/rest/v1/orders") {
          assert.equal(url.searchParams.get("customer_id"), `eq.${owner}`);
          assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
          assert.equal(url.searchParams.get("limit"), "100");
          let rows = orders.map(order => order.id === id(1) && delivered ? { ...order, status: "delivered" } : order);
          const status = url.searchParams.get("status");
          if (status === "in.(delivered,cancelled)") {
            historyCursors.push(url.searchParams.get("or"));
            if (failures-- > 0) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
            if (scenario === "logout") await new Promise(resolve => { release = resolve; });
            rows = rows.filter(row => ["delivered", "cancelled"].includes(row.status));
          } else if (status) rows = rows.filter(row => !["delivered", "cancelled"].includes(row.status));
          if (url.searchParams.has("id")) {
            const ids = url.searchParams.get("id").slice(4, -1).split(","); rows = rows.filter(row => ids.includes(row.id));
          }
          const filter = url.searchParams.get("or");
          if (filter) {
            assert.ok(filter.includes(created), "Keep microseconds and encoded timezone");
            const cursor = /id\.lt\.([a-f0-9-]{36})/.exec(filter)?.[1]; assert.ok(cursor);
            rows = rows.filter(row => row.id < cursor);
          }
          result = rows.slice(0, 100);
        } else if (url.pathname.endsWith("get_order_courier_position")) result = [];
        else if (url.pathname.endsWith("get_order_delivery_code")) result = [{ delivery_code: "1234" }];
        else if (url.pathname === "/auth/v1/logout") result = {};
        else if (["/rest/v1/customer_addresses", "/rest/v1/customer_profile_photos"].includes(url.pathname)
          || ["list_order_activity", "list_support_tickets_v3", "get_order_product_photos"].some(name => url.pathname.endsWith(name))) result = [];
        else throw Error("Unexpected API: " + url.pathname);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      });
      await page.goto(new URL("/hesabim/", base).href);
      await page.locator("#portal-view:not([hidden])").waitFor();
      await page.getByRole("button", { name: "Profil", exact: true }).click();
      await page.locator("#profile-history").click();
      await page.locator("#view-history:not([hidden])").waitFor();
      assert.equal(await page.locator("#history-list .order-card").count(), 100);
      const more = page.locator("#history-more");
      await more.click();
      if (scenario === "logout") {
        await page.waitForFunction(() => document.querySelector("#history-more").disabled);
        await page.getByRole("button", { name: "Profil", exact: true }).click();
        await page.evaluate(() => sessionStorage.setItem("history-test-logout", "1"));
        await page.locator("#logout-button").click();
        await page.locator("#login-email").waitFor();
        release?.();
        assert.equal(await page.locator("#history-list .order-card").count(), 0);
      } else {
        if (scenario === "retry") {
          await page.locator("#history-status:not([hidden])").waitFor();
          assert.equal(await page.locator("#history-list .order-card").count(), 100);
          await more.click();
        }
        await page.waitForFunction(() => document.querySelectorAll("#history-list .order-card").length === 200);
        await more.click();
        await page.waitForFunction(() => document.querySelectorAll("#history-list .order-card").length === 249);
        assert.ok(await more.isHidden());
        const ids = await page.locator("#history-list .order-card").evaluateAll(rows => rows.map(row => row.dataset.orderId));
        assert.equal(new Set(ids).size, 249);
        assert.equal(ids.at(-1), id(2));
        assert.equal(historyCursors[0], `(created_at.lt.${created},and(created_at.eq.${created},id.lt.${id(151)}))`);
        if (scenario === "retry") assert.equal(historyCursors[0], historyCursors[1]);
        await page.locator(`#history-list [data-order-id="${id(2)}"] summary`).click();
        assert.ok(await page.locator(`#history-list [data-order-id="${id(2)}"]`).innerText().then(text => text.includes("1.360,50")));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (scenario === "tracking") {
          const before = calls.filter(call => call.includes("status=in.") && !call.includes("delivered,cancelled")).length;
          await page.clock.fastForward(6000);
          assert.equal(calls.filter(call => call.includes("status=in.") && !call.includes("delivered,cancelled")).length, before);
          await page.getByRole("button", { name: "Takip", exact: true }).click();
          await page.clock.fastForward(6100);
          await page.waitForFunction(() => document.querySelectorAll("#orders-list .order-card:not(.tracking-placeholder)").length === 1);
          assert.ok(calls.filter(call => call.includes("status=in.") && !call.includes("delivered,cancelled")).length > before);
          assert.ok(await page.locator("#orders-list").innerText().then(text => text.includes("000001")), "An active order older than the latest 100 remains visible");
          const visibleCalls = calls.length;
          await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
          await page.clock.fastForward(6100);
          assert.equal(calls.length, visibleCalls, "Hidden document cannot keep polling");
          await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
          delivered = true;
          await page.clock.fastForward(2100);
          await page.locator("#orders-list .tracking-placeholder").waitFor();
          assert.ok(await page.locator("#history-list").innerText().then(text => text.includes("000001")));
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("PASS: four history/tracking scenarios; 249 historical orders, stable microsecond cursors, retry, logout isolation, old active order and visible-only 2-second updates.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

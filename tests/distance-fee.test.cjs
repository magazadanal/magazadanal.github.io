const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../hesabim/order-rules.js");

const flow = fs.readFileSync(path.join(__dirname, "../hesabim/order-flow.js"), "utf8");
const item = (store = "Zara", store_latitude = 41.05, store_longitude = 29.01) => ({ store, estimated_price: 1000, store_latitude, store_longitude });
const quoteRow = (meters = 7900) => ({ quote_id: "20000000-0000-4000-8000-000000000001", distance_meters: meters, fee: R.distanceFee(meters), source: "google_routes", expires_at: new Date(Date.now() + 1800000).toISOString() });
const draft = (extra = {}) => ({ items: [item()], address: { latitude: 41.07, longitude: 28.99 }, ...extra });

test("formula boundaries: 5.9, 6.0, 7.9 and 10.1 km", () => {
  assert.deepEqual([5900, 6000, 7900, 10100].map(R.distanceFee), [0, 10, 20, 50]);
});

test("the distance fee sits inside the shown service total and the grand total", () => {
  const t = R.totals([item()], true, 0, false, false, 20);
  assert.equal(t.service, 360); assert.equal(t.distance, 20); assert.equal(t.serviceTotal, 380); assert.equal(t.total, 1380);
});

test("promotion is calculated without the distance fee", () => {
  const t = R.totals([item()], true, 50, false, false, 100);
  assert.equal(t.discount, 180); assert.equal(t.serviceTotal, 460); assert.equal(t.total, 1280);
});

test("different region base is 450 TL and the distance fee is added on top", () => {
  const t = R.totals([item(), item("Mango")], false, 0, false, true, 50);
  assert.equal(t.service, 556); assert.equal(t.serviceTotal, 606);
});

test("a quote stops being valid when the address or a store changes, or when it expires", () => {
  const value = draft(); value.distanceQuote = R.distanceQuote(quoteRow(), R.distanceQuoteKey(value));
  assert.equal(R.activeDistanceQuote(value).fee, 20);
  assert.equal(R.activeDistanceQuote({ ...value, address: { latitude: 41.08, longitude: 28.99 } }), null);
  assert.equal(R.activeDistanceQuote({ ...value, items: [item("Mango", 41.1, 29.1)] }), null);
  assert.equal(R.activeDistanceQuote({ ...value, distanceQuote: { ...value.distanceQuote, expires_at: new Date(Date.now() + 30000).toISOString() } }), null);
});

test("the same stores in another order keep the quote; one request covers each distinct store", () => {
  const a = draft({ items: [item("Zara"), item("Mango", 41.1, 29.1), item("Zara")] });
  const b = draft({ items: [item("Mango", 41.1, 29.1), item("Zara")] });
  assert.equal(R.distanceQuoteKey(a), R.distanceQuoteKey(b));
  assert.equal(R.distanceQuoteRequest(a).stores.length, 2);
  assert.equal(R.distanceQuoteRequest(draft({ address: {} })), null);
});

test("a server answer that does not follow the formula is rejected", () => {
  const key = R.distanceQuoteKey(draft());
  assert.throws(() => R.distanceQuote({ ...quoteRow(), fee: 0 }, key));
  assert.throws(() => R.distanceQuote({ ...quoteRow(), source: "client" }, key));
});

test("the contract service total includes the distance fee without changing the template", async () => {
  const order = { ...draft(), requestID: "30000000-0000-4000-8000-000000000001", createdAt: "2026-11-19", express: true,
    items: [{ ...item(), client_item_id: "40000000-0000-4000-8000-000000000001", branch: "Şube", product_name: "Ürün", size: "M", color: "Siyah", estimated_price: 1000, product_link: "https://example.com/a" }],
    address: { district: "Şişli", customer_name: "Test Kişi", customer_phone: "05321234567", neighborhood: "Merkez", address_line: "Cadde", building_no: "1", building_name: "Bina", directions: "Tarif", latitude: 41.07, longitude: 28.99 } };
  order.distanceQuote = R.distanceQuote(quoteRow(), R.distanceQuoteKey(order));
  const catalog = { order: [{ document_type: "pre_information", document_version: "2026-11-17-model-b-10", transaction_model: "company_seller", title: "Ön", template: "S={{SERVICE_TOTAL}} T={{GRAND_TOTAL}}" }] };
  const [doc] = await R.documents(order, catalog, "a@example.com", []);
  assert.equal(doc.content, "S=380 T=1380");
  assert.equal(R.payload(order, [doc]).p_distance_quote_id, order.distanceQuote.quote_id);
});

test("no separate distance line or kilometre text is shown to the customer", () => {
  assert.equal(/Mesafe ücreti/.test(flow), false);
  assert.equal(/distance_km|distance_meters|\bkm\b/.test(flow), false);
});

test("orders use v9 and cannot be sent without a valid quote", () => {
  assert.ok(flow.includes('rpcName: "create_customer_order_v9"'));
  assert.ok(flow.includes("submit.disabled = !allowed() || !codeReady || !distanceReady"));
  assert.ok(flow.includes("Teslimat bedeli hesaplanıyor…") && flow.includes("Teslimat bedeli hesaplanamadı"));
});

// order-flow.js içindeki gerçek işlevleri tarayıcısız çalıştırır.
function flowFunction(name) {
  const start = flow.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = flow.indexOf("{", flow.indexOf(")", start)); i < flow.length; i++) {
    if (flow[i] === "{") depth++;
    if (flow[i] === "}" && --depth === 0) return flow.slice(start, i + 1);
  }
  throw Error(name);
}
function flowHarness(names, state) {
  const body = `${names.map(flowFunction).join("\n")}\nreturn { ${names.join(", ")}, get state() { return { draft, frozen, accepted, serviceAccepted, distanceError }; } };`;
  const args = Object.keys(state);
  return new Function(...args, body)(...args.map(key => state[key]));
}
const fullOrder = () => ({ ...R.newDraft(), express: true, payment: "bank_transfer", promotion: { code: "HOS", percent: 10 },
  items: [{ ...item(), client_item_id: "40000000-0000-4000-8000-000000000001", branch: "Şube", product_name: "Ürün", size: "M", color: "Siyah", product_link: "https://example.com/a" }],
  address: { district: "Tuzla", different_region_selected: true, location_source: "map", customer_name: "Test Kişi", customer_phone: "05321234567", neighborhood: "Merkez", address_line: "Cadde", building_no: "1", building_name: "Bina", directions: "Tarif", latitude: 41.07, longitude: 28.99 } });

test("validity is measured from the local receipt moment, so a wrong device clock does not matter", () => {
  const value = draft(), receivedAt = Date.parse("2026-11-19T12:00:00Z");
  const row = { ...quoteRow(), expires_at: "2026-11-19T11:00:00Z", expires_in_seconds: 1800 };
  value.distanceQuote = R.distanceQuote(row, R.distanceQuoteKey(value), receivedAt);
  assert.equal(R.activeDistanceQuote(value, receivedAt).fee, 20);
  assert.equal(R.activeDistanceQuote(value, receivedAt + 1739000).fee, 20);
  assert.equal(R.activeDistanceQuote(value, receivedAt + 1740000), null);
  assert.equal(R.activeDistanceQuote(value, receivedAt - 3600000), null);
});

test("without expires_in_seconds the old device clock check stays", () => {
  const value = draft(); value.distanceQuote = R.distanceQuote(quoteRow(), R.distanceQuoteKey(value));
  assert.equal("received_at" in value.distanceQuote, false);
  assert.equal(R.activeDistanceQuote(value).fee, 20);
  assert.equal(R.activeDistanceQuote(value, Date.now() + 1800000), null);
});

test("a malformed remaining time is rejected", () => {
  const key = R.distanceQuoteKey(draft());
  for (const expires_in_seconds of [-1, 1.5, "1800"]) assert.throws(() => R.distanceQuote({ ...quoteRow(), expires_in_seconds }, key));
});

test("finding 4: contract and expected amount keep the fee after the quote window passes", async () => {
  const order = fullOrder(); order.promotion = null;
  order.distanceQuote = R.distanceQuote({ ...quoteRow(), expires_in_seconds: 30 }, R.distanceQuoteKey(order));
  assert.equal(R.activeDistanceQuote(order), null);
  assert.equal(R.quotedDistanceFee(order), 20);
  assert.equal(R.quotedDistanceFee({ ...order, address: { ...order.address, latitude: 41.08 } }), 0);
  const catalog = { order: [{ document_type: "pre_information", document_version: "2026-11-17-model-b-10", transaction_model: "company_seller", title: "Ön", template: "S={{SERVICE_TOTAL}}" }] };
  assert.equal((await R.documents(order, catalog, "a@example.com", [])).at(0).content, "S=470");
  assert.ok(flow.includes("R.differentRegion(snapshot.address), R.quotedDistanceFee(snapshot)).total"));
});

test("finding 9: a returned request after a page reload restores the cart", () => {
  const order = fullOrder(), payload = R.payload(order, []);
  const reloaded = { requestID: order.requestID, createdAt: order.createdAt, items: [], address: {}, express: true, promotion: order.promotion };
  const restored = R.draftFromFrozen(reloaded, payload);
  assert.deepEqual(restored.items, order.items);
  assert.equal(restored.requestID, order.requestID);
  assert.equal(restored.payment, "bank_transfer");
  assert.equal(restored.promotion.code, "HOS");
  assert.equal(R.differentRegion(restored.address), true);
  assert.equal("summary" in restored.address || "is_different_region" in restored.address, false);
  assert.doesNotThrow(() => R.validateAddress(restored.address));
  assert.equal(R.distanceQuoteKey(restored), R.distanceQuoteKey(order));
  assert.equal(R.draftFromFrozen(order, payload), order);
});

test("finding 9: the rejected-quote branch returns to a full cart", async () => {
  const order = fullOrder(), payload = R.payload(order, []);
  let shown = null;
  const harness = flowHarness(["releaseFrozen", "sendFrozen"], {
    R, draft: { requestID: order.requestID, createdAt: order.createdAt, items: [], address: {}, express: true, promotion: order.promotion },
    frozen: { payload, rpcName: "create_customer_order_v9", expectedAmount: 1 }, accepted: [], serviceAccepted: true, distanceError: "x", offer: null, epoch: 1,
    profile: { full_name: "Test Kişi", phone: "+905321234567" }, host: { checkRuntime: async () => true }, allowed: () => true,
    rpc: async () => [{ result: "distance_quote_expired" }], save: () => true, updateCartCount() {}, cartPage() {}, message: text => { shown = text; }
  });
  await harness.sendFrozen(1);
  const { draft: result, frozen, accepted, serviceAccepted } = harness.state;
  assert.equal(frozen, null); assert.equal(accepted, null); assert.equal(serviceAccepted, false);
  assert.equal(result.items.length, 1); assert.equal(result.buyer.full_name, "Test Kişi");
  assert.match(shown, /yenilendi/);
});

test("finding 10: a fee change during submit redraws the payment page", async () => {
  let draws = 0, shown = null;
  const order = fullOrder(); order.distanceQuote = { key: "eski", quote_id: "x", fee: 20, expires_at: "2026-01-01T00:00:00Z" };
  const harness = flowHarness(["submitOrder"], {
    R, draft: order, frozen: null, busy: false, epoch: 1, accepted: [], serviceAccepted: true, referenceEnabled: false, draftLease: null, owner: "o", distanceError: "",
    productPanel: {}, cartPanel: {}, showBack() {}, allowed: () => true, host: { checkRuntime: async () => true },
    loadDistanceQuote: async () => ({ fee: 30 }), cartPage() { draws++; }, message: text => { shown = text; }
  });
  await harness.submitOrder();
  assert.equal(draws, 1);
  assert.match(shown, /güncellendi/);
});

test("finding 11: a fresh quote that still counts as expired stops automatic requests", async () => {
  let calls = 0, value = draft();
  const state = { R, draft: value, owner: "o", epoch: 1, frozen: null, busy: false, checkout: true, currentView: "cart", accepted: [], serviceAccepted: true, distanceError: "", distanceLoading: null,
    save() {}, cartPage() {}, host: { api: async () => { calls++; return { ...quoteRow(), expires_at: new Date(Date.now() - 3600000).toISOString() }; } } };
  const harness = flowHarness(["loadDistanceQuote"], state);
  assert.equal(await harness.loadDistanceQuote(), null);
  assert.equal(calls, 1);
  assert.match(harness.state.distanceError, /saatini kontrol/);
  assert.ok(flow.includes("if (!distanceReady && !distanceError && !distanceLoading) void loadDistanceQuote();"));
});

test("finding 11: a skewed device clock still gets a usable quote from the remaining time", async () => {
  const value = draft();
  const harness = flowHarness(["loadDistanceQuote"], { R, draft: value, owner: "o", epoch: 1, frozen: null, busy: false, checkout: true, currentView: "cart", accepted: null, serviceAccepted: false, distanceError: "", distanceLoading: null,
    save() {}, cartPage() {}, host: { api: async () => ({ ...quoteRow(), expires_at: new Date(Date.now() - 3600000).toISOString(), expires_in_seconds: 1800 }) } });
  assert.equal((await harness.loadDistanceQuote()).fee, 20);
  assert.equal(harness.state.distanceError, "");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../hesabim/order-rules.js");

const item = (store = "Zara") => ({ store, estimated_price: 100 });
const address = (extra = {}) => ({ customer_name: "Test Kişi", customer_phone: "05321234567", neighborhood: "Merkez", address_line: "Cadde", building_no: "1", building_name: "Bina", directions: "Tarif", latitude: 41, longitude: 29, ...extra });

test("different region starts at 783 TL for both delivery options and keeps extra fees", () => {
  assert.equal(R.totals([item()], true, 0, false, true).service, 783);
  assert.equal(R.totals([item()], false, 0, false, true).service, 783);
  assert.equal(R.totals([item(), item("Mango")], true, 0, false, true).service, 889);
  assert.equal(R.totals([item(), item()], false, 0, false, true).service, 819);
  assert.equal(R.totals([item()], true).service, 360);
});

test("a typed district is accepted outside the service area", () => {
  const value = address({ district: "Kadıköy", different_region_selected: true });
  assert.equal(R.validateAddress(value), true);
  assert.equal(R.differentRegion(value), true);
  assert.equal(R.differentRegion(address({ district: "Şişli" })), false);
});

test("empty or service-area names are rejected in different region mode", () => {
  assert.throws(() => R.validateAddress(address({ district: "", different_region_selected: true })), { message: "İlçe adını yaz." });
  assert.throws(() => R.validateAddress(address({ district: "Şişli", different_region_selected: true })), { message: "Bu ilçeyi listeden seç." });
  assert.throws(() => R.validateAddress(address({ district: "" })), { message: "İlçe seç." });
});

test("payload tells the server the same region class and drops the form marker", () => {
  const draft = { ...R.newDraft(), express: true, address: address({ district: " Kadıköy ", different_region_selected: true }) };
  const outside = R.payload(draft, []).delivery_address;
  assert.equal(outside.district, "Kadıköy");
  assert.equal(outside.is_different_region, true);
  assert.equal("different_region_selected" in outside, false);
  draft.address = address({ district: "Beşiktaş" });
  assert.equal(R.payload(draft, []).delivery_address.is_different_region, false);
});

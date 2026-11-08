const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../hesabim/order-rules.js");
const legal = require("../assets/legal-v6.json");
const { stores } = require("../assets/order-catalog.json");
test("short reference belongs to one owner/draft and does not change the idempotency UUID", async () => {
  const d = draft(), owner = crypto.randomUUID(), originalID = d.requestID;
  d.checkoutReference = { owner, requestID: originalID, code: "000123" };
  assert.equal(R.referenceCode(d, owner), "000123"); assert.equal(R.referenceCode(d, crypto.randomUUID()), null);
  const docs = await R.documents(d, legal, "test@example.invalid", stores);
  assert.ok(docs.every(doc => doc.content.includes("000123") && !doc.content.includes(originalID)));
  assert.equal(R.payload(d, docs).p_client_request_id, originalID);
  d.requestID = crypto.randomUUID(); assert.equal(R.referenceCode(d, owner), null);
});
test("reservation must be authorized, numeric and identify existing orders", () => {
  assert.equal(R.reservation({ authorized: true, result: "reserved", reference_code: "000123" }).reference_code, "000123");
  for (const row of [{ authorized: false, result: "reserved", reference_code: "000123" },
    { authorized: true, result: "reserved", reference_code: "123<script>" },
    { authorized: true, result: "already_created", reference_code: "000123" }]) assert.throws(() => R.reservation(row));
});
function item(extra = {}) {
  return { client_item_id: crypto.randomUUID(), store: "Beymen", branch: "Test Şube", product_name: "Test ürün",
    size: "M", color: "Siyah", estimated_price: 100, product_link: "https://example.com/product", image_data_base64: null,
    store_latitude: 41.07, store_longitude: 29, ...extra };
}
function draft() {
  return { ...R.newDraft(), express: true, items: [item()], address: { customer_name: "Test Müşteri", customer_phone: "05301234567",
    district: "Şişli", neighborhood: "Test", address_line: "Test Sokak", building_no: "1", building_name: "Test bina kat 1 daire 2",
    directions: "Test kapı", latitude: 41.07, longitude: 29 } };
}
test("33 native stores; exact fee parity including each additional store and product", () => {
  assert.equal(stores.length, 33);
  assert.deepEqual(R.totals([item()], true), { products: 100, service: 360, discount: 0, total: 460, stores: 1 });
  assert.equal(R.totals([item()], false).service, 288);
  assert.equal(R.totals([item(), item({ store: "Zara" })], true).service, 466);
  assert.equal(R.totals([item(), item()], true).service, 396);
  assert.equal(R.totals([item()], true, 10).discount, 36);
  assert.equal(R.totals([item()], false, 100).total, 100);
});
for (const [name, bad] of Object.entries({ "unselected store": { store: "" }, "zero price": { estimated_price: 0 }, "fraction price": { estimated_price: 1.5 },
  "script URL": { product_link: "javascript:alert(1)" }, "credential URL": { product_link: "https://user:pass@example.com" },
  "missing photo/link": { product_link: "" }, "missing coordinates": { store_latitude: null }, "infinite coordinates": { store_latitude: Infinity }, "color number": { color: "123" }, "SVG as photo": { image_data_base64: "PHN2Zz4=" } })) {
  test(`reject ${name}`, () => assert.throws(() => R.validateItem(item(bad), stores)));
}
test("missing product fields identify only the field that needs completing", () => {
  for (const [key, label] of [["branch", "Mağaza şubesi"], ["product_name", "Ürün"], ["size", "Beden / boyut"], ["color", "Renk"]]) {
    assert.throws(() => R.validateItem(item({[key]:""})), {message:`${label} alanını doldur.`});
    assert.throws(() => R.validateItem(item({[key]:"X".repeat(201)})), {message:`${label} en fazla 200 karakter olabilir.`});
  }
});
test("pickup names preserve searched branches and label unnamed map pins truthfully", () => {
  assert.equal(R.pickupBranch("Beymen", "  Beymen Test Şube  "), "Beymen Test Şube");
  assert.equal(R.pickupBranch("Beymen"), "Beymen · Haritadan seçilen konum");
  assert.equal(R.pickupBranch("Beymen", null), "Beymen · Haritadan seçilen konum");
  assert.equal(R.pickupBranch("Beymen", "X".repeat(250)).length, 200);
});
test("missing delivery fields identify only the unfilled address field", () => {
  for (const [key, label] of [["customer_name", "Alıcı adı soyadı"], ["customer_phone", "Alıcı cep telefonu"], ["neighborhood", "Mahalle"], ["address_line", "Cadde / sokak"], ["building_no", "Bina numarası"], ["building_name", "Bina adı, kat ve daire"], ["directions", "Adres tarifi"]]) {
    const address = {...draft().address, [key]:""};
    assert.throws(() => R.validateAddress(address), {message:`${label} alanını doldur.`});
  }
});
test("delivery point, district and address completeness are mandatory", () => {
  assert.equal(R.validate(draft(), stores), true);
  for (const update of [{ latitude: null }, { district: "Kadıköy" }, { building_no: "" }, { directions: "" }, { customer_phone: "123" }]) {
    const d = draft(); Object.assign(d.address, update); assert.throws(() => R.validate(d, stores));
  }
  const d = draft(); d.items = Array.from({ length: 31 }, () => item()); assert.throws(() => R.validate(d, stores));
});
test("custom stores use bounded plain text and retain native item numbering", () => {
  assert.equal(R.validateItem(item({ store: "Yerel Mağaza" })).store, "Yerel Mağaza");
  for (const store of [" ", " Mağaza", "Mağaza ", "<script>", "Mağaza\nAdı", "X".repeat(101)]) assert.throws(() => R.validateItem(item({ store })));
  assert.equal(R.productName([], "Beymen"), "Ürün 1");
  assert.equal(R.productName([item(), item({ store: "Zara" })], "Beymen"), "Ürün 2");
});
test("multi-store checkout requires products for each selected store", () => {
  const d = draft(); d.selectedStores = ["Beymen", "Zara"];
  assert.deepEqual(R.missingStores(d), ["Zara"]);
  assert.throws(() => R.validate(d, stores), /Zara/);
  d.items.push(item({ store: "Zara" }));
  assert.equal(R.validate(d, stores), true);
  assert.equal(R.totals(d.items, true).service, 466);
  d.selectedStores = "Beymen";
  assert.throws(() => R.validate(d, stores));
});
test("canonical legal bytes, versions and SHA-256 are preserved, personalized values have no placeholders", async () => {
  for (const doc of legal.profile) assert.equal(await R.hash(doc.p_document_text), doc.p_document_hash);
  const d = draft(); const docs = await R.documents(d, legal, "test@example.invalid", stores);
  assert.equal(docs.length, 4);
  for (const doc of docs) {
    assert.equal(doc.document_version, "2026-10-22-model-b-6");
    assert.equal(doc.content_hash, await R.hash(doc.content));
    assert.ok(!doc.content.includes("{{"));
  }
  assert.equal(docs.filter((doc) => doc.content.includes("0530 673 02 11")).length, 2);
  const payload = R.payload(d, docs);
  assert.equal(payload.p_client_request_id, d.requestID);
  assert.equal(payload.payment_method, "bank_transfer");
  assert.equal(payload.delivery_address.customer_phone, "+905301234567");
  assert.equal("customer_total" in payload, false);
  payload.items[0].product_name = "mutated"; assert.notEqual(d.items[0].product_name, "mutated");
  d.address.building_no = "2";
  assert.notEqual((await R.documents(d, legal, "test@example.invalid", stores))[0].content_hash, docs[0].content_hash);
});
test("uncertain, rejected and mismatched responses never mean paid", () => {
  assert.throws(() => R.result({ authorized: false, result: "unauthorized" }, 460));
  assert.throws(() => R.result({ authorized: true, result: "success", order_id: "invalid", amount: 460, transfer_code: "X" }, 460));
  const row = { authorized: true, result: "already_created", order_id: crypto.randomUUID(), amount: 460, transfer_code: "TEST" };
  assert.equal(R.result(row, 460).amountChanged, false);
  assert.equal(R.result(row, 100).amountChanged, true);
  assert.equal("paid" in R.result(row, 460), false);
});
test("checkout starts without implicit delivery/payment or fee; recipient differs from legal buyer", async () => {
  const empty = R.newDraft(); assert.equal(empty.express, null); assert.equal(empty.payment, null);
  assert.equal(R.totals([item()], null).service, 0);
  const d = draft(); d.buyer = { full_name: "Buyer Legal", phone: "+447700900123" };
  d.address.customer_name = "Recipient Other";
  const docs = await R.documents(d, legal, "buyer@example.invalid", stores);
  assert.ok(docs.some(doc => doc.content.includes("Buyer Legal")));
  assert.ok(!docs.some(doc => doc.content.includes("Recipient Other")));
  assert.equal(R.payload(d, docs).delivery_address.customer_name, "Recipient Other");
  d.express = null; await assert.rejects(R.documents(d, legal, "buyer@example.invalid", stores));
  assert.throws(() => R.payload(d, docs));
});
test("name and international telephone fields are reversible, including incomplete drafts", () => {
  const countries = require("../assets/phone-countries.json").countries;
  assert.deepEqual(R.splitName("Test Multiple Surname"), { firstName: "Test", lastName: "Multiple Surname" });
  assert.equal(R.joinedPhone("+90", "0530 123 45 67"), "+905301234567");
  assert.equal(R.joinedPhone("+44", "7700900123"), "+447700900123");
  assert.deepEqual(R.splitPhone("+90530", countries), { code: "+90", number: "530" });
  assert.equal(R.joinedPhone("+90", "abc"), null);
});
test("courier positions require fresh capture AND receipt and bounded accuracy", () => {
  const now = Date.now();
  const p = { latitude: 41, longitude: 29, accuracy_meters: 10, captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString() };
  assert.equal(R.freshPosition(p, now), true);
  for (const bad of [{ captured_at: new Date(now - 121000).toISOString() }, { received_at: new Date(now - 121000).toISOString() }, { captured_at: new Date(now + 6000).toISOString() }, { accuracy_meters: 501 }, { latitude: NaN }, { received_at: null }]) assert.equal(R.freshPosition({ ...p, ...bad }, now), false);
});
test("client stays fixed-origin, no privileged credential or direct order writes; local logout only", () => {
  const account = fs.readFileSync(path.join(__dirname, "../hesabim/hesabim.js"), "utf8");
  const flow = fs.readFileSync(path.join(__dirname, "../hesabim/order-flow.js"), "utf8");
  assert.ok(account.includes("/auth/v1/logout?scope=local"));
  assert.ok(account.includes('redirect: "error"'));
  assert.ok(account.includes("generation !== state.generation"));
  assert.ok(flow.includes('rpc("create_customer_order_v7", frozen.payload)'));
  assert.ok(!flow.includes('localStorage.setItem'));
  assert.ok(!flow.includes('innerHTML'));
  assert.ok(!account.includes('innerHTML'));
  assert.ok(!/card_number|cvv|merchant_password/i.test(flow));
});
test('clipboard links accept shared text and www but reject unsafe or excessive content', () => {
  assert.equal(R.clipboardLink('  https://www.beymen.com/product  '), 'https://www.beymen.com/product');
  assert.equal(R.clipboardLink('Ürüne bak\nhttps://www.beymen.com/product'), 'https://www.beymen.com/product');
  assert.equal(R.clipboardLink('https://www.beymen.com/product Ürüne bak'), 'https://www.beymen.com/product');
  assert.equal(R.clipboardLink('www.beymen.com/product'), 'https://www.beymen.com/product');
  for (const value of ['', null, 'javascript:alert(1)', 'https://user:password@example.com', 'x'.repeat(8193)]) assert.equal(R.clipboardLink(value), null);
});

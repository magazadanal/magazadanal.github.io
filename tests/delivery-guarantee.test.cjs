const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../hesabim/order-rules.js');
const {stores} = require('../assets/order-catalog.json');
const v10 = require('../assets/legal-v10.json');
const item = () => ({client_item_id: crypto.randomUUID(), store: 'Beymen', product_name: 'Ürün 1', estimated_price: 1000, branch: 'Test Şubesi', size: 'M', color: 'Siyah', product_link: 'https://example.invalid/p', store_latitude: 41.07, store_longitude: 29});
const draft = extra => ({...R.newDraft(), express: true, payment: 'bank_transfer', items: [item()],
  address: {customer_name: 'Test Alıcı', customer_phone: '+905300000000', district: 'Şişli', neighborhood: 'Test', address_line: 'Test', building_no: '1', building_name: 'Test', directions: 'Test', latitude: 41.07, longitude: 29}, ...extra});
// Mocked v11 catalog: the real assets/legal-v11.json is created separately.
const v11 = {order: v10.order.map(d => ({...d, document_version: '2026-11-18-model-b-11', template: d.template + '\n{{DELIVERY_GUARANTEE}}\nToplam: {{GRAND_TOTAL}} / Hizmet: {{SERVICE_TOTAL}}'}))};

test('fee is 360 per order, added after the promotion, never discounted', () => {
  const base = R.totals([item()], true, 50);
  const g = R.totals([item()], true, 50, true);
  assert.equal(g.guarantee, 360); assert.equal(g.discount, base.discount); assert.equal(g.service, base.service);
  assert.equal(g.total, base.total + 360);
  assert.equal(R.totals([item(), item()], true, 0, true).guarantee, 360);
  assert.equal(R.totals([item()], true, 0).guarantee, 0);
  assert.equal(R.totals([], true, 0, true).guarantee, 0);
});
test('payload: v7 shape unchanged unless offered; v8 adds p_delivery_guarantee only', async () => {
  const d = draft({deliveryGuarantee: true});
  const docs = await R.documents(d, v11, 'a@b.invalid', stores);
  const v7 = R.payload(d, docs), v8 = R.payload(d, docs, true);
  assert.ok(!('p_delivery_guarantee' in v7));
  assert.equal(v8.p_delivery_guarantee, true);
  const {p_delivery_guarantee, ...rest} = v8; assert.deepEqual(rest, v7);
  assert.equal(R.payload(draft(), docs, true).p_delivery_guarantee, false);
});
test('v11 placeholder and totals in documents', async () => {
  const on = await R.documents(draft({deliveryGuarantee: true}), v11, 'a@b.invalid', stores);
  const off = await R.documents(draft(), v11, 'a@b.invalid', stores);
  assert.ok(on[0].content.includes('Teslimat Güvencesi (sipariş başına, KDV dahil): 360,00 TL'));
  assert.ok(on[0].content.includes('Toplam: 1720 / Hizmet: 360'));
  assert.ok(off[0].content.includes('Teslimat Güvencesi: Seçilmedi'));
  assert.ok(off[0].content.includes('Toplam: 1360 / Hizmet: 360'));
  for (const doc of on) assert.equal(doc.document_version, '2026-11-18-model-b-11');
});
test('v10 documents are unaffected by the new placeholder', async () => {
  const docs = await R.documents(draft({deliveryGuarantee: true}), v10, 'a@b.invalid', stores);
  assert.ok(docs.every(d => !d.content.includes('{{')));
});
test('client wiring: lazy v11 only when offer enabled, offer row, unavailable status, order detail, no CSP change needed', () => {
  const flow = fs.readFileSync(path.join(__dirname, '../hesabim/order-flow.js'), 'utf8');
  const account = fs.readFileSync(path.join(__dirname, '../hesabim/hesabim.js'), 'utf8');
  assert.ok(flow.includes('/assets/legal-v11.json') && flow.includes('row?.enabled === true'));
  assert.ok(!/Promise\.all\(\[[^\]]*legal-v11/.test(flow));
  assert.ok(flow.includes('Teslimat Güvencesi — ') && flow.includes('Sigorta değildir; yasal haklarınız saklıdır.'));
  assert.ok(flow.includes('delivery_guarantee_unavailable'));
  assert.ok(flow.includes('box.checked = draft.deliveryGuarantee === true'));
  assert.ok(account.includes('delivery_guarantee_selected,delivery_guarantee_fee') && account.includes('order.delivery_guarantee_selected === true'));
  const headers = fs.readFileSync(path.join(__dirname, '../_headers'), 'utf8');
  assert.ok(headers.includes("connect-src 'self' wss://") && headers.includes('/assets/*'));
});

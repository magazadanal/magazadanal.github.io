// Kilometre ücreti: v13 order documents carry the user-approved text word for word.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('../hesabim/order-rules.js');
const v10 = require('../assets/legal-v10.json');
const v13 = require('../assets/legal-v13.json');

const VERSION = '2026-11-19-model-b-13';
const CLAUSE = "Teslimat mesafesi 5 km'ye kadar olan siparişlerde mesafe için ek bedel alınmaz. 5 km'yi aşan her tam kilometre için KDV dahil 10 TL, hizmet ve teslimat bedeline dahil edilir. Mesafe, teslimat noktasına en uzak mağaza ile teslimat noktası arasındaki yol mesafesine göre hesaplanır; yol mesafesi alınamazsa kuş uçuşu mesafenin 1,5 katı esas alınır. Hizmet bölgesi dışındaki adreslerde taban hizmet ve teslimat bedeli KDV dahil 450 TL'dir. Promosyon indirimi mesafeye bağlı bedele uygulanmaz. Siparişin kesin tutarı, onaydan önce ödeme ekranında gösterilir.";
const LINE = 'Hizmet ve teslimat bedeli (KDV dahil): {{SERVICE_TOTAL}} TL';
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('v13 differs from v10 only by the approved text under the service total line', () => {
  assert.deepEqual(v13.profile, v10.profile);
  assert.equal(v13.order.length, 4);
  for (const doc of v13.order) {
    const old = v10.order.find(item => item.document_type === doc.document_type).template;
    assert.equal(doc.document_version, VERSION);
    const expected = ['pre_information', 'distance_contract'].includes(doc.document_type) ? old.replace(LINE, `${LINE}\n${CLAUSE}`) : old;
    assert.equal(doc.template, expected, doc.document_type);
    assert.equal(doc.template.split(LINE).length - 1, old.split(LINE).length - 1, 'the fee line stays single');
  }
});

test('shopping terms page replaced only the old sentence', () => {
  const html = read('alisveris-kosullari/index.html');
  assert.ok(html.includes(`yalnız hizmet ve teslimat bedeline uygulanır. ${CLAUSE}</p>`));
  assert.ok(!html.includes('Kilometre başına ek ücret şu anda uygulanmaz.'));
});

test('order flow and public contracts load v13 with fresh version stamps', () => {
  for (const file of ['hesabim/order-flow.js', 'alisveris-kosullari/conditions.js']) assert.ok(read(file).includes('/assets/legal-v13.json'), file);
  const account = read('hesabim/index.html');
  assert.ok(account.includes('order-rules.js?v=20261119-2') && account.includes('order-flow.js?v=20261119-3'));
  assert.ok(read('alisveris-kosullari/index.html').includes('conditions.js?v=20261119-1'));
});

test('rendered v13 documents show the approved text with the total that includes the distance fee', async () => {
  const draft = {...R.newDraft(), express: true, payment: 'bank_transfer',
    items: [{client_item_id: crypto.randomUUID(), store: 'Beymen', product_name: 'Ürün 1', estimated_price: 1000, branch: 'Test Şubesi', size: 'M', color: 'Siyah', product_link: 'https://example.invalid/p', store_latitude: 41.07, store_longitude: 29}],
    address: {customer_name: 'Test Alıcı', customer_phone: '+905300000000', district: 'Şişli', neighborhood: 'Test', address_line: 'Test', building_no: '1', building_name: 'Test', directions: 'Test', latitude: 41.07, longitude: 29}};
  draft.distanceQuote = {key: R.distanceQuoteKey(draft), quote_id: crypto.randomUUID(), fee: 20};
  const docs = await R.documents(draft, v13, 'test@example.invalid', ['Beymen']);
  for (const doc of docs.slice(0, 2)) assert.ok(doc.content.includes(`Hizmet ve teslimat bedeli (KDV dahil): 380 TL\n${CLAUSE}\nPromosyon indirimi: 0 TL`), doc.document_type);
  assert.ok(docs.every(doc => doc.document_version === VERSION && !doc.content.includes('{{')));
  assert.ok(docs[0].content.includes('Ürün linki: https://example.invalid/p'), 'v13 keeps the detailed product lines');
});

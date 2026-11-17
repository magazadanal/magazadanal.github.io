const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const R = require('../hesabim/order-rules.js');
const current = require('../assets/legal-v10.json');
const v9 = require('../assets/legal-v9.json');
const {stores} = require('../assets/order-catalog.json');
const version = '2026-11-17-model-b-10';
const hash = text => createHash('sha256').update(text).digest('hex');
// User-approved v10 wording (devir/MESAJLASMA_PLANI.md, "v10 metinleri — KULLANICI ONAYLADI"); must stay word for word.
const SHARING = 'Siparişinizin yerine getirilmesi için gerekli olduğu ölçüde; ilgili siparişte görevli kurye veya anlaşmalı kurye firmasının yetkili personeline şu bilgileriniz paylaşılabilir: alıcının ad ve soyadı, teslimat adresi (mahalle, sokak, kapı numarası, bina adı, adres tarifi, ilçe ve il), kesin teslimat konumu, cep telefonu numarası, ürün bilgileri (ürün adı, bağlantısı, beden, renk, alternatif tercihi, ürün fotoğrafı ve sipariş notu), mağaza bilgileri (ad, şube ve konum) ve siparişe ilişkin uygulama içi mesajlarınız. E-posta adresiniz, kimlik ve vergi numaranız, fatura bilgileriniz ve ödeme bilgileriniz kuryeye gösterilmez.';
const MESSAGES = 'Teslimat sırasında görevli kurye size uygulama içinden yazarsa, siparişiniz teslim edilene kadar yanıtlayabilirsiniz. Mesajlarınız; teslimatın yürütülmesi, olası anlaşmazlık ve şikâyetlerin incelenmesi, dolandırıcılığın önlenmesi ve hizmet güvenliğinin sağlanması amacıyla kaydedilir. Mesajları sizin, ilgili kuryenin ve Mağazadan AL yetkili yöneticilerinin görmesi mümkündür; yöneticiler gerektiğinde konuşmaya katılabilir veya kuryenin konuşmaya erişimini kapatabilir. Güvenliğiniz için mesajlarda bağlantı, IBAN, telefon numarası, fotoğraf ve dosya paylaşılamaz. Mesajlar 3 yıl saklanır ve bu sürenin sonunda silinir veya anonim hale getirilir.';
const OLD_SHARING = 'Hizmetin yürütülmesi için gerekli fotoğraf, mağaza ve teslimat konumu, ad ve soyad, adres, cep telefonu ve diğer hizmet bilgileri;';
const texts = () => [...current.profile.map(r => [r.p_document_type, r.p_document_text]), ...current.order.map(r => [r.document_type, r.template])];

test('every document carries the approved sharing sentence word for word and no old sentence', () => {
  assert.equal(texts().length, 7);
  assert.ok(current.service_data_notice.includes(SHARING));
  for (const [type, text] of texts()) { assert.ok(text.includes(SHARING), type); assert.ok(!text.includes(OLD_SHARING), type); }
});
test('approved in-app message clause is in notices, membership, privacy and the two sale documents', () => {
  for (const [type, text] of texts()) {
    const expected = ['cancellation_return', 'service_start'].includes(type) ? false : true;
    assert.equal(text.includes('Uygulama içi mesajlar\n\n' + MESSAGES), expected, type);
  }
});
test('v10 versions and hashes; v8/v9 catalogs stay as they were', () => {
  for (const row of current.profile) {
    assert.equal(row.p_document_version, version);
    assert.equal(hash(row.p_document_text), row.p_document_hash);
    assert.notEqual(row.p_document_hash, v9.profile.find(p => p.p_document_type === row.p_document_type).p_document_hash);
  }
  for (const row of current.order) assert.equal(row.document_version, version);
  for (const row of v9.order) assert.equal(row.document_version, '2026-11-13-model-b-9');
  for (const row of v9.profile) assert.equal(row.p_document_version, '2026-11-08-model-b-8');
});
test('courier phone wording stays at the v9 wording (no delivery-stage detail)', () => {
  for (const r of [...current.profile.map(p => p.p_document_text), ...current.order.map(o => o.template)])
    assert.ok(!r.includes('teslimat aşamasında'));
  const privacy = current.profile.find(p => p.p_document_type === 'privacy').p_document_text;
  assert.ok(privacy.includes('telefon'));
});
test('public privacy page and web clients use v10', () => {
  const html = fs.readFileSync(path.join(__dirname, '../privacy/index.html'), 'utf8');
  assert.ok(html.includes(version));
  assert.ok(html.includes(`<p>${SHARING}</p>`) || html.includes(SHARING));
  assert.ok(html.includes('<h2>10. Uygulama içi mesajlar</h2>') && html.includes(`<p>${MESSAGES}</p>`));
  assert.ok(!html.includes(OLD_SHARING));
  for (const file of ['hesabim/order-flow.js', 'alisveris-kosullari/conditions.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(source.includes('/assets/legal-v10.json'));
    assert.ok(!source.includes('/assets/legal-v9.json'));
  }
});
test('v10 order snapshots keep detailed products and estimated delivery label, and include the new clauses', async () => {
  const d = {...R.newDraft(), express: true, payment: 'bank_transfer',
    items: [{client_item_id: crypto.randomUUID(), store: 'Beymen', product_name: 'Ürün 1', estimated_price: 1000, branch: 'Test Şubesi', size: 'M', color: 'Siyah', product_link: 'https://example.invalid/p', store_latitude: 41.07, store_longitude: 29}],
    address: {customer_name: 'Test Alıcı', customer_phone: '+905300000000', district: 'Şişli', neighborhood: 'Test', address_line: 'Test', building_no: '1', building_name: 'Test', directions: 'Test', latitude: 41.07, longitude: 29}};
  const docs = await R.documents(d, current, 'test@example.invalid', stores);
  for (const doc of docs) { assert.equal(doc.document_version, version); assert.ok(!doc.content.includes('{{')); assert.ok(doc.content.includes(SHARING)); assert.equal(doc.content_hash, hash(doc.content)); }
  assert.ok(docs[0].content.includes('Teslimat seçeneği: 1-3 saatte teslim (Tahmini)'));
  assert.ok(docs[0].content.includes('Mağaza şubesi: Test Şubesi'));
  assert.ok(docs[0].content.includes(MESSAGES) && docs[1].content.includes(MESSAGES));
});

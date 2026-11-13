const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../hesabim/order-rules.js');
const current = require('../assets/legal-v9.json');
const previous = require('../assets/legal-v8.json');
const {stores} = require('../assets/order-catalog.json');
const fs = require('node:fs');
const path = require('node:path');

function draft(express = true) {
  return {...R.newDraft(), express, payment: 'bank_transfer',
    items: [{client_item_id:crypto.randomUUID(),store:'Beymen',product_name:'Ürün 1',estimated_price:1000,
      branch:'Beymen Test Şubesi',size:'M',color:'Siyah',product_link:'https://example.invalid/product',
      order_note:'Dikişleri kontrol edin.\nEtiketi koruyun.',store_latitude:41.07,store_longitude:29}],
    address:{customer_name:'Test Alıcı',customer_phone:'+905300000000',district:'Şişli',neighborhood:'Test Mahallesi',
      address_line:'Test Sokak',building_no:'1',building_name:'Test Bina',directions:'Test kapı',latitude:41.07,longitude:29}};
}
test('both checkout options explicitly say estimated while authoritative wire codes stay unchanged', async () => {
  for (const express of [true,false]) {
    const label = express ? 'Tahmini 1–3 saatte teslim' : 'Tahmini gün içinde teslim';
    assert.equal(R.deliveryLabel(express), label);
    const d = draft(express), docs = await R.documents(d,current,'test@example.invalid',stores);
    const payload = R.payload(d,docs);
    assert.equal(payload.delivery_option, express ? '1-3 saatte teslim' : 'Gün içinde teslim');
    assert.equal(R.totals(d.items,express).service,express ? 360 : 288);
    for (const doc of docs.slice(0,2)) {
      assert.ok(doc.content.includes('Teslimat seçeneği: '+label));
      assert.ok(doc.content.includes('Kanuni azami süre (teslimat seçeneği değildir):'));
      assert.ok(doc.content.includes('siparişi otuz gün bekletme hakkı'));
    }
  }
  assert.throws(()=>R.deliveryLabel(null));
});
test('basic product details appear as plain contract text without reintroducing alternative inputs', async () => {
  const d = draft(), line = R.legalProductLine(d.items[0]);
  for (const text of ['Beymen / Ürün 1: 1000 TL','Mağaza şubesi: Beymen Test Şubesi','Beden / boyut: M','Renk: Siyah',
    'Ürün linki: https://example.invalid/product','Sipariş notu: Dikişleri kontrol edin.\nEtiketi koruyun.']) assert.ok(line.includes(text));
  const before = (await R.documents(d,current,'test@example.invalid',stores))[0];
  assert.ok(before.content.includes('1. '+line));
  for (const key of ['branch','size','color','product_link','order_note']) {
    const changed = R.clone(d); changed.items[0][key] += 'x';
    if (key === 'product_link') changed.items[0][key] = 'https://example.invalid/other';
    assert.notEqual((await R.documents(changed,current,'test@example.invalid',stores))[0].content_hash,before.content_hash,key);
  }
  d.items[0].product_link = ''; d.items[0].order_note = ''; d.items[0].image_data_base64 = '/9j/AAAA';
  const photo = R.legalProductLine(d.items[0]);
  assert.ok(photo.includes('Ürün fotoğrafı: Sipariş kaydına eklenmiştir.'));
  assert.ok(!photo.includes('/9j/') && !photo.includes('Ürün linki:') && !photo.includes('Sipariş notu:'));
});
test('new order version leaves membership notices and historical v8 rendering unchanged', async () => {
  assert.deepEqual(current.profile,previous.profile);
  for (const doc of current.order) assert.equal(doc.document_version,'2026-11-13-model-b-9');
  const old = await R.documents(draft(),previous,'test@example.invalid',stores);
  assert.ok(old[0].content.includes('1. Beymen / Ürün 1: 1000 TL'));
  assert.ok(!old[0].content.includes('Beden / boyut: M'));
  for (const doc of old) assert.equal(doc.document_version,'2026-11-08-model-b-8');
});
test('public fee labels and contract examples carry the same estimated/maximum distinction', () => {
  const page = fs.readFileSync(path.join(__dirname,'../alisveris-kosullari/index.html'),'utf8');
  assert.ok(page.includes('Tahmini 1–3 saatte teslim · 1 mağaza, 1 ürün'));
  assert.ok(page.includes('Tahmini gün içinde teslim · 1 mağaza, 1 ürün'));
  for (const paragraph of current.order[0].template.split('\n\n').filter(text=>text.startsWith('Teslimat seçenekleri tahmini') || text.startsWith('Kanuni azami süre'))) {
    assert.ok(page.includes('<p>'+paragraph+'</p>'));
  }
  for (const type of ['cancellation_return','service_start']) assert.equal(current.order.find(doc=>doc.document_type===type).template,previous.order.find(doc=>doc.document_type===type).template);
});

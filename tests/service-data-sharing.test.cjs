const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const R = require('../hesabim/order-rules.js');
const current = require('../assets/legal-v8.json');
const previous = require('../assets/legal-v7.json');
const version = '2026-11-08-model-b-8';
const hash = text => createHash('sha256').update(text).digest('hex');

test('all seven documents contain the same explicit service collection and sharing clause', () => {
  assert.equal(current.profile.length + current.order.length, 7);
  const clause = current.service_data_notice;
  for (const word of ['fotoğraf', 'konum', 'ad ve soyad', 'adres', 'cep telefonu', 'diğer hizmet bilgileri', 'toplanır ve işlenir', 'anlaşmalı kurye firması', 'mağaza', 'hizmet sağlayıcılarıyla paylaşılabilir']) assert.ok(clause.includes(word), word);
  assert.ok(clause.includes('her alıcıya tüm bilgiler verilmez'));
  for (const row of current.profile) {
    assert.equal(row.p_document_version, version);
    assert.equal(hash(row.p_document_text), row.p_document_hash);
    assert.ok(row.p_document_text.includes(clause), row.title);
    assert.notEqual(row.p_document_hash, previous.profile.find(p => p.p_document_type === row.p_document_type).p_document_hash);
  }
  for (const row of current.order) {
    assert.equal(row.document_version, version);
    assert.ok(row.template.includes(clause), row.title);
    assert.notEqual(row.template, previous.order.find(p => p.document_type === row.document_type).template);
  }
});

test('proof sharing is explicit without granting automatic app access or coupling consent', () => {
  for (const row of [...current.profile, ...current.order.filter(p => ['pre_information', 'distance_contract'].includes(p.document_type))]) {
    const text = row.p_document_text || row.template;
    assert.ok(text.includes(current.delivery_proof_notice));
    assert.ok(!text.includes('müşteri veya diğer kuryelere açılmaz'));
    assert.ok(text.includes('30 gün'));
  }
  const start = current.order.find(p => p.document_type === 'service_start').template;
  assert.ok(start.startsWith(previous.order.find(p => p.document_type === 'service_start').template));
  assert.ok(start.includes('Hizmete hemen başlama onayı kişisel veri işlemeye ilişkin açık rıza yerine geçmez'));
  assert.ok(current.order.find(p => p.document_type === 'cancellation_return').template.includes('bu hakların kullanımı ayrıca kişisel veri açık rızası verilmesine bağlanmaz'));
});

test('public privacy contains the identical collection, sharing and proof clauses', () => {
  const html = fs.readFileSync(path.join(__dirname, '../privacy/index.html'), 'utf8');
  assert.ok(html.includes(version));
  for (const paragraph of current.service_data_notice.split('\n\n')) assert.ok(html.includes(`<p>${paragraph}</p>`), paragraph);
  assert.ok(html.includes(`<p>${current.delivery_proof_notice}</p>`));
  assert.ok(!html.includes('müşteri veya diğer kuryelere açılmaz'));
});

test('v7 frozen evidence stays unchanged while notices stay v8 and orders select v9', () => {
  const hashes = {kvkk_notice:'e08008c3e0e9c7f3a140632b7e55728c89c20cb5aa0c2458bacd1945084a9734', membership:'6c7bc8ae2f27768b5f3469305a207c3e6298a925529fd2420a2a796d39234fbc', privacy:'96656adb58eadc4dec0c65d9abf8073358e7ea4701e77f1631d885177af340ea'};
  for (const row of previous.profile) assert.equal(hash(row.p_document_text), hashes[row.p_document_type]);
  for (const file of ['hesabim/order-flow.js', 'alisveris-kosullari/conditions.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(source.includes('/assets/legal-v9.json'));
    assert.ok(!source.includes('/assets/legal-v7.json'));
  }
});

test('v8 order snapshots personalize and hash all four documents including service data', async () => {
  const draft = R.newDraft(); draft.express = true; draft.payment = 'bank_transfer';
  draft.items = [{client_item_id:randomUUID(),store:'Beymen',branch:'Synthetic',product_name:'Ürün 1',size:'M',color:'Siyah',estimated_price:100,product_link:'https://example.invalid/product',store_latitude:41.07,store_longitude:28.99}];
  draft.address = {customer_name:'Synthetic Customer',customer_phone:'+905300000000',district:'Şişli',neighborhood:'Synthetic',address_line:'Synthetic',building_no:'1',building_name:'Synthetic',directions:'Synthetic',latitude:41.07,longitude:28.99};
  const docs = await R.documents(draft,current,'synthetic@example.invalid',require('../assets/order-catalog.json').stores);
  for (const row of docs) {
    assert.equal(row.document_version, version);
    assert.equal(row.content_hash, hash(row.content));
    assert.ok(!row.content.includes('{{'));
    assert.ok(row.content.includes(current.service_data_notice));
  }
});

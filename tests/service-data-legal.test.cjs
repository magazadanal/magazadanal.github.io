const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const R = require('../hesabim/order-rules.js');
const current = require('../assets/legal-v7.json');
const previous = require('../assets/legal-v6.json');
const version = '2026-11-08-model-b-7';
const hash = text => createHash('sha256').update(text).digest('hex');
test('new service-data legal package has canonical text hashes and a separate version', () => {
  for (const row of current.profile) {
    assert.equal(row.p_document_version, version);
    assert.equal(hash(row.p_document_text), row.p_document_hash);
    assert.notEqual(row.p_document_hash, previous.profile.find(p => p.p_document_type === row.p_document_type).p_document_hash);
    for (const text of ['ad ve soyad', 'cep telefonu', 'fotoğraf', 'konum', '30 gün']) assert.ok(row.p_document_text.toLocaleLowerCase('tr-TR').includes(text), text);
  }
  const notice = current.profile.find(p => p.p_document_type === 'kvkk_notice').p_document_text;
  assert.ok(notice.includes('Her alıcıya tüm bilgiler verilmez'));
  assert.ok(notice.includes('Aydınlatma metninin okunması bir açık rıza beyanı değildir'));
  assert.ok(notice.includes('kamera çekim anını veya EXIF'));
  assert.ok(notice.includes('süre dolduğunda erişime kapatılır'));
  assert.ok(!notice.includes('gerekli görülen yerlerle'));
});
test('existing v6 text/hash evidence and narrow service-start/return text stay intact', () => {
  const expected = {kvkk_notice:'8f9cd0ec76efc2e553ada199dfb1a5a5bc38e33ab9904a9d33e14dcdfba9d445', membership:'78946cb1e467b53ba3a05def66cb2e6c9021a44e5844043a7e04f7ba2eaedc48', privacy:'5d484e418afff06afc92a47bc9ddf5e19dd0c76bf789168ef94ac2b79688a19b'};
  for (const row of previous.profile) {
    assert.equal(hash(row.p_document_text), expected[row.p_document_type]);
    assert.equal(row.p_document_version, '2026-10-22-model-b-6');
  }
  for (const type of ['cancellation_return', 'service_start']) assert.equal(current.order.find(p => p.document_type === type).template, previous.order.find(p => p.document_type === type).template);
  for (const row of current.order) assert.equal(row.document_version, version);
});
test('web v7 order snapshots personalize and hash all four documents without broad consent', async () => {
  const draft = R.newDraft(); draft.express = true; draft.payment = 'bank_transfer';
  draft.items = [{client_item_id:randomUUID(),store:'Beymen',branch:'Synthetic',product_name:'Ürün 1',size:'M',color:'Siyah',estimated_price:100,product_link:'https://example.invalid/product',store_latitude:41.07,store_longitude:28.99}];
  draft.address = {customer_name:'Synthetic Customer',customer_phone:'+905300000000',district:'Şişli',neighborhood:'Synthetic',address_line:'Synthetic',building_no:'1',building_name:'Synthetic',directions:'Synthetic',latitude:41.07,longitude:28.99};
  const docs = await R.documents(draft,current,'synthetic@example.invalid',require('../assets/order-catalog.json').stores);
  assert.equal(docs.length,4);
  for (const row of docs) { assert.equal(row.document_version,version); assert.equal(row.content_hash,hash(row.content)); assert.ok(!row.content.includes('{{')); }
  for (const type of ['pre_information','distance_contract']) assert.ok(docs.find(p => p.document_type === type).content.includes('yalnız yetkili yönetici'));
  assert.ok(!docs.find(p => p.document_type === 'service_start').content.includes('veri aktarım'));
});
test('public privacy explains data groups, bounded recipients and photo/location retention', () => {
  const html = fs.readFileSync(path.join(__dirname,'../privacy/index.html'),'utf8');
  for (const text of [version,'müşteri veya diğer kuryelere açılmaz','Her alıcıya tüm bilgiler verilmez','30 günlük saklama','Aydınlatma ve açık rıza süreçleri ayrıdır']) assert.ok(html.includes(text),text);
});

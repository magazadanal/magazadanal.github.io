// KVKK v12 (2026-11-18-model-b-12): duplicate sharing text told once; meaning kept. Only the KVKK notice changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');
const v10 = require('../assets/legal-v10.json');
const v11 = require('../assets/legal-v11.json');
const KVKK_V12 = 'da356feae6842e54cc33cfda046871a18fd23c115c54a21583b9f3fe8b473fdc';
const KVKK_V10 = '4c10e338b87db72429e88619c68e4d9aaabd6c4038089166d0101a774509e19f';
const UNCHANGED = {membership: '717b94db747fc0f635f4d12f08c006ff721223abc69d46567983d28e0f3e3fdc', privacy: '454d5b682119f28159ad32c17f37c980f8d283a4d7d2217f30190b3cffeb3d9c'};
const kvkk = v10.profile.find(p => p.p_document_type === 'kvkk_notice');
const count = (text, part) => text.split(part).length - 1;

test('only the KVKK notice moves to v12; membership and privacy stay v10 word for word', () => {
  // KVKK v14 (2026-11-20) adds one paragraph; without it the text is the v12 text byte for byte (see kvkk-v14.test.cjs).
  assert.equal(kvkk.p_document_version, '2026-11-20-model-b-14');
  const v12Text = kvkk.p_document_text.split('\n\n').filter(p => !p.startsWith('Adres doldurma ve harita: ')).join('\n\n');
  assert.equal(hash(v12Text), KVKK_V12);
  assert.equal(hash(kvkk.p_document_text), kvkk.p_document_hash);
  assert.notEqual(KVKK_V12, KVKK_V10);
  for (const [type, h] of Object.entries(UNCHANGED)) {
    const row = v10.profile.find(p => p.p_document_type === type);
    assert.equal(row.p_document_version, '2026-11-17-model-b-10', type);
    assert.equal(row.p_document_hash, h, type);
  }
  assert.deepEqual(v11.profile, v10.profile, 'both catalogs carry the same profile documents');
  for (const row of v10.order) assert.equal(row.document_version, '2026-11-17-model-b-10');
  for (const row of v11.order) assert.equal(row.document_version, '2026-11-18-model-b-11');
});

test('KVKK tells each sharing fact once', () => {
  const text = kvkk.p_document_text;
  const [purpose, courier, recipients, basis] = v10.service_data_notice.split('\n\n');
  assert.equal(count(text, courier), 1, 'courier sharing (approved v10 sentence) once');
  assert.equal(count(text, recipients), 1, 'other recipients (approved v10 sentence) once');
  assert.equal(count(text, purpose), 0, 'service purpose paragraph not embedded again');
  assert.equal(count(text, basis), 0, 'service legal-basis paragraph not embedded again');
  for (const gone of ['Bu kapsamda müşteri ve alıcının ad ve soyadı', 'Siparişin ifası için gerekli ad, telefon', 'İlgili kurye veya kurye firmasının yetkili personeli, yalnız'])
    assert.ok(!text.includes(gone), gone);
  assert.equal(count(text, 'yurt dışı aktarım gereken hallerde'), 1);
});

test('facts that were only in one of the duplicates are kept', () => {
  const text = kvkk.p_document_text;
  for (const kept of ['EXIF konumunu doğrulamaz', 'iptal ve iade', 'işlem güvenliği', 'Hukuki danışmanlara', 'yetkili kamu kurumlarına',
    'yalnız atandığı siparişle sınırlıdır', "KVKK'nın 8 inci maddesindeki şartlara", "KVKK'nın 9 uncu maddesindeki şartlar ve uygun güvenceler",
    'Supabase, Cloudflare', 'Apple, Google', 'Resend', 'Photon', 'ürün fotoğrafı', 'kuryeye gösterilmez', 'Aydınlatma metninin okunması bir açık rıza beyanı değildir',
    'Açık rıza gerektiren ayrı bir faaliyet olursa', '30 günlük saklama', 'Uygulama içi mesajlar'])
    assert.ok(text.includes(kept), kept);
});

test('public KVKK page mirrors the app: section 5 equals the app text, no duplicate in section 9', () => {
  const html = fs.readFileSync(path.join(__dirname, '../privacy/index.html'), 'utf8');
  const section = kvkk.p_document_text.split('5. Aktarım\n\n')[1].split('\n\nAktif siparişteki')[0];
  for (const p of section.split('\n\n')) assert.equal(count(html, `<p>${p}</p>`), 1, p);
  assert.ok(html.includes('<h2>9. Fotoğraflar ve sipariş konumu</h2>'));
  assert.equal(count(html, 'EXIF'), 1);
});

test('user decision: KVKK v10 acknowledgements stay valid (no re-acknowledgement); nothing else is widened', () => {
  const R = require('../hesabim/order-rules.js');
  const doc = type => v10.profile.find(p => p.p_document_type === type);
  const ack = (type, version, hash) => ({document_type: type, document_version: version, document_hash: hash});
  assert.ok(R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-18-model-b-12', KVKK_V12)));
  assert.ok(R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-17-model-b-10', KVKK_V10)));
  assert.ok(!R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-17-model-b-10', KVKK_V12)));
  assert.ok(!R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-08-model-b-8', 'a1cd877c364d358eebf6767c26e4a60211713d25d34098c8ffa8a67b0a5426b0')));
  assert.ok(!R.profileAckAccepted(doc('kvkk_notice'), ack('membership', '2026-11-17-model-b-10', KVKK_V10)));
  assert.ok(R.profileAckAccepted(doc('membership'), ack('membership', '2026-11-17-model-b-10', UNCHANGED.membership)));
  assert.ok(!R.profileAckAccepted(doc('membership'), ack('membership', '2026-11-08-model-b-8', '3f5662c79ada9c4058a877b33cddb36fac6cc5dd673e7bf589364db66e45adf0')));
  const flow = fs.readFileSync(path.join(__dirname, '../hesabim/order-flow.js'), 'utf8');
  assert.ok(flow.includes('R.profileAckAccepted(doc, a)'));
});

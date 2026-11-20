// KVKK v14 (2026-11-20-model-b-14): one KVKK-only paragraph "Adres doldurma ve harita" after the other-recipients paragraph.
// User decision (2026-11-20): option A (shared otherRecipients sentence and the other five documents unchanged) and
// no re-acknowledgement (KVKK v10 and v12 acknowledgements stay valid).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');
const catalogs = ['legal-v10.json', 'legal-v11.json', 'legal-v13.json'].map(name => [name, require(`../assets/${name}`)]);
const KVKK_V14 = '29bd3895124cd92a36f1733c671a306621f7eb60e5be786409b88a9b55b71531';
const KVKK_V12 = 'da356feae6842e54cc33cfda046871a18fd23c115c54a21583b9f3fe8b473fdc';
const KVKK_V10 = '4c10e338b87db72429e88619c68e4d9aaabd6c4038089166d0101a774509e19f';
const UNCHANGED = {membership: '717b94db747fc0f635f4d12f08c006ff721223abc69d46567983d28e0f3e3fdc', privacy: '454d5b682119f28159ad32c17f37c980f8d283a4d7d2217f30190b3cffeb3d9c'};
const START = 'Adres doldurma ve harita: ';
const count = (text, part) => text.split(part).length - 1;

test('all three catalogs carry KVKK v14; membership and privacy stay v10; nothing else gets the paragraph', () => {
  for (const [name, catalog] of catalogs) {
    for (const doc of catalog.profile) {
      assert.equal(hash(doc.p_document_text), doc.p_document_hash, name);
      if (doc.p_document_type === 'kvkk_notice') {
        assert.equal(doc.p_document_version, '2026-11-20-model-b-14', name);
        assert.equal(doc.p_document_hash, KVKK_V14, name);
        assert.equal(count(doc.p_document_text, START), 1, name);
      } else {
        assert.equal(doc.p_document_version, '2026-11-17-model-b-10', name);
        assert.equal(doc.p_document_hash, UNCHANGED[doc.p_document_type], name);
        assert.ok(!doc.p_document_text.includes(START));
      }
    }
    for (const doc of catalog.order) assert.ok(!doc.template.includes(START), `${name} ${doc.document_type}`);
    assert.ok(!catalog.service_data_notice.includes(START), 'shared otherRecipients sentence untouched');
  }
  assert.deepEqual(catalogs[0][1].profile, catalogs[2][1].profile);
});

test('v14 = v12 + one paragraph, placed right after the other-recipients paragraph', () => {
  const text = catalogs[0][1].profile.find(p => p.p_document_type === 'kvkk_notice').p_document_text;
  const recipients = catalogs[0][1].service_data_notice.split('\n\n')[2];
  const paragraph = text.split('\n\n').find(p => p.startsWith(START));
  assert.ok(text.includes(`${recipients}\n\n${paragraph}\n\nHukuki danışmanlara`));
  assert.equal(hash(text.replace(`${paragraph}\n\n`, '')), KVKK_V12);
  for (const fact of ['telefonunuzun adres hizmetine', 'Google sağlar', "OpenStreetMap'ten", 'tarayıcınızdan doğrudan Photon', 'IP adresiniz',
    'adınız, telefonunuz ve hesap bilgileriniz gönderilmez', 'yurt dışına iletilir', "Google'ın kendi gizlilik koşullarına"])
    assert.ok(paragraph.includes(fact), fact);
});

test('public KVKK page carries the v14 paragraph once and no longer says Photon goes through our server', () => {
  const html = fs.readFileSync(path.join(__dirname, '../privacy/index.html'), 'utf8');
  const text = catalogs[0][1].profile.find(p => p.p_document_type === 'kvkk_notice').p_document_text;
  const paragraph = text.split('\n\n').find(p => p.startsWith(START));
  assert.ok(html.includes('Belge sürümü: 2026-11-20-model-b-14'));
  assert.equal(count(html, `<p>${paragraph}</p>`), 1);
  assert.ok(!html.includes('sunucumuz üzerinden'));
  assert.equal(count(html, 'tarayıcınızdan doğrudan Photon'), 2, 'section 5 paragraph and section 8 reverse lookup');
  assert.ok(html.includes('tarayıcınız Photon (komoot) hizmetine doğrudan bağlanır'));
  const photon = fs.readFileSync(path.join(__dirname, '../hesabim/photon.js'), 'utf8');
  assert.ok(photon.includes('https://photon.komoot.io'), 'browser talks to Photon directly');
});

test('user decision: KVKK v10 and v12 acknowledgements stay valid; nothing else is widened', () => {
  const R = require('../hesabim/order-rules.js');
  const doc = type => catalogs[0][1].profile.find(p => p.p_document_type === type);
  const ack = (type, version, h) => ({document_type: type, document_version: version, document_hash: h});
  assert.ok(R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-20-model-b-14', KVKK_V14)));
  assert.ok(R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-18-model-b-12', KVKK_V12)));
  assert.ok(R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-17-model-b-10', KVKK_V10)));
  assert.ok(!R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-20-model-b-14', KVKK_V12)));
  assert.ok(!R.profileAckAccepted(doc('kvkk_notice'), ack('kvkk_notice', '2026-11-18-model-b-12', KVKK_V14)));
  assert.ok(!R.profileAckAccepted(doc('membership'), ack('membership', '2026-11-18-model-b-12', KVKK_V12)));
  assert.ok(R.profileAckAccepted(doc('membership'), ack('membership', '2026-11-17-model-b-10', UNCHANGED.membership)));
  const page = fs.readFileSync(path.join(__dirname, '../hesabim/index.html'), 'utf8');
  assert.ok(page.includes('order-rules.js?v=20261120-kvkk14'), 'browsers fetch the updated rules');
});

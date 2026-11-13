const assert = require('node:assert/strict');
const test = require('node:test');
const R = require('../hesabim/order-rules.js');
const catalog = require('../assets/legal-v9.json');

test('saved order types have the same Turkish titles as current canonical documents', () => {
  const before = JSON.stringify(catalog);
  for (const document of catalog.order) assert.equal(R.orderDocumentTitle(document.document_type), document.title);
  assert.equal(JSON.stringify(catalog), before, 'Presentation must not mutate any stored template or version');
});

test('unknown or malformed document types never expose technical names as headings', () => {
  for (const type of ['unknown', '__proto__', 'constructor', '<img src=x onerror=alert(1)>', null, undefined, {}, 123]) {
    assert.equal(R.orderDocumentTitle(type), 'Sipariş Sözleşmesi');
  }
});

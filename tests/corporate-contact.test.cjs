const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

for (const page of ['destek/index.html', 'privacy/index.html']) {
  test(`${page} keeps support channels without publishing the contract phone`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.ok(!/0530\s*673\s*02\s*11|\+?905306730211|tel:/i.test(html));
    assert.ok(html.includes('mailto:destek@magazadanal.com'));
    assert.ok(!html.includes('0532 430 02 22'));
  });
}

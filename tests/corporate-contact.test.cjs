const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

for (const page of ['destek/index.html', 'privacy/index.html']) {
  test(`${page} uses the corporate contact line`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.ok(html.includes('<a href="tel:+905306730211">0530 673 02 11</a>'));
    assert.ok(html.includes('mailto:destek@magazadanal.com'));
    assert.ok(!html.includes('0532 430 02 22'));
  });
}

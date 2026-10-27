const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('homepage preserves the corporate Search Console verification in its head', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/i);
  assert.ok(head, 'homepage must have a head');
  assert.equal((html.match(/name="google-site-verification"/g) || []).length, 1);
  assert.ok(head[1].includes(
    '<meta name="google-site-verification" content="DHwb0sG3Ue-_aWQbUibLPL66isO1fK0_bAT-LYw3ECY">',
  ));
});

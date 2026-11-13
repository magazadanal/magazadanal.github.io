const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../hesabim/order-flow.css'), 'utf8');
const rule = selector => {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, selector);
  return css.slice(start, css.indexOf('}', start));
};

test('photo intrinsic dimensions cannot expand the square grid row', () => {
  assert.match(rule('.product-photo-frame'), /aspect-ratio:\s*1/);
  const preview = rule('.product-photo-preview');
  for (const declaration of [/position:\s*absolute/, /inset:\s*0/, /box-sizing:\s*border-box/, /overflow:\s*hidden/, /min-height:\s*0/]) {
    assert.match(preview, declaration);
  }
});

test('product photo keeps its proportions and remains bounded without changing cart thumbnails', () => {
  const image = rule('.product-photo-preview img:not(.app-icon)');
  assert.match(image, /object-fit:\s*contain/);
  assert.match(image, /max-width:\s*100%/);
  assert.match(image, /max-height:\s*100%/);
  assert.match(rule('.photo-preview img:not(.app-icon)'), /object-fit:\s*cover/);
  assert.match(rule('.product-photo-remove'), /position:\s*absolute/);
});

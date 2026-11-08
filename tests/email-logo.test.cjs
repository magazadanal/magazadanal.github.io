const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const hash=body=>createHash('sha256').update(body).digest('hex');

test('email PNG is derived from the current round-center logo, not the legacy square raster',()=>{
  const manifest=JSON.parse(readFileSync(path.join(root,'assets/email/logo-manifest.json')));
  const source=readFileSync(path.join(root,manifest.source));
  const png=readFileSync(path.join(root,'assets/email',manifest.file));
  assert.match(source.toString(),/<circle cx="50" cy="40" r="8.5"/);
  assert.equal(hash(source),manifest.sourceSHA256);
  assert.equal(hash(png),manifest.pngSHA256);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),360);assert.equal(png.readUInt32BE(20),241);
  assert.equal(png.length,manifest.bytes);assert.ok(png.length<50000);
  assert.equal(manifest.background,'#ffffff');
  assert.equal(manifest.file,'magazadanal-logo-20261109.png');
});

test('email header preserves the original mark on one full-width dark bitmap',()=>{
  const manifest=JSON.parse(readFileSync(path.join(root,'assets/email/email-header-manifest.json')));
  const source=readFileSync(path.join(root,manifest.source));
  const png=readFileSync(path.join(root,'assets/email',manifest.file));
  assert.match(source.toString(),/<circle cx="50" cy="40" r="8.5"/);
  assert.equal(hash(source),manifest.sourceSHA256);assert.equal(hash(png),manifest.pngSHA256);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),352);
  assert.equal(png.length,manifest.bytes);assert.ok(png.length<50000);
  assert.equal(manifest.background,'#142e2a');
  assert.equal(manifest.file,'magazadanal-email-header-20261109-v2.png');
});

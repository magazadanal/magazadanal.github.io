const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const P = require('../auth/protection.js');
test('test configuration remains separate from disabled production authentication', () => {
  assert.equal(P.configuration(JSON.parse(read('assets/auth-protection.json'))).enabled, false);
  const probe = P.configuration(JSON.parse(read('assets/auth-protection-probe.json')));
  assert.equal(probe.enabled, true); assert.equal(probe.project, 'zxqqbzggfbxoasyhueqb');
  assert.ok(Number.isFinite(Date.parse(probe.expires_at)));
});
test('a response requires the exact frame, origin, nonce, action and bounded string token', () => {
  global.location = {origin: 'https://magazadanal.com'};
  try {
    const frame = {contentWindow: {}}, id = '10000000-0000-4000-8000-000000000001';
    const event = {origin: global.location.origin, source: frame.contentWindow, data: {type: 'ma-captcha', id, action: 'login', token: 'synthetic-token.0'}};
    assert.equal(P.accepts(event, frame, id, 'login'), true);
    for (const change of [{origin: 'https://evil.invalid'}, {source: {}}, {data: {...event.data, action: 'signup'}}, {data: {...event.data, id: 'another'}}]) assert.equal(P.accepts({...event, ...change}, frame, id, 'login'), false);
    for (const value of [true, '', '<script>', 'token\n', 'token\u2028', 'x'.repeat(2049)]) assert.equal(P.validToken(value), false);
  } finally { delete global.location; }
});
test('the test sends no credentials to Cloudflare and never signs in or writes a session', () => {
  const page = read('auth/probe/probe.js'), challenge = read('auth/challenge/challenge.js');
  assert.ok(page.includes('/functions/v1/verify-auth-challenge-probe'));
  assert.ok(!/\/auth\/v1\/(?:signup|token|recover)|saveSession|setItem|console\./.test(page));
  assert.ok(!/accessToken|refreshToken|password|sessionStorage|localStorage/.test(challenge));
  assert.ok(challenge.includes('cData: id')); assert.ok(challenge.includes('policy.load(probe)'));
});
test('the test page has no inline or external third-party script and exposes no token', () => {
  const html = read('auth/probe/index.html');
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
  assert.ok(html.includes('noindex,nofollow,noarchive'));
  assert.ok(html.includes("frame-src 'self'")); assert.ok(!html.includes('unsafe-inline'));
  assert.ok(read('auth/probe/probe.js').includes('previous = null'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../auth/protection.js');
const project = 'zxqqbzggfbxoasyhueqb';

test('approved CAPTCHA rollout uses the owned production widget', () => {
  const config = P.configuration(require('../assets/auth-protection.json'));
  assert.equal(config.enabled, true); assert.equal(config.site_key, '0x4AAAAAAF7hyN8yBXtEY5FN');
});
test('configuration rejects unknown projects, types, versions and invalid enabled keys', () => {
  for (const value of [null, {}, { version: 1, project, enabled: 'false' }, { version: 2, project, enabled: false },
    { version: 1, project: 'staging', enabled: false }, { version: 1, project, enabled: true, site_key: 'https://evil.invalid' }]) assert.throws(() => P.configuration(value));
});
test('challenge responses bind exact origin, iframe source, nonce, action and bounded token', () => {
  const prior = global.location; global.location = { origin: 'https://magazadanal.com' };
  try {
    const frame = { contentWindow: {} }, id = '10000000-0000-4000-8000-000000000001';
    const event = { origin: global.location.origin, source: frame.contentWindow, data: { type: 'ma-captcha', id, action: 'login', token: 'synthetic.0-token' } };
    assert.ok(P.accepts(event, frame, id, 'login'));
    for (const changes of [{ origin: 'https://evil.invalid' }, { source: {} }, { data: { ...event.data, id: 'other' } },
      { data: { ...event.data, action: 'signup' } }, { data: { ...event.data, token: true } }, { data: { ...event.data, token: 'x'.repeat(2049) } }]) assert.ok(!P.accepts({ ...event, ...changes }, frame, id, 'login'));
  } finally { global.location = prior; }
});
test('unsafe token/nonce shapes are rejected', () => {
  for (const token of [null, true, '', '<script>', 'a\nb', 'token\n', 'token\r', 'token\u2028', 'x'.repeat(2049)]) assert.equal(P.validToken(token), false);
  assert.ok(P.validID('10000000-0000-4000-8000-000000000001'));
  assert.equal(P.validID('not-a-request'), false);
});
test('all interactive web auth routes are protected; refresh and recovery completion stay separate', () => {
  const account = fs.readFileSync(path.join(__dirname, '../hesabim/hesabim.js'), 'utf8');
  for (const action of ['login', 'signup', 'recovery']) assert.ok(account.includes(`protectedAuthBody("${action}"`));
  const page = fs.readFileSync(path.join(__dirname, '../auth/challenge/challenge.js'), 'utf8');
  assert.ok(page.includes('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'));
  assert.ok(!/localStorage|sessionStorage|console\.|password|access_token/.test(page));
  assert.ok(page.includes('postMessage(message, location.origin)'));
});
test('temporary probe cannot change normal authentication or send a session to Cloudflare', () => {
  const config = require('../assets/auth-protection-probe.json');
  assert.equal(config.project, project); assert.equal(config.enabled, true);
  assert.ok(Number.isFinite(Date.parse(config.expires_at)));
  assert.equal(require('../assets/auth-protection.json').enabled, true);
  const page = fs.readFileSync(path.join(__dirname, '../auth/probe/probe.js'), 'utf8');
  assert.ok(page.includes('/functions/v1/verify-auth-challenge-probe'));
  assert.ok(!/\/auth\/v1\/(?:signup|token|recover)|saveSession|setItem|console\./.test(page));
  assert.ok(page.includes('previous = null'));
  const challenge = fs.readFileSync(path.join(__dirname, '../auth/challenge/challenge.js'), 'utf8');
  assert.ok(challenge.includes('cData: id'));
});


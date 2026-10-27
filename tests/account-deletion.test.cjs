const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('public deletion resource identifies the app and provides a real email request path', () => {
  const html = read('hesap-silme/index.html');
  assert.ok(html.includes('Mağazadan AL'));
  assert.ok(html.includes('href="mailto:destek@magazadanal.com?subject=Hesap%20ve%20veri%20silme%20talebi"'));
  assert.ok(html.includes('Uygulamayı yeniden yüklemeniz veya hesabınıza giriş yapmanız gerekmez'));
  assert.ok(html.includes('şifre, doğrulama kodu, kart bilgisi veya kimlik belgesi göndermeyin'));
  assert.ok(html.includes('kanuni saklama ve zamanaşımı süreleri'));
  assert.ok(html.includes('Aynı hesabı iPhone, iPad, Android veya web'));
  assert.ok(html.includes('href="/privacy/"'));
  assert.doesNotMatch(html, /<form|<iframe|type="password"|tel:|0530\s*673/i);
  assert.doesNotMatch(html, /fetch\(|supabase|service_role|sb_secret_|silindi|30 gün içinde/i);
});
test('support page exposes deletion without changing the homepage verification or security policy', () => {
  assert.ok(read('destek/index.html').includes('href="/hesap-silme/"'));
  assert.ok(read('index.html').includes('name="google-site-verification"'));
  const html = read('hesap-silme/index.html');
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('src="/theme.js?v=20261019-1"'));
  assert.doesNotMatch(html, /style=|onclick=|https?:\/\/[^" ]+\.js/i);
});

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8766';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const scenario of ['disabled', 'success', 'provider-error', 'invalid-token', 'cancel', 'timeout', 'config-failure']) {
      const context = await browser.newContext(), page = await context.newPage();
      let challenges = 0, providerCalls = 0;
      if (scenario === 'timeout') await page.addInitScript(() => {
        const original = window.setTimeout;
        window.setTimeout = (callback, delay, ...args) => original(callback, delay === 120000 ? 250 : delay, ...args);
      });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) {
          if (url.pathname === '/assets/auth-protection.json') return route.fulfill({ status: scenario === 'config-failure' ? 503 : 200,
            contentType: 'application/json', body: JSON.stringify({ version: 1, project: 'zxqqbzggfbxoasyhueqb', enabled: scenario !== 'disabled', site_key: '0x4AAAAAAAAAAAAAAAAAAA' }) });
          if (url.pathname === '/auth/challenge/') challenges++;
          return route.continue();
        }
        if (url.hostname === 'challenges.cloudflare.com') {
          providerCalls++;
          // Synthetic SDK only: no real CAPTCHA is requested or solved by automation.
          const behavior = scenario === 'provider-error' ? 'options["error-callback"]()' : scenario === 'invalid-token' ? 'options.callback("x".repeat(2049))' :
            ['cancel', 'timeout'].includes(scenario) ? '' : 'options.callback("synthetic-token.0");options.callback("synthetic-token.0")';
          return route.fulfill({ contentType: 'application/javascript', body: `window.turnstile={render(selector,options){setTimeout(()=>{${behavior}},30)}};` });
        }
        assert.equal(url.hostname, 'zxqqbzggfbxoasyhueqb.supabase.co');
        assert.ok(url.pathname.endsWith('/get_public_runtime_status'), 'No auth or payment requests permitted in this suite');
        return route.fulfill({ contentType: 'application/json', body: '[{"customer_web_account_enabled":true,"customer_ordering_enabled":true}]' });
      });
      await page.goto(base + '/auth/probe/');
      await page.waitForFunction(() => Boolean(window.MAAuthProtection));
      await page.evaluate(() => {
        window.syntheticOutcome = null;
        window.MAAuthProtection.protect('login', { email: 'synthetic@example.invalid', password: 'synthetic-only' })
          .then(value => { window.syntheticOutcome = { value }; }).catch(() => { window.syntheticOutcome = { rejected: true }; });
      });
      if (scenario === 'cancel') {
        await page.getByRole('dialog', { name: 'Güvenlik doğrulaması' }).waitFor();
        await page.getByRole('button', { name: 'Kapat', exact: true }).click();
      }
      await page.waitForFunction(() => window.syntheticOutcome !== null);
      const outcome = await page.evaluate(() => window.syntheticOutcome);
      if (scenario === 'disabled') {
        assert.equal(challenges, 0); assert.equal(providerCalls, 0);
        assert.equal(outcome.value.gotrue_meta_security, undefined);
      } else if (scenario === 'success') {
        assert.equal(challenges, 1); assert.equal(providerCalls, 1);
        assert.equal(outcome.value.gotrue_meta_security.captcha_token, 'synthetic-token.0');
      } else assert.equal(outcome.rejected, true, scenario);
      assert.equal(await page.locator('.auth-challenge-dialog').count(), 0);
      const saved = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
      assert.ok(!saved.includes('synthetic-token.0'));
      await context.close();
    }
    for (const layout of [
      {name: 'desktop', viewport: {width: 1280, height: 850}, colorScheme: 'light'},
      {name: 'phone', viewport: {width: 390, height: 844}, colorScheme: 'light'},
      {name: 'phone-dark', viewport: {width: 390, height: 844}, colorScheme: 'dark'},
      {name: 'signup', viewport: {width: 390, height: 844}, colorScheme: 'light', action: 'signup', label: 'Kayıt'},
      {name: 'recovery', viewport: {width: 390, height: 844}, colorScheme: 'light', action: 'recovery', label: 'Parola yenileme'},
      {name: 'replay-accepted', viewport: {width: 1280, height: 850}, colorScheme: 'light', replayAccepted: true}
    ]) {
      const context = await browser.newContext({viewport: layout.viewport, colorScheme: layout.colorScheme});
      const page = await context.newPage(); let verifications = 0, sdkLoads = 0;
      await page.addInitScript(() => {
        sessionStorage.setItem('magazadanal.web.session.v1', JSON.stringify({accessToken: 'synthetic-session-token', expiresAt: Date.now() + 3600000, user: {id: '10000000-0000-4000-8000-000000000002'}}));
        const original = window.setTimeout;
        window.setTimeout = (callback, delay, ...args) => original(callback, delay === 6500 ? 20 : delay, ...args);
      });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base) {
          if (url.pathname === '/assets/auth-protection-probe.json') return route.fulfill({contentType: 'application/json', body: JSON.stringify({version: 1, project: 'zxqqbzggfbxoasyhueqb', enabled: true, site_key: '0x4AAAAAAAAAAAAAAAAAAA', expires_at: new Date(Date.now() + 3600000).toISOString()})});
          return route.continue();
        }
        if (url.hostname === 'challenges.cloudflare.com') {
          sdkLoads++;
          return route.fulfill({contentType: 'application/javascript', body: 'window.turnstile={render(selector,options){if(!options.cData)throw Error();setTimeout(()=>options.callback("synthetic-token.0"),30)}};'});
        }
        assert.equal(url.href, 'https://zxqqbzggfbxoasyhueqb.supabase.co/functions/v1/verify-auth-challenge-probe');
        const proof = route.request().postDataJSON();
        assert.equal(proof.token, 'synthetic-token.0'); assert.equal(proof.action, layout.action || 'login');
        assert.ok(/^[0-9a-f-]{36}$/.test(proof.id)); assert.deepEqual(Object.keys(proof).sort(), ['action', 'id', 'token']);
        return route.fulfill({contentType: 'application/json', body: JSON.stringify({id: proof.id, action: proof.action, verified: ++verifications === 1 || layout.replayAccepted === true})});
      });
      await page.goto(base + '/auth/probe/');
      await page.getByText('Oturum açık', {exact: true}).waitFor(); assert.equal(sdkLoads, 0);
      if (layout.label) await page.getByRole('radio', {name: layout.label, exact: true}).check();
      await page.getByRole('button', {name: 'Doğrulamayı başlat', exact: true}).click();
      await page.getByText('Sunucu doğrulaması başarılı.', {exact: true}).waitFor();
      assert.equal(verifications, 1); assert.equal(sdkLoads, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('.brand').evaluate(img => img.complete && img.naturalWidth > 0), true);
      if (process.env.SITE_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.SITE_SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SITE_SCREENSHOT_DIR, `probe-${layout.name}.png`), fullPage: true});
      }
      await page.getByRole('button', {name: 'Tekrar kullanımını kontrol et', exact: true}).click();
      await page.getByText(layout.replayAccepted ? 'Tekrar kullanım henüz reddedilmedi; test tamamlanmadı.' : 'Tekrar kullanım reddedildi.', {exact: true}).waitFor();
      assert.equal(verifications, 2);
      assert.equal(await page.getByRole('button', {name: 'Tekrar kullanımını kontrol et', exact: true}).isEnabled(), false);
      assert.equal(await page.getByRole('button', {name: 'Doğrulamayı başlat', exact: true}).isEnabled(), true);
      assert.ok(!(await page.evaluate(() => JSON.stringify({...sessionStorage, ...localStorage}))).includes('synthetic-token.0'));
      await context.close();
    }
    for (const expiredInitially of [false, true]) {
      const context = await browser.newContext(), page = await context.newPage();
      await page.clock.install({time: new Date()});
      await page.addInitScript(expired => {
        sessionStorage.setItem('magazadanal.web.session.v1', JSON.stringify({accessToken: 'synthetic-session-token',
          expiresAt: Date.now() + (expired ? -1000 : 15000), user: {id: '10000000-0000-4000-8000-000000000002'}}));
      }, expiredInitially);
      let externalCalls = 0;
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin === base) return route.continue();
        externalCalls++; return route.abort();
      });
      await page.goto(base + '/auth/probe/');
      if (!expiredInitially) {
        await page.getByText('Oturum açık', {exact: true}).waitFor();
        await page.clock.fastForward(5100);
      }
      await page.getByText('Hesabına dönüp oturumunu yenile.', {exact: true}).waitFor();
      assert.equal(await page.getByRole('button', {name: 'Doğrulamayı başlat', exact: true}).isEnabled(), false);
      assert.equal(await page.getByRole('button', {name: 'Tekrar kullanımını kontrol et', exact: true}).isEnabled(), false);
      assert.equal(externalCalls, 0);
      assert.equal(await page.getByRole('link', {name: 'Hesabıma dön', exact: true}).getAttribute('href'), '/hesabim/');
      const saved = JSON.parse(await page.evaluate(() => sessionStorage.getItem('magazadanal.web.session.v1')));
      assert.equal(saved.accessToken, 'synthetic-session-token');
      await context.close();
    }
    console.log('PASS: disabled rollout, bound synthetic challenge, duplicate callback, provider failure, invalid token, cancellation, timeout, config failure, session expiry and no token storage. No real provider/auth calls.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

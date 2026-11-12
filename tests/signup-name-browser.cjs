const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8892';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
async function main() {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}}), page = await context.newPage();
      let signups = 0;
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) return route.continue();
        if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({contentType: 'application/javascript', body: 'window.turnstile={render(s,o){setTimeout(()=>o.callback("synthetic-signup-name-proof"),30)}};'});
        assert.equal(url.origin, 'https://zxqqbzggfbxoasyhueqb.supabase.co');
        let data;
        if (url.pathname.endsWith('get_public_runtime_status')) data = [{customer_web_account_enabled: true, customer_ordering_enabled: true}];
        else if (url.pathname === '/auth/v1/signup') {
          const body = request.postDataJSON(); signups++;
          assert.equal(body.data.full_name, 'Test Buyer'); assert.equal(body.gotrue_meta_security.captcha_token, 'synthetic-signup-name-proof');
          data = {user: {id: '10000000-0000-4000-8000-000000000001', email_confirmed_at: null}};
        } else throw Error('Unexpected request ' + url.pathname);
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(data)});
      });
      await page.goto(base + '/hesabim/'); await page.locator('#signup-toggle').click();
      for (const [key, value] of Object.entries({email: 'synthetic@example.invalid', phone: '05300000000', password: 'synthetic-password', confirm: 'synthetic-password'})) await page.locator('#signup-' + key).fill(value);
      const first = page.getByRole('textbox', {name: 'Ad', exact: true}), last = page.getByRole('textbox', {name: 'Soyad', exact: true});
      assert.equal(await first.getAttribute('required'), ''); assert.equal(await last.getAttribute('required'), '');
      await first.fill('Test'); await page.locator('#signup-form button[type="submit"]').click();
      assert.equal(signups, 0); assert.equal(await last.evaluate(input => input.validity.valueMissing), true);
      await first.fill(''); await last.fill('Buyer'); await page.locator('#signup-form button[type="submit"]').click();
      assert.equal(signups, 0); assert.equal(await first.evaluate(input => input.validity.valueMissing), true);
      await first.fill('Test'); await last.fill('   '); await page.locator('#signup-form button[type="submit"]').click();
      await page.getByText('Soyad alanını doldur.', {exact: true}).waitFor(); assert.equal(signups, 0);
      await last.fill('Buyer'); await page.locator('#signup-form button[type="submit"]').click();
      await page.getByText('E-postana gelen doğrulama bağlantısını aç, ardından giriş yap.', {exact: true}).waitFor(); assert.equal(signups, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.SITE_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.SITE_SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SITE_SCREENSHOT_DIR, `signup-name-${width}.png`), fullPage: true});
      }
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('PASS: separate required first/last names, missing and whitespace surname blocked, normal CAPTCHA-protected signup retained; local mocked requests only.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});

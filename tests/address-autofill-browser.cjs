const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const R = require('../hesabim/order-rules.js');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8892';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const key = `magazadanal.web.draft.v1.${owner}`;
async function main() {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const scenario of ['desktop', 'mobile', 'unavailable', 'manual-number', 'newer-pin', 'navigated-away']) {
      const context = await browser.newContext({viewport: {width: scenario === 'mobile' ? 390 : 1280, height: 950}});
      const page = await context.newPage(), errors = [], lookups = [];
      page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
      const draft = R.newDraft();
      draft.items = [{client_item_id: crypto.randomUUID(), store: 'Beymen', branch: 'Synthetic Branch', product_name: 'Product', product_link: 'https://example.invalid/product', size: 'M', color: 'Siyah', estimated_price: 100, store_latitude: 41.07, store_longitude: 28.99}];
      draft.address = {customer_name: 'Synthetic Customer', customer_phone: '+905300000000', district: 'Şişli', neighborhood: 'Old Neighborhood', address_line: 'Old Street', building_no: '1', building_name: 'User Building Floor 1 Apartment 2', directions: 'User directions'};
      await page.addInitScript(({owner, key, draft}) => {
        sessionStorage.setItem('magazadanal.web.session.v1', JSON.stringify({accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000, user: {id: owner, email: 'synthetic@example.invalid'}}));
        sessionStorage.setItem(key, JSON.stringify({owner, updated: Date.now(), draft, stage: 'stores', checkout: false, frozen: null}));
      }, {owner, key, draft});
      let releaseFirst, startedFirst;
      const delayed = new Promise(resolve => {releaseFirst = resolve;});
      const started = new Promise(resolve => {startedFirst = resolve;});
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base && url.pathname === '/assets/checkout-reference.json') return route.fulfill({contentType: 'application/json', body: '{"enabled":false}'});
        if (url.origin === base) return route.continue();
        if (url.hostname === 'tile.openstreetmap.org') return route.fulfill({contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64')});
        assert.equal(url.origin, 'https://zxqqbzggfbxoasyhueqb.supabase.co', 'All external requests are intercepted');
        let data;
        if (url.pathname.endsWith('get_public_runtime_status')) data = [{customer_web_account_enabled: true, customer_ordering_enabled: true}];
        else if (url.pathname === '/rest/v1/profiles') data = [{id: owner, role: 'customer', full_name: 'Synthetic Customer', phone: '+905300000000', is_active: true}];
        else if (url.pathname === '/functions/v1/web-address-lookup') {
          const point = request.postDataJSON();
          assert.deepEqual(Object.keys(point).sort(), ['latitude', 'longitude']); assert.ok(R.point(point.latitude, point.longitude));
          lookups.push(point); const index = lookups.length;
          startedFirst();
          if (index === 1 && ['manual-number', 'newer-pin', 'navigated-away'].includes(scenario)) await delayed;
          if (scenario === 'unavailable') return route.fulfill({status: 503, contentType: 'application/json', body: '{}'});
          data = {address: {city: 'İstanbul', district: 'Beyoğlu', neighborhood: 'Mapped Neighborhood', address_line: index === 2 ? 'Newer Street' : 'Mapped Street', building_no: '42'}};
        } else if (['/rest/v1/orders', '/rest/v1/customer_addresses', '/rest/v1/rpc/list_support_tickets_v3', '/rest/v1/rpc/list_order_activity'].includes(url.pathname)) data = [];
        else throw Error('Unexpected request/write: ' + url.pathname);
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(data)});
      });
      await page.goto(base + '/hesabim/?view=cart'); await page.getByRole('heading', {name: 'Sepetim', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Ödemeye geç', exact: true}).click();
      await page.getByText('Teslimat konumunu haritadan seç.', {exact: true}).waitFor();
      async function choose(x) {
        await page.getByRole('button', {name: /^Teslimat konumu/}).click();
        assert.equal(lookups.length, x === 140 ? 1 : 0, 'Opening a map must not transmit a coordinate to reverse lookup');
        await page.locator('.app-map').click({position: {x, y: 170}});
        await page.getByRole('button', {name: 'Bu konumu kullan', exact: true}).click();
      }
      await choose(120); await started;
      if (scenario === 'manual-number') await page.locator('[name="building_no"]').fill('99');
      if (scenario === 'newer-pin') {
        await choose(140); await page.waitForFunction(() => document.querySelector('[name="address_line"]').value === 'Newer Street');
      }
      if (scenario === 'navigated-away') await page.getByRole('button', {name: 'Profil', exact: true}).click();
      releaseFirst();
      if (scenario === 'unavailable') {
        await page.getByText('Adres otomatik alınamadı. Seçtiğin konum korunuyor; alanları elle doldurabilirsin.', {exact: true}).waitFor();
      } else if (scenario === 'navigated-away') {
        await page.waitForTimeout(100);
        const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
        assert.equal(stored.draft.address.address_line, 'Old Street');
        await context.close(); continue;
      } else {
        await page.waitForFunction(() => ['Mapped Street', 'Newer Street'].includes(document.querySelector('[name="address_line"]').value));
        if (scenario === 'newer-pin') {await page.waitForTimeout(100); assert.equal(await page.locator('[name="address_line"]').inputValue(), 'Newer Street');}
        assert.equal(await page.locator('[name="district"]').inputValue(), 'Beyoğlu');
        assert.equal(await page.locator('[name="neighborhood"]').inputValue(), 'Mapped Neighborhood');
        assert.equal(await page.locator('[name="building_no"]').inputValue(), scenario === 'manual-number' ? '99' : '42');
      }
      assert.equal(await page.locator('[name="building_name"]').inputValue(), draft.address.building_name);
      assert.equal(await page.locator('[name="directions"]').inputValue(), draft.address.directions);
      await page.locator('[name="building_no"]').fill('9');
      assert.ok(await page.getByRole('button', {name: 'Teslimat konumu seçildi · Değiştir', exact: true}).isVisible(), 'Correcting the building number preserves the chosen map point');
      assert.equal(await page.locator('#order-status').isVisible(), false, 'A valid selected location clears the old location error immediately');
      if (scenario === 'mobile') {
        const header = await page.locator('body > header').boundingBox(), back = await page.locator('#product-back').boundingBox();
        assert.ok(back.y >= header.y && back.y + back.height <= header.y + header.height, 'Mobile back control stays in the header instead of covering address fields');
      }
      if (process.env.SITE_SCREENSHOT_DIR && ['desktop', 'mobile'].includes(scenario)) {
        await fs.mkdir(process.env.SITE_SCREENSHOT_DIR, {recursive: true});
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({path: path.join(process.env.SITE_SCREENSHOT_DIR, `address-autofill-${scenario}.png`), fullPage: true});
      }
      await page.getByRole('button', {name: 'Ödemeye geç', exact: true}).click();
      await page.getByRole('heading', {name: 'Teslimat ve ödeme', exact: true}).waitFor();
      assert.equal(await page.locator('#order-status').isVisible(), false, 'Successful address validation removes the old location error');
      assert.deepEqual(errors, []); await context.close();
    }
  } finally {await browser.close();}
  console.log('PASS: explicit point selection fills safe address fields; failure keeps manual entry; late responses, manual corrections and newer pins are preserved; stale checkout errors cleared. Local synthetic data only.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});

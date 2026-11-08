const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8768';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-web-pickup-location-20261108';
async function main() {
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const [width, theme] of [[1280, 'light'], [390, 'dark'], [320, 'light']]) {
      const context = await browser.newContext({viewport:{width, height:940}});
      const page = await context.newPage(), errors = [], writes = [];
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({owner, theme}) => {
        localStorage.setItem('magazadanal.web.theme.v1', theme);
        sessionStorage.setItem('magazadanal.web.session.v1', JSON.stringify({accessToken:'mock-access', refreshToken:'mock-refresh', expiresAt:Date.now()+3600000, user:{id:owner, email:'test@example.invalid'}}));
      }, {owner, theme});
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === base && url.pathname === '/assets/checkout-reference.json') return route.fulfill({contentType:'application/json', body:'{"enabled":false}'});
        if (url.origin === base) return route.continue();
        if (url.hostname === 'tile.openstreetmap.org') return route.fulfill({contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64')});
        assert.equal(url.hostname, 'zxqqbzggfbxoasyhueqb.supabase.co');
        let data;
        if (url.pathname.endsWith('get_public_runtime_status')) data = [{customer_web_account_enabled:true, customer_ordering_enabled:true}];
        else if (url.pathname === '/rest/v1/profiles') data = [{id:owner, role:'customer', is_active:true, full_name:'Synthetic Customer', phone:'+905300000000'}];
        else if (url.pathname === '/functions/v1/web-store-search') {
          assert.equal(req.postDataJSON().store, 'Beymen');
          data = {results:[{name:'Beymen Test Şube', latitude:41.07, longitude:28.99}]};
        } else if (['/rest/v1/orders', '/rest/v1/customer_addresses', '/rest/v1/customer_billing_profiles', '/rest/v1/customer_profile_photos', '/rest/v1/rpc/list_order_activity', '/rest/v1/rpc/list_support_tickets_v3'].includes(url.pathname)) data = [];
        else { writes.push(url.pathname); throw Error('Unexpected request/write: '+url.pathname); }
        return route.fulfill({contentType:'application/json', body:JSON.stringify(data)});
      });
      await page.goto(base+'/hesabim/');
      await page.locator('#portal-view').waitFor();
      await page.getByRole('button', {name:'Beymen', exact:true}).click();
      await page.locator('[name="product_link"]').fill('https://example.invalid/product');
      await page.locator('[name="size"]').fill('M');
      await page.locator('[name="color"]').fill('Siyah');
      await page.locator('[name="estimated_price"]').fill('100');
      await page.getByRole('button', {name:'Mağaza konumu seç', exact:true}).click();
      const dialog = page.getByRole('dialog', {name:'Konum seç'});
      await dialog.getByRole('button', {name:'Beymen Test Şube', exact:true}).click();
      await dialog.getByRole('button', {name:'Bu konumu kullan', exact:true}).click();
      await page.locator('[name="branch"]').fill('Beymen Test Şube kat 1');
      assert.match(await page.locator('.store-pickup button').textContent(), /Konum seçildi/, 'Editing a branch description must not silently erase the chosen map point');
      assert.equal(await page.locator('.store-pickup .is-selected').count(), 1);
      assert.match(await page.locator('.pickup-location-value').textContent(), /41\.07000.*28\.99000/);
      await page.reload();
      await page.locator('#portal-view').waitFor();
      assert.equal(await page.locator('[name="branch"]').inputValue(), 'Beymen Test Şube kat 1');
      assert.match(await page.locator('.pickup-location-value').textContent(), /41\.07000.*28\.99000/);
      await page.screenshot({path:path.join(output, `selected-${width}-${theme}.png`), fullPage:true});
      await page.getByRole('button', {name:'Sepete ekle', exact:true}).click();
      await page.getByRole('heading', {name:'Sepetim', exact:true}).waitFor();
      assert.equal(await page.locator('.cart-item').count(), 1);
      await page.getByRole('button', {name:'Düzenle', exact:true}).click();
      assert.match(await page.locator('.pickup-location-value').textContent(), /41\.07000.*28\.99000/);
      await page.getByRole('button', {name:'Geri', exact:true}).click();
      await page.getByRole('button', {name:'Mango', exact:true}).click();
      assert.equal(await page.locator('[name="branch"]').inputValue(), '');
      assert.equal(await page.locator('.store-pickup .is-selected').count(), 0);
      assert.equal(await page.locator('.pickup-location-value').isHidden(), true);
      await page.getByRole('button', {name:/^(Sepete ekle|Değişiklikleri kaydet)$/}).click();
      assert.ok(await page.locator('#order-status').isVisible());
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('PASS: selected pickup location survives branch edit/reload/cart edit, is visibly filled, and is cleared only when switching store. Three local mocked viewports, no server writes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

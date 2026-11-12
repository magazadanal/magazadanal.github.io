const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8894';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-photo-parity-20261112';
const owner = '10000000-0000-4000-8000-000000000001';
const foreign = '10000000-0000-4000-8000-000000000002';
const orderID = '20000000-0000-4000-8000-000000000001';
const ids = Array.from({length: 5}, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const scenarios = ['history', 'history-retry', 'history-inflight', 'active-photo-failure', 'active-photo-inflight', 'history-logout',
  'profile-preserve', 'profile-upload', 'profile-remove', 'profile-cancel', 'profile-invalid', 'profile-foreign',
  'profile-unavailable', 'profile-late-read', 'profile-logout', 'profile-save-failure', 'profile-metadata'];

async function main() {
  await fs.mkdir(output, {recursive: true});
  const baselineRef = process.env.PHOTO_BASELINE_REF;
  if (baselineRef) assert.match(baselineRef, /^[a-f0-9]{40}$/);
  const baseline = baselineRef ? execFileSync('git', ['show', `${baselineRef}:hesabim/hesabim.js`], {encoding: 'utf8'}) : null;
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const results = [];
  try {
    const fixturePage = await browser.newPage();
    const jpeg = await fixturePage.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2e7068'; ctx.fillRect(0, 0, 100, 80);
      ctx.fillStyle = '#fff'; ctx.fillRect(20, 20, 60, 40);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    await fixturePage.close();
    const selectedScenarios = process.env.PHOTO_SCENARIO ? [process.env.PHOTO_SCENARIO] : scenarios;
    for (const scenario of selectedScenarios) {
      assert.ok(scenarios.includes(scenario));
      const layouts = scenario === 'profile-upload' || scenario === 'history' ? [[1280, 'light'], [1280, 'dark'], [390, 'dark'], [320, 'light']] : [[390, 'light']];
      for (const [width, theme] of layouts) {
        const context = await browser.newContext({viewport: {width, height: 900}});
        const page = await context.newPage(), errors = [], requests = [], writes = [];
        page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
        let savedPhoto = jpeg, photoCalls = 0, profileReads = 0, failedBatch = false;
        let release; const deferred = new Promise(resolve => { release = resolve; });
        await page.addInitScript(({owner, theme}) => {
          localStorage.setItem('magazadanal.web.theme.v1', theme);
          sessionStorage.setItem('magazadanal.web.session.v1', JSON.stringify({accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000, user: {id: owner, email: 'test@example.invalid'}}));
        }, {owner, theme});
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url()), p = url.pathname;
          if (url.origin === base) {
            if (baseline && p === '/hesabim/hesabim.js') return route.fulfill({contentType: 'application/javascript', body: baseline});
            return route.continue();
          }
          assert.equal(url.origin, 'https://zxqqbzggfbxoasyhueqb.supabase.co', 'No actual backend/provider traffic');
          requests.push(p); let data, status = 200;
          if (p.endsWith('get_public_runtime_status')) data = [{customer_web_account_enabled: true, customer_ordering_enabled: true}];
          else if (p === '/rest/v1/profiles') data = [{id: owner, full_name: 'Test Müşteri', phone: '+905300000000', role: 'customer', is_active: true}];
          else if (p === '/rest/v1/orders') data = [{id: orderID, order_no: '000001', status: scenario.startsWith('active-photo-') ? 'on_the_way' : 'delivered', customer_total: 860, selected_store_count: 1, payment_method: 'bank_transfer', created_at: '2026-11-12T10:00:00Z', order_items: ids.map((id, i) => ({id, store_name: `Mağaza ${i + 1}`, product_name: 'Test Ürün', size: 'M', color: 'Siyah', estimated_price: 100}))}];
          else if (p === '/rest/v1/customer_addresses' || p.endsWith('list_support_tickets_v3') || p.endsWith('list_order_activity') || p.endsWith('get_order_courier_position')) data = [];
          else if (p.endsWith('get_order_product_photos')) {
            photoCalls++;
            const batch = request.postDataJSON().target_item_ids;
            assert.ok(batch.length <= 3 && batch.every(id => ids.includes(id)));
            if (scenario === 'history-logout' || scenario === 'history-inflight' || scenario === 'active-photo-inflight') await deferred;
            if (scenario === 'active-photo-failure' || (scenario === 'history-retry' && batch.includes(ids[3]) && !failedBatch)) { status = 503; data = {}; failedBatch = true; }
            else {
              data = batch.map(id => ({order_item_id: id, photo_base64: jpeg}));
              if (scenario === 'history' || scenario === 'history-inflight') data.push({order_item_id: batch[0], photo_base64: jpeg}, {order_item_id: foreign, photo_base64: jpeg}, {order_item_id: batch[1], photo_base64: '<svg onload=alert(1)>'});
            }
          } else if (p.endsWith('get_order_delivery_code')) data = [{delivery_code: '1234'}];
          else if (p === '/rest/v1/customer_billing_profiles') data = [{invoice_type: 'individual', company_name: 'Preserved Company', identity_number: '', billing_address: 'Preserved Address', postal_code: '34400'}];
          else if (p === '/rest/v1/customer_profile_photos') {
            profileReads++;
            assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
            const value = savedPhoto;
            if (scenario === 'profile-late-read' && profileReads === 1) await deferred;
            if (scenario === 'profile-unavailable') { status = 503; data = {}; }
            else data = [{user_id: scenario === 'profile-foreign' ? foreign : owner, photo_base64: value}];
          } else if (p.endsWith('update_customer_profile_secure')) {
            const body = request.postDataJSON(); writes.push(body);
            assert.equal(body.p_full_name, 'Test Müşteri'); assert.equal(body.p_phone, '+905300000000');
            assert.equal(body.p_company_name, 'Preserved Company'); assert.equal(body.p_billing_address, 'Preserved Address');
            assert.equal(body.p_invoice_type, 'individual'); assert.equal(body.p_postal_code, '34400');
            assert.ok(!('p_user_id' in body) && !('role' in body));
            if (scenario === 'profile-save-failure') { status = 503; data = {}; }
            else { savedPhoto = body.p_photo_base64; data = 'success'; }
          } else if (p === '/auth/v1/logout') data = {};
          else throw Error('Unexpected request/write: ' + p);
          try { await route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)}); }
          catch (error) { if (!['history-logout', 'profile-logout'].includes(scenario)) throw error; }
        });
        await page.goto(base + '/hesabim/'); await page.locator('#portal-view').waitFor();
        if (scenario.startsWith('history') || scenario.startsWith('active-photo-')) {
          if (scenario.startsWith('active-photo-')) {
            await page.locator('[data-view="orders"]').click();
            await page.locator('.delivery-code').waitFor();
            assert.equal(await page.locator('.delivery-code').textContent(), '1234', 'Photo failure must not hide the delivery code');
            assert.equal(await page.locator('.photo-preview').count(), 0);
            if (scenario === 'active-photo-inflight') { release(); await page.waitForFunction(() => document.querySelectorAll('#orders-list .photo-preview').length === 5); }
          } else {
            await page.locator('[data-view="profile"]').click(); await page.locator('#profile-history').click();
            const summary = page.locator('#history-list summary'); await summary.click();
            if (scenario === 'history-logout') {
              await page.waitForFunction(() => document.querySelector('#history-list details').open);
              await page.locator('[data-view="profile"]').click(); await page.locator('#logout-button').click();
              await page.locator('#auth-view').waitFor(); release();
              await page.waitForTimeout(200);
              assert.equal(await page.locator('#history-list img, .photo-expanded').count(), 0);
            } else {
              if (scenario === 'history-retry') {
                await page.getByText(/^(Fotoğraflar şu anda|Bazı ayrıntılar) alınamadı|^Fotoğraflar şu anda alınamıyor/).waitFor();
                assert.equal(await page.locator('#history-list .photo-preview').count(), 3);
                await summary.click(); await summary.click();
              }
              if (scenario === 'history-inflight') {
                await summary.click(); await summary.click(); await page.waitForTimeout(100);
                assert.equal(photoCalls, 1, 'Reopening a loading card must not start a parallel request'); release();
              }
              await page.waitForFunction(() => document.querySelectorAll('#history-list .photo-preview').length >= 5);
              assert.equal(await page.locator('#history-list .photo-preview').count(), 5, 'Retry must not duplicate already loaded photographs');
              assert.equal(await page.locator('#history-list .order-item-compact').count(), 5);
              assert.equal(await page.locator('#history-list .order-item-compact').evaluateAll(rows => rows.every(row => row.querySelectorAll('.photo-preview').length === 1)), true);
              assert.ok(!requests.some(p => p.endsWith('get_order_delivery_code')), 'Completed orders must not request delivery codes');
              const count = photoCalls; await summary.click(); await summary.click(); await page.waitForTimeout(100);
              assert.equal(photoCalls, count);
              await page.locator('#history-list .photo-preview').first().click();
              await page.getByRole('dialog', {name: 'Ürün fotoğrafı'}).waitFor();
              assert.equal(await page.locator('.photo-expanded').getAttribute('src'), `data:image/jpeg;base64,${jpeg}`);
              if (scenario === 'history') await page.screenshot({path: path.join(output, `history-${width}-${theme}.png`), fullPage: true});
              await page.keyboard.press('Escape');
            }
          }
          assert.equal(writes.length, 0);
        } else {
          await page.locator('[data-view="profile"]').click();
          if (scenario === 'profile-foreign' || scenario === 'profile-unavailable') {
            await page.locator('#profile-photo-status').waitFor();
            assert.equal(await page.locator('#profile-photo img[src^="data:"]').count(), 0);
            await page.locator('#profile-edit').click();
            await page.getByText('Profil bilgileri alınamadı. Biraz sonra tekrar dene.', {exact: true}).waitFor();
            assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(writes.length, 0);
          } else {
            if (scenario !== 'profile-late-read') await page.locator('#profile-photo img[src^="data:"]').waitFor();
            await page.locator('#profile-photo').click();
            const dialog = page.getByRole('dialog', {name: 'Profil ve fatura bilgileri'}); await dialog.waitFor();
            const save = dialog.getByRole('button', {name: 'Kaydet', exact: true});
            if (scenario === 'profile-preserve') {
              await save.click(); await dialog.waitFor({state: 'hidden'}); assert.equal(writes[0].p_photo_base64, jpeg);
            } else if (scenario === 'profile-remove' || scenario === 'profile-late-read') {
              await dialog.getByRole('button', {name: 'Profil fotoğrafını kaldır', exact: true}).click();
              await save.click(); await dialog.waitFor({state: 'hidden'}); assert.equal(writes[0].p_photo_base64, '');
              if (scenario === 'profile-late-read') { release(); await page.waitForTimeout(150); }
              assert.equal(await page.locator('#profile-photo img[src^="data:"]').count(), 0);
            } else {
              const file = dialog.locator('[name="profile_photo"]');
              if (scenario === 'profile-invalid') {
                await file.setInputFiles({name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not-an-image')});
                await dialog.locator('.status-error').waitFor();
                assert.equal(await dialog.locator('.profile-photo-avatar img').getAttribute('src'), `data:image/jpeg;base64,${jpeg}`);
                assert.equal(writes.length, 0); await save.click(); await dialog.waitFor({state: 'hidden'}); assert.equal(writes[0].p_photo_base64, jpeg);
              } else {
                if (scenario === 'profile-metadata') {
                  const source = Buffer.from(jpeg, 'base64'), marker = Buffer.from('Exif\0\0SYNTHETIC-LOCATION-METADATA');
                  const length = Buffer.alloc(2); length.writeUInt16BE(marker.length + 2);
                  const buffer = Buffer.concat([source.subarray(0, 2), Buffer.from([255, 225]), length, marker, source.subarray(2)]);
                  await file.setInputFiles({name: 'metadata-fixture.jpg', mimeType: 'image/jpeg', buffer});
                } else await file.setInputFiles(path.join(__dirname, '../assets/magazadanal-logo.png'));
                await page.waitForFunction(old => {
                  const image = document.querySelector('.profile-photo-editor img:not(.app-icon)');
                  return image && image.src !== `data:image/jpeg;base64,${old}` && !document.querySelector('.app-dialog-footer button').disabled;
                }, jpeg);
                const selected = (await dialog.locator('.profile-photo-avatar img').getAttribute('src')).split(',')[1];
                assert.match(selected, /^\/9j\//); assert.ok(selected.length <= 500000);
                assert.equal(Buffer.from(selected, 'base64').includes(Buffer.from('Exif\0\0')), false, 'Encoded output must not retain original EXIF markers');
                const size = await dialog.locator('.profile-photo-avatar img').evaluate(img => ({width: img.naturalWidth, height: img.naturalHeight}));
                assert.ok(size.width <= 640 && size.height <= 640);
                assert.equal(writes.length, 0, 'Selecting a photo must not save it before confirmation');
                if (scenario === 'profile-upload') {
                  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                  await page.screenshot({path: path.join(output, `profile-${width}-${theme}.png`), fullPage: true});
                }
                if (scenario === 'profile-cancel') {
                  await page.keyboard.press('Escape'); assert.equal(writes.length, 0);
                  assert.equal(await page.locator('#profile-photo img').getAttribute('src'), `data:image/jpeg;base64,${jpeg}`);
                } else if (scenario === 'profile-logout') {
                  await page.keyboard.press('Escape'); await page.locator('#logout-button').click();
                  await page.locator('#auth-view').waitFor();
                  assert.equal(await page.locator('img[src^="data:image"], .app-dialog').count(), 0); assert.equal(writes.length, 0);
                } else {
                  await save.click();
                  if (scenario === 'profile-save-failure') {
                    await dialog.locator('.status-error').waitFor();
                    assert.equal(await dialog.locator('.profile-photo-avatar img').getAttribute('src'), `data:image/jpeg;base64,${selected}`);
                    assert.equal(await save.isEnabled(), true); assert.equal(savedPhoto, jpeg);
                  } else {
                    await dialog.waitFor({state: 'hidden'}); assert.equal(writes[0].p_photo_base64, selected);
                    assert.equal(await page.locator('#profile-photo img').getAttribute('src'), `data:image/jpeg;base64,${selected}`);
                  }
                }
              }
            }
          }
        }
        assert.deepEqual(errors, []); results.push({scenario, width, theme, passed: true, simulatedWrites: writes.length});
        release(); await context.close();
      }
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({results,realAccountWrites:false,allBackendRequestsMocked:true}, null, 2));
  console.log(`PASS: ${results.length} photo parity scenarios; owner isolation, retries, delivery-code independence, metadata-free normalization, cancel and save verified. Synthetic backend only.`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});

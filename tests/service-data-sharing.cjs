const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const legal = require('../assets/legal-v13.json');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8768';
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-service-data-sharing-v8-web-20261108';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
async function main() {
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
  const results = [];
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        assert.equal(new URL(route.request().url()).origin, base, 'No external requests permitted');
        return route.continue();
      });
      await page.goto(base + '/privacy/');
      // KVKK v12 (2026-11-18): the page tells the courier and recipient sharing once; the purpose and legal-basis
      // paragraphs were duplicates of KVKK sections 2, 3 and 5 and are not repeated (same rule as service-data-sharing.test.cjs).
      const [purpose, courier, recipients, basis] = legal.service_data_notice.split('\n\n'), mainText = await page.locator('main').innerText();
      for (const paragraph of [courier, recipients]) assert.equal(mainText.split(paragraph).length, 2, paragraph);
      for (const paragraph of [purpose, basis]) assert.ok(!mainText.includes(paragraph), paragraph);
      assert.ok((await page.locator('main').innerText()).includes(legal.delivery_proof_notice));
      await page.getByRole('heading', {name:'9. Fotoğraflar ve sipariş konumu',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`sharing-notice-${width}.png`)});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(base + '/alisveris-kosullari/');
      await page.locator('#public-contracts details').nth(3).waitFor();
      assert.equal(await page.locator('#public-contracts details').count(), 4);
      for (const [index, doc] of legal.order.entries()) {
        const detail = page.locator('#public-contracts details').nth(index);
        await detail.locator('summary').click();
        assert.ok((await detail.locator('pre').innerText()).includes(legal.service_data_notice), doc.title);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), doc.title);
        if (doc.document_type === 'service_start') await page.screenshot({path:path.join(output,`service-start-${width}.png`),fullPage:true});
        await detail.locator('summary').click();
      }
      assert.deepEqual(errors, []);
      results.push({width,publicNotice:true,fourContracts:true,identicalSharedClause:true,noOverflow:true,noBrowserErrors:true});
      await page.close();
    }
    await fs.writeFile(path.join(output,'sharing-browser-verification.json'), JSON.stringify({verifiedAt:new Date().toISOString(),localOnly:true,externalNetwork:false,results},null,2)+'\n');
    console.log('PASS: identical v8 service-data clause renders in the public notice and all four contracts at desktop/mobile widths. No external requests.');
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode = 1;});

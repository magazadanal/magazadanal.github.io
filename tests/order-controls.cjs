const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8768';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-web-controls-20261107';
async function main() {
  await fs.mkdir(output,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const [width,theme,mode] of [[1280,'light','granted'],[390,'dark','denied'],[320,'light','unsupported'],[1280,'light','late']]) {
      const context = await browser.newContext({viewport:{width,height:900}}), page = await context.newPage(), calls = [], errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(({owner,theme,mode})=>{
        localStorage.setItem('magazadanal.web.theme.v1',theme);
        sessionStorage.setItem('magazadanal.web.session.v1',JSON.stringify({accessToken:'mock-token',refreshToken:'mock-refresh',expiresAt:Date.now()+3600000,user:{id:owner,email:'test@example.invalid'}}));
        if(mode==='unsupported') Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
        else Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>{
          if(mode==='denied') throw new DOMException('Denied','NotAllowedError');
          if(mode==='late') return new Promise(resolve=>{window.testResolvePaste=resolve;});
          return 'Product share\nhttps://www.beymen.com/test-product';
        }},configurable:true});
      },{owner,theme,mode});
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.origin===base)return route.continue();
        assert.equal(url.hostname,'zxqqbzggfbxoasyhueqb.supabase.co');
        calls.push(url.pathname);
        let data;
        if(url.pathname.endsWith('get_public_runtime_status'))data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if(url.pathname==='/rest/v1/profiles')data=[{id:owner,role:'customer',is_active:true,full_name:'Test Customer',phone:'+905301234567'}];
        else if(url.pathname==='/rest/v1/customer_addresses')data=[{id:'30000000-0000-4000-8000-000000000001',title:'Home',district:'Şişli',neighborhood:'Test',address_line:'Test',building_no:'1',building_name:'Test building',directions:'Test entry',latitude:41.07,longitude:29,is_invoice:true}];
        else if(['/rest/v1/orders','/rest/v1/rpc/list_order_activity','/rest/v1/rpc/list_support_tickets_v3'].includes(url.pathname))data=[];
        else throw Error('Unexpected write/request '+url.pathname);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/hesabim/');
      await page.locator('#portal-view').waitFor();
      const back=page.getByRole('button',{name:'Geri',exact:true});
      assert.ok(await back.isVisible());
      assert.equal(await page.locator('#welcome-title, .portal-toolbar').count(),0);
      await back.click();
      assert.ok(await page.locator('[data-panel="home"]').isVisible());
      assert.ok(await back.isHidden());
      await page.getByRole('button',{name:'Sipariş',exact:true}).click();
      await page.getByRole('button',{name:'Beymen',exact:true}).click();
      const link=page.locator('#order-product-link');
      assert.equal(await page.locator('.product-photo-preview img').count(),0);
      assert.equal(await page.locator('.product-photo-preview').textContent(),'');
      assert.ok(await page.locator('.product-photo-frame').isHidden());
      assert.equal(await page.getByRole('link',{name:'Ücretler, teslimat ve satış koşulları',exact:true}).count(),0);
      assert.ok(await page.getByRole('button',{name:'Fotoğrafı kaldır',exact:true}).isHidden());
      assert.ok(await page.getByRole('textbox',{name:'Mağaza şubesi',exact:true}).isVisible());
      assert.equal(await page.locator('details').filter({hasText:'Bu şubeden al'}).count(),0);
      await page.getByRole('button',{name:'Yapıştır',exact:true}).click();
      if(mode==='late') {
        await back.click();
        await page.getByRole('button',{name:'Mango',exact:true}).click();
        await page.evaluate(()=>window.testResolvePaste('https://example.invalid/late'));
        assert.equal(await link.inputValue(),'');
      } else {
        if(mode==='denied'||mode==='unsupported') {
          const dialog=page.getByRole('dialog',{name:'Ürün linki yapıştır'});
          await dialog.waitFor();
          const fallback=dialog.getByRole('textbox',{name:'Ürün linki',exact:true});
          assert.ok(await fallback.evaluate(node=>node===document.activeElement));
          await fallback.fill('javascript:alert(1)');
          await dialog.getByRole('button',{name:'Kullan',exact:true}).click();
          assert.ok(await dialog.isVisible());
          assert.equal(await link.inputValue(),'');
          if(mode==='denied') {
            await fallback.evaluate(node=>{
              const clipboardData=new DataTransfer();clipboardData.setData('text/plain','Shared\nhttps://www.beymen.com/test-product');
              node.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
            });
          } else {
            await fallback.fill('www.beymen.com/test-product');
            await fallback.press('Enter');
          }
          assert.ok(await dialog.isHidden());
        }
        assert.equal(await link.inputValue(),'https://www.beymen.com/test-product');
        await back.click(); await page.getByRole('button',{name:'Beymen',exact:true}).click();
        assert.equal(await link.inputValue(),'https://www.beymen.com/test-product');
      }
      await page.screenshot({path:path.join(output,`product-${width}-${theme}-${mode}.png`),fullPage:true});
      if(mode==='granted') {
        await page.getByRole('textbox',{name:'Mağaza şubesi',exact:true}).fill('Test store');
        await page.getByRole('textbox',{name:'Beden / boyut',exact:true}).fill('M');
        await page.getByRole('textbox',{name:'Renk',exact:true}).fill('Black');
        await page.getByRole('spinbutton',{name:'Tahmini ürün fiyatı (TL)',exact:true}).fill('100');
        await page.evaluate(({owner})=>{
          const key='magazadanal.web.draft.v1.'+owner,stored=JSON.parse(sessionStorage.getItem(key));
          stored.draft.editing.store_latitude=41.07;stored.draft.editing.store_longitude=29;
          sessionStorage.setItem(key,JSON.stringify(stored));
        },{owner});
        await page.reload(); await page.locator('#portal-view').waitFor();
        await page.getByRole('button',{name:'Sepete ekle',exact:true}).click();
        await page.locator('[name="saved_address"]').selectOption('30000000-0000-4000-8000-000000000001');
        assert.equal(await page.locator('.recipient-only [name="address_line"], .recipient-only [name="district"]').count(),0);
        assert.equal(await page.locator('.recipient-only button').count(),0);
        await page.locator('[name="customer_name"]').fill('Other Recipient');
        assert.equal(await page.locator('[name="saved_address"]').inputValue(),'30000000-0000-4000-8000-000000000001');
        await page.getByRole('button',{name:'Ödemeye geç',exact:true}).click();
        await page.getByRole('heading',{name:'Teslimat ve ödeme',exact:true}).waitFor();
        await page.locator('input[name="delivery"]').first().check();
        await page.locator('input[name="payment"]').check();
        await back.click();
        assert.ok(await page.getByRole('heading',{name:'Sepetim',exact:true}).isVisible());
        assert.equal(await page.locator('[name="customer_name"]').inputValue(),'Other Recipient');
        await back.click();
        assert.ok(await page.getByRole('heading',{name:'Hangi mağazadan alalım?',exact:true}).isVisible());
        await page.getByRole('button',{name:'Sepet (1)',exact:true}).click();
        await page.getByRole('button',{name:'Ödemeye geç',exact:true}).click();
        assert.equal(await page.locator('.choice-row input:checked').count(),2);
      }
      for(const view of ['orders','profile','cart','shop']) {
        await page.locator(`[data-view="${view}"]`).click();
        assert.equal(await page.locator('#welcome-title, .portal-toolbar').count(),0);
        assert.equal(await back.isVisible(),['cart','shop'].includes(view));
      }
      assert.ok(!calls.some(p=>/create_|save_|delete_|record_|logout/.test(p)));
      assert.deepEqual(errors,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await context.close();
    }
  } finally {await browser.close();}
  console.log('PASS: blank photo, fixed pickup section, clipboard permission/unsupported/shared-text/race cases; back navigation preserves checkout choices; greeting absent. Four local mocked cases, no server writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

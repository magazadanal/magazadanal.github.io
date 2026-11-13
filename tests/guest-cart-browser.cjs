const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8899';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-guest-cart-20261113';
const owner = '10000000-0000-4000-8000-000000000001';
const guestKey = 'magazadanal.web.guest-cart.v1';
const accountKey = `magazadanal.web.draft.v1.${owner}`;
const rules = require('../hesabim/order-rules.js');
const item = () => ({client_item_id:crypto.randomUUID(),store:'Beymen',branch:'Hesap şubesi',product_name:'Hesaptaki ürün',size:'M',color:'Siyah',estimated_price:500,product_link:'https://example.invalid/product',order_note:'',store_latitude:41.07,store_longitude:29});
async function main(){
  await fs.mkdir(output,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const results = [];
  try{
    for(const mode of ['empty','slow','existing','editing','expiry','pending','remove','quota','blocked','malformed','expired']){
      const context = await browser.newContext({viewport:{width:mode==='empty'?390:1280,height:900}}),page=await context.newPage(),calls=[],errors=[];
      let authenticated=false,expired=false;
      let releaseProfile;
      page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install({time:new Date()});
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.origin===base)return route.continue();
        if(url.hostname==='tile.openstreetmap.org')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64')});
        if(url.hostname==='challenges.cloudflare.com')return route.fulfill({contentType:'application/javascript',body:'window.turnstile={render(s,o){setTimeout(()=>o.callback("synthetic-guest-login-proof"),30)}};'});
        assert.equal(url.hostname,'zxqqbzggfbxoasyhueqb.supabase.co');
        const p=url.pathname;calls.push(p);let data;
        if(p.endsWith('get_public_runtime_status'))data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if(p==='/auth/v1/token'){
          assert.equal(req.postDataJSON().gotrue_meta_security.captcha_token,'synthetic-guest-login-proof');authenticated=true;
          data={access_token:'synthetic-guest-access',refresh_token:'synthetic-guest-refresh',expires_in:3600,user:{id:owner,email:'guest@example.invalid'}};
        }else{
          assert.ok(authenticated,`No anonymous private request: ${p}`);
          if(expired)return route.fulfill({status:401,contentType:'application/json',body:'{}'});
          if(p==='/rest/v1/profiles'){
            if(mode==='slow'&&!releaseProfile)await new Promise(resolve=>{releaseProfile=resolve;});
            data=[{id:owner,full_name:'Sentetik Müşteri',phone:'+905301234567',role:'customer',is_active:true}];
          }
          else if(['/rest/v1/customer_addresses','/rest/v1/orders','/rest/v1/customer_profile_photos','/rest/v1/rpc/list_support_tickets_v3','/rest/v1/rpc/list_order_activity'].includes(p))data=[];
          else throw Error(`Unexpected private write or lookup: ${p}`);
        }
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      if(['existing','editing','expiry','pending'].includes(mode)){
        const draft=rules.newDraft();draft.items=[item()];
        if(mode==='editing')draft.editing={...item(),product_name:'Yarım kalan ürün',size:'XS'};
        const frozen=mode==='pending'?{payload:{p_client_request_id:draft.requestID,items:structuredClone(draft.items)},expectedAmount:860}:null;
        await page.addInitScript(({key,row})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(row));},{key:accountKey,row:{owner,updated:Date.now(),draft,stage:'stores',checkout:false,frozen}});
      }
      if(mode==='malformed')await page.addInitScript(key=>{if(!sessionStorage.getItem('synthetic-fixture')){sessionStorage.setItem(key,'invalid-json');sessionStorage.setItem('synthetic-fixture','1');}},guestKey);
      if(mode==='expired')await page.addInitScript(({key,row})=>{if(!sessionStorage.getItem('synthetic-fixture')){sessionStorage.setItem(key,JSON.stringify(row));sessionStorage.setItem('synthetic-fixture','1');}},{key:guestKey,row:{owner:null,updated:Date.now()-86400001,draft:{...rules.newDraft(),items:[item()]}}});
      if(mode==='blocked')await page.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('Synthetic storage restriction');}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('Synthetic storage restriction');}});});
      await page.goto(base+'/hesabim/?view=shop');await page.getByRole('button',{name:'Beymen',exact:true}).waitFor();
      await page.getByRole('button',{name:'Beymen',exact:true}).click();
      await page.locator('[name="product_link"]').fill('https://example.invalid/guest');
      await page.locator('[name="size"]').fill('S');await page.locator('[name="color"]').fill('Mavi');await page.locator('[name="estimated_price"]').fill('100');
      await page.locator('[name="order_note"]').fill('Misafir ürünü');
      await page.locator('input[type="file"]').setInputFiles(path.join(__dirname,'../assets/magazadanal-logo.png'));
      await page.locator('.product-photo-preview img').waitFor();
      await page.getByRole('button',{name:'Mağaza konumu seç',exact:true}).click();
      assert.ok(await page.locator('.map-search-form').isHidden(),'Authenticated search is not exposed to guests');
      await page.locator('.app-map').click({position:{x:120,y:130}});await page.getByRole('button',{name:'Bu konumu kullan',exact:true}).click();
      await page.getByRole('button',{name:'Sepete ekle',exact:true}).click();
      await page.locator('.cart-item').waitFor();assert.equal(await page.locator('.cart-item').count(),1);
      assert.ok(await page.locator('.cart-item img').first().isVisible());
      assert.equal(await page.locator('[name="customer_name"],[name="saved_address"]').count(),0);
      assert.equal(await page.getByRole('button',{name:'Öde ve onayla',exact:true}).count(),0);
      assert.ok(calls.every(p=>p.endsWith('get_public_runtime_status')),'Guests only use the public runtime API');
      await page.getByRole('button',{name:'Düzenle',exact:true}).click();await page.locator('[name="size"]').fill('L');await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
      assert.ok((await page.locator('.cart-item').innerText()).includes('L · Mavi'));
      if(!['blocked','quota'].includes(mode)){
        await page.reload();await page.getByRole('button',{name:'Beymen',exact:true}).waitFor();await page.locator('[data-view="cart"]').click();
        assert.equal(await page.locator('.cart-item').count(),1,'Guest cart survives reload');
      }
      if(mode==='quota')await page.evaluate(()=>Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('Synthetic quota exceeded');}}));
      if(mode==='remove'){
        await page.getByRole('button',{name:'Ürünü kaldır',exact:true}).click();await page.getByRole('button',{name:'Kaldır',exact:true}).click();
        assert.equal(await page.locator('.cart-item').count(),0);assert.ok(await page.getByText('Sepetin boş.',{exact:true}).isVisible());
      }else if(['blocked','quota'].includes(mode)){
        await page.getByRole('button',{name:'Giriş yap ve siparişi tamamla',exact:true}).click();await page.locator('#auth-view').waitFor();
        await page.locator('[data-view="cart"]').click();assert.equal(await page.locator('.cart-item').count(),1,'Storage failure preserves the in-memory cart');
      }else{
        const oldDraft=await page.evaluate(key=>sessionStorage.getItem(key),accountKey);
        await page.screenshot({path:path.join(output,`guest-cart-${mode}.png`),fullPage:true});
        await page.getByRole('button',{name:'Giriş yap ve siparişi tamamla',exact:true}).click();
        await page.locator('#login-email').fill('guest@example.invalid');await page.locator('#login-password').fill('synthetic-password');await page.locator('#login-button').click();
        if(mode==='slow'){
          await page.locator('.session-restoring').waitFor();
          assert.ok(await page.locator('#portal-view').isHidden(),'No empty-cart interstitial while the account is loading');
          assert.ok(await page.locator('#auth-view').isHidden(),'Login form is not shown again after successful sign-in');
          await page.screenshot({path:path.join(output,'slow-login-loading.png')});
          while(!releaseProfile)await new Promise(resolve=>setTimeout(resolve,10));
          releaseProfile();
        }
        await page.locator('[data-panel="cart"]').waitFor();
        if(mode==='pending')await page.getByRole('button',{name:'Aynı talebi kontrol et',exact:true}).waitFor();
        else await page.locator('[name="customer_name"]').waitFor();
        if(['existing','editing'].includes(mode)){
          assert.equal(await page.locator('.cart-item').count(),1,'Existing cart is not silently merged');
          assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).draft.items[0].product_name,accountKey),'Hesaptaki ürün');
          await page.getByRole('button',{name:'Misafir ürünlerini sepete ekle',exact:true}).click();await page.getByRole('button',{name:'Ürünleri ekle',exact:true}).click();
          assert.equal(await page.locator('.cart-item').count(),2);
          if(mode==='editing')assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).draft.editing.product_name,accountKey),'Yarım kalan ürün','Merge preserves unfinished account edits');
        }else if(mode==='expiry'){
          expired=true;await page.clock.fastForward(16000);await page.locator('#auth-view').waitFor();
          await page.locator('[data-view="cart"]').click();assert.equal(await page.locator('.cart-item').count(),1);
          assert.ok((await page.locator('.cart-item').innerText()).includes('₺100,00'),'Expired account data is not promoted to a guest cart');
          await page.getByRole('button',{name:'Düzenle',exact:true}).click();await page.locator('[name="size"]').fill('XL');await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
          assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).draft.items[0].size,guestKey),'XL','Deferred guest cart survives expiry and another edit');
        }else if(mode==='pending'){
          await page.getByRole('button',{name:'Aynı talebi kontrol et',exact:true}).waitFor();
          const stored=await page.evaluate(key=>sessionStorage.getItem(key),accountKey);
          assert.deepEqual(JSON.parse(stored).frozen,JSON.parse(oldDraft).frozen,'Uncertain submission stays immutable');
          assert.notEqual(await page.evaluate(key=>sessionStorage.getItem(key),guestKey),null,'Guest cart stays separate');
          assert.equal(await page.getByRole('button',{name:'Misafir ürünlerini sepete ekle',exact:true}).count(),0);
        }else{
          assert.equal(await page.locator('.cart-item').count(),1);assert.ok(await page.locator('[name="customer_name"]').isVisible());
          const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),accountKey);
          assert.equal(saved.owner,owner);assert.ok(rules.UUID.test(saved.draft.requestID));assert.equal(saved.draft.items[0].order_note,'Misafir ürünü');
        }
        if(!['pending','expiry'].includes(mode)){
          assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),guestKey),null);
          assert.ok(await page.locator('[name="customer_name"]').isVisible());
          await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');await page.locator('[data-view="cart"]').click();
          assert.equal(await page.locator('.cart-item').count(),['existing','editing'].includes(mode)?2:1,'No duplicate guest import after reload');
        }
      }
      assert.deepEqual(errors,[]);results.push({mode,passed:true,noOrderOrPaymentWrites:true});await context.close();
    }
  }finally{await browser.close();}
  await fs.writeFile(path.join(output,'guest-verification.json'),JSON.stringify({results,allBackendRequestsMocked:true},null,2));
  console.log(`PASS: ${results.length} guest cart cases: manual map/photo/edit/reload, authenticated handoff, explicit merge, immutable pending request, quota/blocked/expired/malformed storage; no order or payment writes.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

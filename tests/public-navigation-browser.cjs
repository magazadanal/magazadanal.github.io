const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.SITE_TEST_URL||'http://127.0.0.1:8899';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output=process.env.SITE_SCREENSHOT_DIR||'/private/tmp/ma-public-navigation-20261113';
async function main(){
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const results=[],storageResults=[];
  try{
    for(const [width,height,theme] of [[1280,900,'light'],[1280,900,'dark'],[1215,360,'light'],[900,700,'dark'],[899,800,'light'],[768,900,'dark'],[390,844,'light'],[320,568,'dark']]){
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[],calls=[];
      page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(theme=>localStorage.setItem('magazadanal.web.theme.v1',theme),theme);
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===base)return route.continue();
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co','No real external service');
        calls.push({path:url.pathname,method:request.method()});
        assert.equal(url.pathname,'/rest/v1/rpc/get_public_runtime_status','Guest must not read/write private account data');
        return route.fulfill({contentType:'application/json',body:JSON.stringify([{customer_web_account_enabled:true,customer_ordering_enabled:true}])});
      });
      async function menu(id){
        const nav=page.locator(id);await nav.waitFor();assert.equal(await nav.locator('.portal-tab').count(),5);
        assert.equal(await nav.evaluate(n=>getComputedStyle(n).position),'fixed');
        const rect=await nav.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
        if(width>=900){
          const header=await page.locator('header').boundingBox();assert.ok(rect.y>=header.y+header.height+12,'Sidebar stays below the header');
          assert.ok(rect.y+rect.height<=height-12,'Short sidebar stays within viewport');
          const body=await page.locator(id==='#home-sidebar'?'.home-main > .home-intro':'.portal-content').boundingBox();assert.ok(rect.x+rect.width<body.x,'Content stays to the right');
        }else assert.ok(Math.abs(rect.y+rect.height-height)<2,'Narrow-screen menu stays at the bottom');
        await page.evaluate(()=>scrollTo(0,700));assert.ok(Math.abs((await nav.boundingBox()).y-rect.y)<1,'Menu stays fixed while scrolling');
        await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
      }
      await page.goto(base+'/');await menu('#home-sidebar');assert.ok(await page.locator('#home-account-link').isVisible());
      await page.screenshot({path:path.join(output,`guest-home-${width}-${height}-${theme}.png`)});
      await page.locator('#home-sidebar [href="/hesabim/?view=shop"]').click();
      await page.locator('#login-button:not(:disabled)').waitFor();await menu('#account-sidebar');
      assert.ok(await page.locator('#auth-view').isVisible());assert.ok(await page.locator('#portal-view').isHidden());
      for(const view of ['shop','cart','orders','profile']){
        const button=page.locator(`#account-sidebar [data-view="${view}"]`);await button.scrollIntoViewIfNeeded();await button.click();
        assert.ok(await page.locator('#auth-view').isVisible());assert.ok(await page.locator('#portal-view').isHidden());
        assert.equal(await page.locator('#auth-status').innerText(),'Devam etmek için hesabına giriş yap.');
        assert.equal(await page.getByRole('button',{name:'Öde ve onayla',exact:true}).count(),0);
      }
      await page.locator('#login-email').fill('not-a-real-account@example.invalid');await page.locator('#login-button').click();
      assert.ok(await page.locator('#auth-status').isVisible());assert.ok(calls.every(c=>c.path.endsWith('get_public_runtime_status')));
      await page.screenshot({path:path.join(output,`guest-login-${width}-${height}-${theme}.png`)});
      await page.locator('#signup-toggle').click();await page.locator('#signup-name').fill('Sentetik');
      await page.locator('#account-sidebar [data-view="shop"]').click();assert.equal(await page.locator('#signup-name').inputValue(),'Sentetik');
      assert.ok(await page.locator('#signup-form').isVisible());await menu('#account-sidebar');
      await page.locator('#account-sidebar [data-view="home"]').click();await page.waitForURL(base+'/');await menu('#home-sidebar');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
      assert.deepEqual(errors,[]);results.push({width,height,theme,passed:true,privateRequests:0});await context.close();
    }
    for(const mode of ['malformed','blocked','expired']){
      const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage(),calls=[];
      await page.addInitScript(mode=>{
        if(mode==='malformed')sessionStorage.setItem('magazadanal.web.session.v1','invalid-json');
        if(mode==='expired')sessionStorage.setItem('magazadanal.web.session.v1',JSON.stringify({accessToken:'synthetic-expired',refreshToken:'synthetic-expired-refresh',expiresAt:1,user:{id:'10000000-0000-4000-8000-000000000001'}}));
        if(mode==='blocked')Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('Synthetic restricted storage');}});
      },mode);
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());if(url.origin===base)return route.continue();
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co');calls.push(url.pathname);
        if(url.pathname.endsWith('get_public_runtime_status'))return route.fulfill({contentType:'application/json',body:'[{"customer_web_account_enabled":true,"customer_ordering_enabled":true}]'});
        assert.equal(mode,'expired');assert.equal(url.pathname,'/auth/v1/token');
        return route.fulfill({status:401,contentType:'application/json',body:'{}'});
      });
      await page.goto(base+'/hesabim/?view=shop');await page.locator('#login-button:not(:disabled)').waitFor();
      assert.ok(await page.locator('#account-sidebar').isVisible());assert.ok(await page.locator('#portal-view').isHidden());
      await page.locator('#account-sidebar [data-view="cart"]').click();assert.ok(await page.locator('#auth-view').isVisible());
      assert.ok(calls.every(p=>p.endsWith('get_public_runtime_status')||p==='/auth/v1/token'));
      storageResults.push({mode,passed:true,privateRequests:0});await context.close();
    }
  }finally{await browser.close();}
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({results,storageResults,allBackendRequestsMocked:true,noActualAccountOrOrderChanges:true},null,2));
  console.log('PASS: eight guest navigation viewport/theme cases and three restricted/malformed/expired-storage cases; fixed menu on home/login/signup, no overlap, preserved fields, protected sections and no anonymous private API/order requests.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

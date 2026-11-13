const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright'),R=require('../hesabim/order-rules.js');
const base=process.env.SITE_TEST_URL||'http://127.0.0.1:8899';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output=process.env.SITE_SCREENSHOT_DIR||'/private/tmp/ma-cart-login-loading-20261113';
const users={
  A:{id:'10000000-0000-4000-8000-000000000001',name:'Alpha Müşteri',email:'a@example.invalid',price:100,order:'20000000-0000-4000-8000-000000000001'},
  B:{id:'10000000-0000-4000-8000-000000000002',name:'Beta Müşteri',email:'b@example.invalid',price:200,order:'20000000-0000-4000-8000-000000000002'}
};
async function main(){
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),calls=[],errors=[];
  let foreignProfile=false,refreshes=0;
  try{
    const routeHandler=async route=>{
      const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
      if(url.hostname==='challenges.cloudflare.com')return route.fulfill({contentType:'application/javascript',body:'window.turnstile={render(s,o){setTimeout(()=>o.callback("synthetic-isolation-proof"),30)}};'});
      assert.equal(url.hostname,'zxqqbzggfbxoasyhueqb.supabase.co');const p=url.pathname,body=req.postDataJSON();let data;
      if(p.endsWith('get_public_runtime_status'))data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
      else if(p==='/auth/v1/token'){
        const refreshing=url.searchParams.get('grant_type')==='refresh_token';
        if(refreshing)refreshes++;else assert.equal(body.gotrue_meta_security.captcha_token,'synthetic-isolation-proof');
        const entry=Object.entries(users).find(([account,u])=>refreshing?body.refresh_token===`synthetic-refresh-${account}`:u.email===body.email);assert.ok(entry);
        data={access_token:`synthetic-access-${entry[0]}`,refresh_token:`synthetic-refresh-${entry[0]}`,expires_in:3600,user:{id:entry[1].id,email:entry[1].email}};
      }else{
        const account=req.headers().authorization?.match(/^Bearer synthetic-access-([AB])$/)?.[1];assert.ok(account,`Private request needs its own token: ${p}`);
        const user=users[account];calls.push({account,path:p});
        if(p==='/rest/v1/profiles'){
          assert.equal(url.searchParams.get('id'),`eq.${user.id}`);
          data=[{id:foreignProfile&&account==='B'?users.A.id:user.id,role:'customer',is_active:true,full_name:user.name,phone:'+905301234567'}];
        }else if(p==='/rest/v1/orders'){
          assert.equal(url.searchParams.get('customer_id'),`eq.${user.id}`);
          data=[{id:user.order,order_no:account==='A'?'000101':'000202',status:'delivered',customer_total:user.price+360,created_at:'2026-11-13T10:00:00Z',order_items:[]}];
        }else if(p==='/rest/v1/customer_addresses'){
          assert.equal(url.searchParams.get('customer_id'),`eq.${user.id}`);data=[];
        }else if(p.endsWith('list_order_activity')){assert.deepEqual(body.target_order_ids,[user.order]);data=[];}
        else if(p.endsWith('list_support_tickets_v3'))data=[{id:crypto.randomUUID(),message:`Sadece ${account}`,status:'closed',created_at:'2026-11-13T10:00:00Z',replies:[]}];
        else if(p==='/rest/v1/customer_profile_photos'){assert.equal(url.searchParams.get('user_id'),`eq.${user.id}`);data=[];}
        else if(p==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');data={};}
        else throw Error(`Unexpected write or private endpoint: ${p}`);
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    };
    await context.route('**/*',routeHandler);
    const pages={};
    for(const account of ['A','B']){
      const page=await context.newPage();pages[account]=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
      const draft=R.newDraft();draft.items=[{client_item_id:crypto.randomUUID(),store:'Beymen',branch:`${account} şubesi`,product_name:`${account} ürünü`,size:'M',color:'Mavi',estimated_price:users[account].price,product_link:'https://example.invalid/product',store_latitude:41.07,store_longitude:29}];
      await page.addInitScript(({id,draft})=>sessionStorage.setItem(`magazadanal.web.draft.v1.${id}`,JSON.stringify({owner:id,updated:Date.now(),draft,stage:'stores',checkout:false,frozen:null})),{id:users[account].id,draft});
      await page.goto(base+'/hesabim/');await page.locator('#login-email').fill(users[account].email);await page.locator('#login-password').fill('synthetic-password');await page.locator('#login-button').click();
      if(account==='B'){
        await page.getByText('Bu tarayıcıda başka bir hesap açık. Önce tarayıcıdaki oturumu kapat.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
        assert.ok(!calls.some(call=>call.account==='B'&&call.path.startsWith('/rest/')),'Rejected account never reads private records');
        await page.screenshot({path:path.join(output,'second-account-blocked.png')});
        continue;
      }
      await page.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');await page.locator('[data-view="cart"]').click();
      assert.equal(await page.locator('.cart-item').count(),1);assert.ok((await page.locator('.cart-item').innerText()).includes(`${account} ürünü`));
      assert.ok(!(await page.locator('.cart-item').innerText()).includes(`${account==='A'?'B':'A'} ürünü`));
      await page.locator('[data-view="profile"]').click();assert.equal(await page.locator('#profile-name').innerText(),account==='A'?'Alpha':'Beta');
      await page.locator('[data-open-view="support"]').click();assert.ok(await page.getByText(`Sadece ${account}`,{exact:true}).isVisible());
      assert.equal(await page.getByText(`Sadece ${account==='A'?'B':'A'}`,{exact:true}).count(),0);
    }
    for(const account of ['A']){
      await pages[account].locator('[data-view="profile"]').click();await pages[account].locator('[data-open-view="history"]').click();
      assert.ok((await pages[account].locator('#history-list').innerText()).includes(account==='A'?'000101':'000202'));
      assert.ok(!(await pages[account].locator('#history-list').innerText()).includes(account==='A'?'000202':'000101'));
    }
    const sameAccount=await context.newPage();
    await sameAccount.goto(base+'/hesabim/');await sameAccount.locator('#login-email').fill(users.A.email);await sameAccount.locator('#login-password').fill('synthetic-password');await sameAccount.locator('#login-button').click();
    await sameAccount.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');
    const originalMarker=await sameAccount.evaluate(()=>JSON.parse(sessionStorage.getItem('magazadanal.web.session.v1')).browserSessionID);
    await sameAccount.evaluate(()=>{const key='magazadanal.web.session.v1',session=JSON.parse(sessionStorage.getItem(key));session.expiresAt=Date.now()-1;sessionStorage.setItem(key,JSON.stringify(session));});
    await sameAccount.reload();await sameAccount.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');
    assert.ok(refreshes>0,'Token refresh remains available for the same browser account');
    assert.equal(await sameAccount.evaluate(()=>JSON.parse(sessionStorage.getItem('magazadanal.web.session.v1')).browserSessionID),originalMarker);
    const retiredSession=await sameAccount.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1'));
    const anotherDevice=await browser.newContext();await anotherDevice.route('**/*',routeHandler);
    const independent=await anotherDevice.newPage();
    await independent.goto(base+'/hesabim/');await independent.locator('#login-email').fill(users.B.email);await independent.locator('#login-password').fill('synthetic-password');await independent.locator('#login-button').click();
    await independent.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');
    assert.equal(await pages.A.evaluate(()=>document.documentElement.dataset.sessionState),'signed-in');
    await pages.B.locator('#browser-session-reset').click();
    await pages.A.getByText('Bu tarayıcıdaki oturum kapatıldı. Yeniden giriş yap.',{exact:true}).waitFor();
    await sameAccount.getByText('Bu tarayıcıdaki oturum kapatıldı. Yeniden giriş yap.',{exact:true}).waitFor();
    assert.equal(await pages.A.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
    assert.ok(await pages.A.evaluate(id=>sessionStorage.getItem(`magazadanal.web.draft.v1.${id}`),users.A.id),'Browser logout retains account-owned cart drafts');
    assert.equal(await independent.evaluate(()=>document.documentElement.dataset.sessionState),'signed-in','Another device is unaffected');
    await pages.B.locator('#login-password').fill('synthetic-password');await pages.B.locator('#login-button').click();
    await pages.B.waitForFunction(()=>document.documentElement.dataset.sessionState==='signed-in');
    await pages.B.locator('[data-view="cart"]').click();assert.ok((await pages.B.locator('.cart-item').innerText()).includes('B ürünü'));
    assert.ok(!(await pages.B.locator('.cart-item').innerText()).includes('A ürünü'));
    await sameAccount.evaluate(value=>sessionStorage.setItem('magazadanal.web.session.v1',value),retiredSession);
    await sameAccount.reload();
    await sameAccount.getByText('Bu tarayıcıdaki oturum kapatıldı. Yeniden giriş yap.',{exact:true}).waitFor();
    assert.ok(await sameAccount.locator('#portal-view').isHidden(),'Retired sessions cannot silently reclaim the browser');
    assert.equal(await pages.B.evaluate(()=>document.documentElement.dataset.sessionState),'signed-in');
    await pages.B.locator('[data-view="profile"]').click();
    await Promise.all([pages.B.waitForEvent('framenavigated',frame=>frame===pages.B.mainFrame()),pages.B.locator('#logout-button').click()]);
    await pages.B.locator('#auth-view').waitFor();
    foreignProfile=true;
    await pages.B.locator('#login-email').fill(users.B.email);await pages.B.locator('#login-password').fill('synthetic-password');await pages.B.locator('#login-button').click();
    await pages.B.getByText('Müşteri profilin doğrulanamadı. Lütfen Bize Ulaşın üzerinden destek iste.',{exact:true}).waitFor();
    assert.ok(await pages.B.locator('#portal-view').isHidden(),'Foreign-owner profile responses never become an authenticated screen');
    assert.equal(await pages.B.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'session-isolation-verification.json'),JSON.stringify({passed:true,singleAccountPerBrowser:true,sameAccountMultipleTabs:true,otherDeviceIndependent:true,accountOwnedDraftsPreserved:true,retiredSessionRejected:true,foreignProfileRejected:true,privateCalls:calls.length,allBackendRequestsMocked:true,noRealAccountOrOrderChanges:true},null,2));
    console.log('PASS: a second account is blocked, same-account tabs work, browser logout retains private drafts, retired sessions fail, another device remains signed in, and foreign profiles stay rejected. All responses synthetic.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});

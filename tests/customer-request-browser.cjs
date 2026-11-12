const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8898';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const order = '20000000-0000-4000-8000-000000000001';
const old = {id:'30000000-0000-4000-8000-000000000002',order_id:order,action:'alternative_requested',message:'Eski alternatif',current_assignment:true,created_at:'2026-11-13T00:00:00.000001Z'};
const latest = {...old,id:'30000000-0000-4000-8000-000000000001',message:'Güncel alternatif',created_at:'2026-11-13T00:00:00.000002Z'};
async function main() {
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-customer-requests-20261113';
  await fs.mkdir(output,{recursive:true});
  try {
    for (const scenario of ['desktop-approve','mobile-reject','answered','reassigned','terminal','double-click','detached','late-logout']) {
      const context = await browser.newContext({viewport:{width:scenario.startsWith('desktop')?1280:390,height:900}});
      const page = await context.newPage(), errors=[], writes=[];
      page.on('pageerror',error=>errors.push(error.message)); page.setDefaultTimeout(12000);
      await page.addInitScript(owner=>{if(!sessionStorage.getItem('request-test-logout'))sessionStorage.setItem('magazadanal.web.session.v1',JSON.stringify({accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,user:{id:owner,email:'synthetic@example.invalid'}}));},owner);
      let events=[old,{...latest,current_assignment:scenario!=='reassigned'}], release, entered=false;
      const pending = new Promise(resolve=>{release=resolve;});
      if (scenario==='answered') events.push({id:'40000000-0000-4000-8000-000000000001',order_id:order,request_id:latest.id,action:'alternative_approved',created_at:'2026-11-13T00:01:00Z'});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===base) return route.continue();
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co','No live provider/backend access');
        const p=url.pathname;let data;
        if(p.endsWith('get_public_runtime_status')) data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if(p==='/rest/v1/profiles') data=[{id:owner,role:'customer',full_name:'Synthetic Customer',phone:'+905300000000',is_active:true}];
        else if(p==='/rest/v1/orders') data=[{id:order,order_no:'000001',status:scenario==='terminal'?'delivered':'courier_assigned',selected_store_count:1,customer_total:460,created_at:'2026-11-12T11:00:00Z',order_items:[]}];
        else if(p.endsWith('list_order_activity')) data=events;
        else if(p.endsWith('customer_respond_to_order_request')) {
          const payload=request.postDataJSON();assert.equal(payload.target_order_id,order);assert.equal(payload.target_request_id,latest.id);writes.push(payload);entered=true;
          if(['double-click','late-logout'].includes(scenario)) await pending;
          events.push({id:'40000000-0000-4000-8000-000000000002',order_id:order,request_id:latest.id,action:payload.response_name,created_at:'2026-11-13T00:02:00Z'});data='success';
        } else if(p.endsWith('get_order_delivery_code')) data=[{delivery_code:'1234'}];
        else if(p.endsWith('get_order_courier_position')||p==='/rest/v1/customer_addresses'||p==='/rest/v1/customer_profile_photos'||p.endsWith('list_support_tickets_v3')) data=[];
        else if(p==='/auth/v1/logout') data={};
        else throw Error('Unexpected request/write: '+p);
        try {await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});} catch(error) {if(scenario!=='late-logout')throw error;}
      });
      await page.goto(base+'/hesabim/?view=orders');
      await page.locator('#portal-view:not([hidden])').waitFor();
      const approve=page.getByRole('button',{name:'Onayla',exact:true}),reject=page.getByRole('button',{name:'Reddet',exact:true});
      if(['answered','reassigned','terminal'].includes(scenario)) {
        await page.locator('#portal-loading[hidden]').waitFor({state:'attached'});assert.equal(await approve.count(),0,scenario);assert.equal(await reject.count(),0,scenario);assert.equal(writes.length,0);
      } else {
        await approve.first().waitFor();assert.equal(await approve.count(),1,'Only the latest alternative has an approval button');assert.equal(await reject.count(),1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        if(scenario==='detached') {
          await approve.evaluate(button=>{window.oldAlternativeButton=button;});
          events=[old,{...latest,id:'30000000-0000-4000-8000-000000000003',message:'Daha yeni alternatif',created_at:'2026-11-13T00:00:01Z'}];
          await page.locator('.app-disclosure').getByText('Alternatif ürün: Daha yeni alternatif',{exact:true}).waitFor();
          await page.evaluate(()=>window.oldAlternativeButton.click());await page.waitForTimeout(150);assert.equal(writes.length,0);
        } else {
          if(scenario==='desktop-approve'||scenario==='mobile-reject') await page.screenshot({path:path.join(output,scenario+'.png'),fullPage:true});
          if(scenario==='double-click') await approve.evaluate(button=>{button.click();button.click();});
          else await (scenario==='mobile-reject'?reject:approve).click();
          for(let i=0;i<40&&!entered;i++)await page.waitForTimeout(25);assert.ok(entered);
          if(scenario==='late-logout'){await page.evaluate(()=>sessionStorage.setItem('request-test-logout','1'));await page.locator('[data-view="profile"]').click();await page.locator('#logout-button').click();await page.locator('#auth-view:not([hidden])').waitFor();}
          release();
          if(scenario!=='late-logout') await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='Onayla'));
          else {await page.waitForTimeout(150);assert.equal(await page.locator('#portal-status:not([hidden])').count(),0);assert.equal(await page.locator('#portal-view:not([hidden])').count(),0);}
          assert.equal(writes.length,1);assert.equal(writes[0].response_name,scenario==='mobile-reject'?'alternative_rejected':'alternative_approved');
        }
      }
      assert.deepEqual(errors,[]);release();await context.close();
    }
  } finally {await browser.close();}
  console.log('PASS: eight synthetic alternative-request browser scenarios; latest microsecond request only, exact approve/reject ID, no old/answered/reassigned/terminal controls, double-click, detached button and logout isolation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

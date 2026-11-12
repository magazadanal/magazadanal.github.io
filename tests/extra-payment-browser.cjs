const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8892';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const orderID = '20000000-0000-4000-8000-000000000001';
const event = {id:'30000000-0000-4000-8000-000000000001',order_id:orderID,action:'extra_payment_requested',current_assignment:true,amount:100.5,created_at:'2026-11-12T12:00:01Z'};
const payment = {id:'40000000-0000-4000-8000-000000000001',order_id:orderID,purpose:'adjustment',direction:'charge',method:'bank_transfer',status:'pending',amount:100.5,transfer_code:'EK-0123456789AB',created_at:'2026-11-12T12:00:00Z'};
async function main() {
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const scenario of ['desktop','mobile','mismatch','stale','invalid-code','unavailable','changed-before-report']) {
      const context = await browser.newContext({viewport:{width:scenario==='desktop'?1280:390,height:950}});
      const page = await context.newPage(), errors = [], responses = [];
      page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(owner=>sessionStorage.setItem('magazadanal.web.session.v1',JSON.stringify({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,user:{id:owner,email:'synthetic@example.invalid'}})),owner);
      let reads=0, activityReads=0, reported=false;
      await context.route('**/*',async route=>{
        const request = route.request(), url = new URL(request.url());
        if (url.origin===base) return route.continue();
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co','No live backend/provider request');
        let data;
        if (url.pathname.endsWith('get_public_runtime_status')) data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if (url.pathname==='/rest/v1/profiles') data=[{id:owner,role:'customer',full_name:'Synthetic Customer',phone:'+905300000000',is_active:true}];
        else if (url.pathname==='/rest/v1/orders') data=[{id:orderID,order_no:'000001',status:'courier_assigned',selected_store_count:1,customer_total:460,created_at:'2026-11-12T11:00:00Z',order_items:[]}];
        else if (url.pathname.endsWith('list_order_activity')) {
          activityReads++;
          data=[event];
          if (scenario==='stale'&&activityReads>1) data.push({...event,id:payment.id,created_at:'2026-11-12T12:00:02Z'});
          if (reported) data.push({order_id:orderID,request_id:event.id,action:'extra_payment_reported',created_at:'2026-11-12T12:01:00Z'});
        } else if (url.pathname==='/rest/v1/payments') {
          reads++; assert.equal(url.searchParams.get('order_id'),'eq.'+orderID); assert.equal(url.searchParams.get('purpose'),'eq.adjustment'); assert.equal(url.searchParams.get('status'),'eq.pending'); assert.equal(url.searchParams.get('limit'),'2');
          if (scenario==='unavailable') return route.fulfill({status:503,contentType:'application/json',body:'{}'});
          data=[{...payment,...(scenario==='mismatch'?{amount:101}:{}),...(scenario==='invalid-code'?{transfer_code:'EK-2026-000001'}:{}),...(scenario==='changed-before-report'&&reads>1?{id:'40000000-0000-4000-8000-000000000002',transfer_code:'EK-ABCDEF012345'}:{})}];
        } else if (url.pathname.endsWith('customer_respond_to_order_request')) {
          const payload=request.postDataJSON(); assert.deepEqual(payload,{target_order_id:orderID,target_request_id:event.id,response_name:'extra_payment_reported'});
          responses.push(payload);reported=true;data='success';
        } else if (url.pathname.endsWith('get_order_delivery_code')) data=[{delivery_code:'1234'}];
        else if (url.pathname.endsWith('get_order_courier_position')) data=[];
        else if (url.pathname==='/rest/v1/customer_addresses'||url.pathname.endsWith('list_support_tickets_v3')) data=[];
        else throw Error('Unexpected request/write: '+url.pathname);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/hesabim/?view=orders');
      const command=page.getByRole('button',{name:'Havale Yaptım, Bildir',exact:true}); await command.waitFor();
      assert.equal(await command.isEnabled(),false); assert.equal(await page.getByText(payment.transfer_code,{exact:true}).count(),0); assert.equal(reads,0);
      await page.getByRole('radio',{name:'Havale / EFT',exact:true}).check();
      if (['desktop','mobile','changed-before-report'].includes(scenario)) {
        await page.getByText(payment.transfer_code,{exact:true}).waitFor(); assert.equal(await command.isEnabled(),true);
        assert.ok((await page.locator('body').innerText()).includes('100,50'));
        await command.click();
        if (scenario==='changed-before-report') {await page.getByText('Ek ödeme bildirimi doğrulanamadı. Güncel bilgileri yeniden kontrol et.',{exact:true}).waitFor();assert.equal(responses.length,0);}
        else {await page.waitForFunction(()=>!document.body.textContent.includes('Havale Yaptım, Bildir'));assert.equal(responses.length,1);assert.ok(reads>=2,'Payment is revalidated before reporting');}
      } else {
        await page.getByText('Ek ödeme bilgileri doğrulanamadı. Tekrar Havale / EFT seçerek deneyebilirsin.',{exact:true}).waitFor();
        assert.equal(await command.isEnabled(),false);assert.equal(responses.length,0);assert.equal(await page.getByText(payment.transfer_code,{exact:true}).count(),0);
      }
      assert.deepEqual(errors,[]); await context.close();
    }
  } finally {await browser.close();}
  console.log('PASS: seven extra-payment browser scenarios, explicit bank choice, real code/cents, immutable request ID, fresh revalidation and failure-closed reporting. Synthetic requests only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

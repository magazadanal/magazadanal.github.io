const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8892';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const owner = '10000000-0000-4000-8000-000000000001';
const orderID = '20000000-0000-4000-8000-000000000001';
const ticket = '30000000-0000-4000-8000-000000000001';
async function main() {
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for (const scenario of ['order-retry','general','other-owner']) {
      const context = await browser.newContext({viewport:{width:390,height:900}});
      const page = await context.newPage(), errors = [], submissions = [];
      page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({owner,orderID,scenario})=>{
        sessionStorage.setItem('magazadanal.web.session.v1',JSON.stringify({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,user:{id:owner,email:'synthetic@example.invalid'}}));
        sessionStorage.setItem('magazadanal.web.support.v1.10000000-0000-4000-8000-000000000002',JSON.stringify({message:'FOREIGN DRAFT',orderID}));
      },{owner,orderID,scenario});
      await context.route('**/*',async route=>{
        const request = route.request(), url = new URL(request.url());
        if (url.origin===base) return route.continue();
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co','No actual backend/provider traffic');
        let data;
        if (url.pathname.endsWith('get_public_runtime_status')) data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if (url.pathname==='/rest/v1/profiles') data=[{id:owner,role:'customer',full_name:'Synthetic Customer',phone:'+905300000000',is_active:true}];
        else if (url.pathname==='/rest/v1/orders') {
          assert.ok(url.searchParams.get('select').includes('order_note'));
          data=[{id:orderID,order_no:'000001',status:'delivered',payment_method:'bank_transfer',customer_total:460,created_at:'2026-11-12T11:00:00Z',delivery_address_snapshot:{summary:'Test Sokak No: 1',district:'Şişli',neighborhood:'Test Mahallesi',customer_name:'Test Alıcı',customer_phone:'+905300000001'},order_items:[{store_name:'Beymen',store_branch:'Test Şubesi',product_name:'Test Ürün',order_note:'Test sipariş notu',size:'M',color:'Siyah',estimated_price:100}]}];
        } else if (url.pathname.endsWith('list_order_activity')||url.pathname==='/rest/v1/customer_addresses'||url.pathname.endsWith('list_support_tickets_v3')) data=[];
        else if (url.pathname.endsWith('create_support_ticket_v3')) {
          submissions.push(request.postDataJSON());
          if (scenario==='order-retry'&&submissions.length===1) return route.fulfill({status:503,contentType:'application/json',body:'{}'});
          data=[{id:ticket}];
        } else throw Error('Unexpected request/write: '+url.pathname);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/hesabim/');
      await page.locator('#portal-view').waitFor();
      if (scenario==='order-retry') {
        await page.locator('[data-view="profile"]').click(); await page.locator('#profile-history').click();
        await page.locator('#history-list summary').click();
        await page.getByText('Şube Test Şubesi',{exact:true}).waitFor();
        assert.equal(await page.getByText('Test sipariş notu',{exact:true}).count(),1);
        assert.equal(await page.getByText('Alıcı: Test Alıcı',{exact:true}).count(),1);
        assert.equal(await page.getByText('Telefon: +905300000001',{exact:true}).count(),1);
        await page.locator('#history-list').getByRole('button',{name:'Bize Ulaşın',exact:true}).click();
        assert.equal(await page.locator('#support-order').inputValue(),orderID);
        await page.locator('#support-message').fill('Siparişe bağlı test mesajı');
        await page.reload(); await page.locator('#support-submit').waitFor();
        assert.equal(await page.locator('#support-order').inputValue(),orderID);
        assert.equal(await page.locator('#support-message').inputValue(),'Siparişe bağlı test mesajı');
        await page.locator('#support-submit').click();
        await page.waitForFunction(()=>!document.querySelector('#support-submit').disabled);
        assert.equal(submissions.length,1);
        assert.equal(await page.locator('#support-order').isDisabled(),true);
        assert.equal(await page.locator('#support-message').isEditable(),false);
        await page.reload(); await page.locator('#support-submit').waitFor();
        assert.equal(await page.locator('#support-order').isDisabled(),true);
        await page.locator('#support-submit').click();
        await page.waitForFunction(()=>document.querySelector('#support-message').value==='');
        assert.deepEqual(submissions[1],submissions[0],'Retry keeps exact message, order and request identity');
        assert.equal(submissions[0].p_order_id,orderID); assert.equal(submissions[0].p_category,'order_other');
      } else {
        await page.locator('[data-view="profile"]').click(); await page.locator('[data-open-view="support"]').click();
        assert.equal(await page.locator('#support-message').inputValue(),'');
        assert.equal(await page.locator('#support-order').inputValue(),'');
        await page.locator('#support-message').fill('Genel test mesajı'); await page.locator('#support-submit').click();
        await page.waitForFunction(()=>document.querySelector('#support-message').value==='');
        assert.equal(submissions[0].p_order_id,null); assert.equal(submissions[0].p_category,'general');
      }
      assert.deepEqual(errors,[]); await context.close();
    }
  } finally {await browser.close();}
  console.log('PASS: history branch/note/recipient, order-linked support, general support, owner isolation, draft restore and exact retry identity. Synthetic requests only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

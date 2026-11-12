const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');

const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8766';
const live = process.env.SITE_PROFILE_LIVE === '1';
assert.ok(live ? base === 'https://magazadanal.com' : ['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-profile-bootstrap-20261109';
const owner = '10000000-0000-4000-8000-000000000001';
const foreign = '20000000-0000-4000-8000-000000000002';
const profile = {id:owner,role:'customer',full_name:'Test Müşteri',phone:'+905301234567',is_active:true};
const user = {id:owner,email:'customer@example.invalid',email_confirmed_at:'2026-11-09T00:00:00Z',
  user_metadata:{full_name:' Test Müşteri ',phone:'0530 123 45 67',role:'admin'}};
const session = {access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user};
const scenarios = ['missing-login','missing-restored','signup-confirm-login','existing','phone-login','recovery-login','inactive','admin',
  'courier','invalid-metadata','unconfirmed','foreign-user','deleted-user','rpc-denied','rpc-not-persisted','foreign-profile','profile-forbidden'];

async function main() {
  await fs.mkdir(output,{recursive:true});
  const baselineRef=process.env.PROFILE_BASELINE_REF;
  assert.ok(!live || !baselineRef,'Old source reproduction is local-only');
  if (baselineRef) assert.match(baselineRef,/^[a-f0-9]{40}$/);
  const baseline=baselineRef ? execFileSync('git',['show',`${baselineRef}:hesabim/hesabim.js`],
    {cwd:path.resolve(__dirname,'..'),encoding:'utf8'}) : null;
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const results=[];
  try {
    for (const scenario of scenarios) {
      const context=await browser.newContext({viewport:{width:scenario==='missing-restored'?390:1280,height:900}});
      const page=await context.newPage(),calls=[],errors=[];
      page.setDefaultTimeout(8000); page.on('pageerror',error=>errors.push(error.message));
      let existing=['existing','phone-login','recovery-login','inactive','admin','courier','foreign-profile'].includes(scenario);
      let ensured=0;
      if(scenario==='missing-restored') await page.addInitScript(({owner})=>sessionStorage.setItem('magazadanal.web.session.v1',
        JSON.stringify({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,
          user:{id:owner,email:'customer@example.invalid'}})),{owner});
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url()),p=url.pathname;
        if(url.origin===base) {
          if(baseline && p==='/hesabim/hesabim.js') return route.fulfill({contentType:'application/javascript',body:baseline});
          return route.continue();
        }
        if(url.hostname==='challenges.cloudflare.com') return route.fulfill({contentType:'application/javascript',
          body:`window.turnstile={render(selector,options){setTimeout(()=>options.callback("synthetic-account-proof"),${scenario==='recovery-login'?600:30})}};`});
        assert.equal(url.origin,'https://zxqqbzggfbxoasyhueqb.supabase.co','No unmocked external requests');
        calls.push(p); let data,status=200;
        if(p.endsWith('get_public_runtime_status')) data=[{customer_web_account_enabled:true,customer_ordering_enabled:true}];
        else if(p==='/auth/v1/signup') {
          assert.equal(ensured,0); const body=req.postDataJSON();
          assert.equal(body.data.full_name,'Test Müşteri'); assert.equal(body.data.phone,profile.phone);
          if(!baseline) assert.equal(body.gotrue_meta_security.captcha_token,'synthetic-account-proof');
          data={user:{...user,email_confirmed_at:null}};
        } else if(p==='/auth/v1/recover') {
          assert.deepEqual(req.postDataJSON(),{email:user.email,gotrue_meta_security:{captcha_token:'synthetic-account-proof'}});
          data={};
        } else if(p==='/auth/v1/token'||p==='/functions/v1/phone-password-login') {
          if(!baseline&&url.searchParams.get('grant_type')!=='refresh_token') assert.equal(req.postDataJSON().gotrue_meta_security.captcha_token,'synthetic-account-proof');
          if(p.endsWith('phone-password-login')) assert.equal(req.postDataJSON().phone,profile.phone);
          data=session;
        }
        else {
          assert.equal(req.headers().authorization,'Bearer synthetic-access');
          if(p==='/auth/v1/user') {
            data=structuredClone(user);
            if(scenario==='invalid-metadata') data.user_metadata.full_name='';
            if(scenario==='unconfirmed') data.email_confirmed_at=null;
            if(scenario==='foreign-user') data.id=foreign;
            if(scenario==='deleted-user') {status=401;data={};}
          } else if(p==='/rest/v1/profiles') {
            assert.equal(url.searchParams.get('id'),`eq.${owner}`);
            data=existing?[{...profile}]:[];
            if(scenario==='inactive') data[0].is_active=false;
            if(['admin','courier'].includes(scenario)) data[0].role=scenario;
            if(scenario==='foreign-profile') data[0].id=foreign;
            if(scenario==='profile-forbidden') {status=403;data={};}
          } else if(p.endsWith('ensure_customer_profile')) {
            assert.equal(req.method(),'POST'); assert.equal(existing,false,'Existing or inactive profiles must never be repaired');
            assert.deepEqual(req.postDataJSON(),{p_full_name:profile.full_name,p_phone:profile.phone},'Never pass role or another account ID');
            ensured++; data=scenario!=='rpc-denied'; existing=data && scenario!=='rpc-not-persisted';
          } else if(p==='/rest/v1/orders'||p==='/rest/v1/customer_addresses'||p.endsWith('list_support_tickets_v3')) {
            // Reproduce the real support RPC denial until the authenticated customer profile exists.
            status=existing?200:403; data=existing?[]:{};
          } else if(p.endsWith('list_order_activity')||p.endsWith('list_customer_legal_acknowledgements')) data=[];
          else throw Error(`Unexpected request: ${p}`);
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/hesabim/');
      if(scenario!=='missing-restored') {
        await page.locator('#login-button').waitFor({state:'visible'});
        if(scenario==='signup-confirm-login') {
          await page.locator('#signup-toggle').click();
          for(const [id,value] of Object.entries({name:'Test',surname:'Müşteri',email:user.email,phone:'0530 123 45 67',
            password:'synthetic-password',confirm:'synthetic-password'})) await page.locator('#signup-'+id).fill(value);
          await page.locator('#signup-form button[type="submit"]').click();
          await page.getByText('E-postana gelen doğrulama bağlantısını aç, ardından giriş yap.',{exact:true}).waitFor();
          assert.equal(ensured,0,'No profile write without a session');
          await page.locator('#signup-toggle').click();
        }
        await page.locator('#login-email').fill(scenario==='phone-login'?profile.phone:user.email);
        if(scenario==='recovery-login') {
          await page.locator('#forgot-password-button').click();
          const close = page.getByRole('dialog',{name:'Güvenlik doğrulaması'}).getByRole('button',{name:'Kapat',exact:true});
          const bounds = await close.locator('img').evaluate(img => ({width:img.getBoundingClientRect().width,
            height:img.getBoundingClientRect().height,parentWidth:img.parentElement.getBoundingClientRect().width,
            parentHeight:img.parentElement.getBoundingClientRect().height}));
          assert.ok(bounds.width>0&&bounds.height>0&&bounds.width<=bounds.parentWidth&&bounds.height<=bounds.parentHeight,'Close icon must fit inside its button');
          await page.screenshot({path:path.join(output,'account-captcha-dialog.png'),fullPage:true});
          await page.getByText('Parola yenileme bağlantısı mail adresine gönderildi.',{exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
        }
        await page.locator('#login-password').fill('synthetic-password');
        await page.locator('#login-button').click();
      }
      await page.waitForFunction(()=>document.querySelector('#profile-name').textContent==='Test'
        || !document.querySelector('#auth-status').hidden);
      const successful=['missing-login','missing-restored','signup-confirm-login','existing','phone-login','recovery-login'].includes(scenario);
      if(successful) {
        const error=await page.locator('#auth-status').textContent();
        if(await page.locator('#auth-view').isVisible()) await page.screenshot({path:path.join(output,`${scenario}-failure.png`),fullPage:true});
        assert.equal(await page.locator('#auth-view').isVisible(),false,`${scenario}: ${error}`);
        await page.locator('[data-view="profile"]').click();
        assert.equal(await page.locator('#profile-name').textContent(),'Test');
        assert.equal(await page.locator('#profile-surname').textContent(),'Müşteri');
        assert.equal(ensured,['existing','phone-login','recovery-login'].includes(scenario)?0:1);
        if(!['existing','phone-login','recovery-login'].includes(scenario)) {
          assert.ok(calls.indexOf('/rest/v1/rpc/ensure_customer_profile')<calls.indexOf('/rest/v1/rpc/list_support_tickets_v3'));
          await page.screenshot({path:path.join(output,`${scenario}-success.png`),fullPage:true});
          await page.reload(); await page.waitForFunction(()=>document.querySelector('#profile-name').textContent==='Test');
          assert.equal(ensured,1,'Reload must not repeat profile creation');
        } else assert.equal(calls.includes('/auth/v1/user'),false,'Established users need no profile bootstrap');
      } else {
        await page.locator('#auth-view').waitFor({state:'visible'});
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('magazadanal.web.session.v1')),null);
        const text=await page.locator('#auth-status').textContent();
        if(['inactive','admin','courier'].includes(scenario)) assert.match(text,/Bu hesapla müşteri/);
        else if(scenario==='unconfirmed') assert.match(text,/e-posta adresini doğrula/);
        else if(!['deleted-user','foreign-user','profile-forbidden'].includes(scenario)) assert.doesNotMatch(text,/Oturumun sona erdi/);
        assert.equal(ensured,['rpc-denied','rpc-not-persisted'].includes(scenario)?1:0);
        assert.equal(calls.includes('/rest/v1/rpc/list_support_tickets_v3'),false,'No protected calls before profile authorization');
      }
      assert.deepEqual(errors,[]);results.push({scenario,passed:true,ensureCalls:ensured});
      await context.close();
    }
  } finally {await browser.close();}
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({results,siteSource:live?'actual-live-pages':'local-preview',
    upstreamAPIsMocked:true,realAccountWrites:false},null,2)+'\n');
  console.log(`PASS: ${results.length} account profile scenarios; confirmation/session/owner/role guards preserved, no real account writes.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

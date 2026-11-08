const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const {createHash} = require('node:crypto');
const base = process.env.SITE_TEST_URL || 'http://127.0.0.1:8774';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || '/private/tmp/ma-email-confirmation-browser-20261108';
const token = createHash('sha224').update('synthetic@example.invalid' + '123456').digest('hex');
const user = {id:'10000000-0000-4000-8000-000000000001',email_confirmed_at:'2026-11-08T20:00:00Z'};
const otherSession = JSON.stringify({user:{id:'20000000-0000-4000-8000-000000000002'},accessToken:'synthetic-other-account',refreshToken:'synthetic-other-refresh'});
async function main() {
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  const results = [];
  try {
    for (const [width, theme] of [[1280,'light'],[390,'dark'],[320,'light']]) {
      const context = await browser.newContext({viewport:{width,height:900}, reducedMotion:'reduce'});
      const page = await context.newPage(), errors = [], requests = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({theme,otherSession}) => {
        localStorage.setItem('magazadanal.web.theme.v1',theme);
        sessionStorage.setItem('magazadanal.web.session.v1',otherSession);
      }, {theme,otherSession});
      let mode = 'success';
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) return route.continue();
        assert.equal(url.origin, 'https://zxqqbzggfbxoasyhueqb.supabase.co');
        assert.equal(url.pathname, '/auth/v1/verify'); assert.equal(request.method(), 'POST');
        assert.deepEqual(request.postDataJSON(), {token_hash:token,type:'signup'});
        assert.equal(request.headers().referer, undefined);
        requests.push({mode,method:request.method(),path:url.pathname});
        if (mode === 'offline') return route.abort('internetdisconnected');
        const body = mode === 'success' ? {user,access_token:'synthetic-ignored',refresh_token:'synthetic-ignored'} :
          mode === 'unconfirmed' ? {user:{id:user.id,email_confirmed_at:null}} : {error:'otp_expired'};
        return route.fulfill({status:mode === 'expired' ? 403 : 200, contentType:'application/json',body:JSON.stringify(body)});
      });
      const open = async (route = 'verify-email') => {
        await page.goto(`${base}/auth/${route}/?token_hash=${token}&type=signup#discarded`);
        await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).waitFor();
        assert.equal(page.url(), `${base}/auth/${route}/`);
        assert.equal(await page.getByRole('link',{name:'Web’de giriş yap',exact:true}).isVisible(), false);
      };
      await open(); assert.equal(requests.length,0,'Link scanning/loading must not consume the token');
      await page.screenshot({path:path.join(output,`pending-${width}-${theme}.png`),fullPage:true});
      await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).dblclick();
      await page.getByText('E-posta adresin doğrulandı.',{exact:true}).waitFor();
      assert.equal(requests.length,1);
      assert.equal(await page.getByRole('link',{name:'Web’de giriş yap',exact:true}).isVisible(), true);
      assert.equal(await page.evaluate(() => sessionStorage.length),1);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('magazadanal.web.session.v1')),otherSession);
      assert.equal(await page.evaluate(() => localStorage.getItem('magazadanal.web.session.v1')),null);
      await page.screenshot({path:path.join(output,`success-${width}-${theme}.png`),fullPage:true});
      mode = 'expired'; await open(); assert.equal(requests.length,1);
      await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).click();
      await page.getByText('Bu doğrulama bağlantısı kullanılamıyor.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Web’de giriş yap',exact:true}).isVisible(), false);
      mode = 'unconfirmed'; await open('confirmed');
      await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).click();
      await page.getByText('Doğrulama sonucu alınamadı.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Web’de giriş yap',exact:true}).isVisible(), false);
      mode = 'offline'; await open();
      await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).click();
      await page.getByText('Doğrulama sonucu alınamadı.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'E-postamı doğrula',exact:true}).isEnabled(), true);
      await page.goto(`${base}/auth/verify-email/?token_hash=${token}&type=recovery`);
      await page.getByText('Bu doğrulama bağlantısı kullanılamıyor.',{exact:true}).waitFor();
      assert.equal(requests.length,4);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const response = await page.request.get(`${base}/auth/verify-email/`);
      assert.match(response.headers()['cache-control'], /no-store/);
      assert.equal(response.headers()['x-frame-options'],'DENY');
      results.push({width,theme,verificationRequests:requests.length,passed:true});
      await context.close();
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output,'verification.json'), JSON.stringify({results,syntheticOnly:true,upstreamAPIsMocked:true,liveWrites:false},null,2)+'\n');
  console.log('PASS: confirmation gesture, server result, other-account session preservation, duplicate/network/expired guards, old links, secret stripping and responsive light/dark UI; synthetic local requests only.');
}
main().catch(e => {console.error(e); process.exitCode = 1;});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'auth/confirmed/confirmed.js'), 'utf8');
const token = 'a'.repeat(64);
const query = `?token_hash=${token}&type=signup`;
const verified = {user:{id:'10000000-0000-4000-8000-000000000001', email_confirmed_at:'2026-11-08T20:00:00Z'}, access_token:'synthetic-discarded'};
function harness(search = query, respond = async () => ({ok:true, status:200, json:async () => verified})) {
  const node = () => ({hidden:true, disabled:false, textContent:'', children:[], events:{},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this.events[name] = callback; }});
  const status = node(), button = node(), account = node(), requests = [], history = [];
  const nodes = {'confirmation-status':status, 'confirm-email':button, 'account-link':account};
  const storage = new Proxy({}, {get() { throw Error('Authentication state must not be stored or read'); }});
  vm.runInNewContext(script, {
    URLSearchParams, document:{title:'Confirmation', getElementById:id => nodes[id], createElement:node},
    window:{location:{search, pathname:'/auth/verify-email/'}, history:{replaceState:(...args) => history.push(args)}},
    localStorage:storage, sessionStorage:storage,
    fetch:async (...args) => { requests.push(args); return respond(...args); },
  });
  return {status,button,account,requests,history,click:() => button.events.click?.(), text:() => status.children.map(n => n.textContent).join(' ')};
}

test('opening or scanning a valid link performs no verification and clears query/fragment', () => {
  const h = harness();
  assert.equal(h.requests.length, 0);
  assert.equal(h.button.hidden, false);
  assert.equal(h.account.hidden, true);
  assert.equal(h.history[0][2], '/auth/verify-email/');
});

test('only a button action plus a verified server user produces success; session is not saved', async () => {
  const h = harness(); await h.click();
  assert.equal(h.requests.length, 1);
  const [url, options] = h.requests[0];
  assert.equal(url, 'https://zxqqbzggfbxoasyhueqb.supabase.co/auth/v1/verify');
  assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.cache, 'no-store');
  assert.deepEqual(JSON.parse(options.body), {token_hash:token, type:'signup'});
  assert.match(h.text(), /adresin doğrulandı/);
  assert.equal(h.account.hidden, false); assert.equal(h.button.hidden, true);
  await h.click(); assert.equal(h.requests.length, 1);
});

test('HTTP 200 without a confirmed user cannot claim success', async () => {
  for (const body of [{}, {user:null}, {user:{id:verified.user.id}},
    {user:{id:verified.user.id, email_confirmed_at:'not-a-date'}},
    {user:{id:'wrong', email_confirmed_at:verified.user.email_confirmed_at}}]) {
    const h = harness(query, async () => ({ok:true,status:200,json:async () => body}));
    await h.click(); assert.equal(h.account.hidden, true); assert.doesNotMatch(h.text(), /adresin doğrulandı/);
  }
});

test('malformed, duplicate, recovery and error links do not consume tokens or display supplied HTML', async () => {
  for (const search of ['', '?type=signup', query+'&token_hash='+token, query+'&type=signup',
    '?token_hash='+token+'&type=recovery', '?token_hash=short&type=signup',
    query+'&error_description=%3Cimg%20src=x%3E', query+'&error=denied']) {
    const h = harness(search); await h.click();
    assert.equal(h.requests.length, 0); assert.equal(h.button.hidden, true);
    assert.equal(h.account.hidden, true); assert.doesNotMatch(h.text(), /<img/);
  }
});

test('expired and already-used links do not show a login success', async () => {
  const h = harness(query, async () => ({ok:false,status:403})); await h.click();
  assert.match(h.text(), /süresi dolmuş/); assert.equal(h.account.hidden, true);
  assert.equal(h.button.hidden, true); await h.click(); assert.equal(h.requests.length, 1);
});

test('network failures, malformed responses, throttling and server failures allow explicit retry only', async () => {
  for (const respond of [async () => { throw Error('offline'); },
    async () => ({ok:true,status:200,json:async () => { throw Error('invalid JSON'); }}),
    async () => ({ok:false,status:429}), async () => ({ok:false,status:503})]) {
    const h = harness(query, respond); await h.click();
    assert.equal(h.account.hidden, true); assert.equal(h.button.disabled, false);
    assert.equal(h.requests.length, 1); await h.click(); assert.equal(h.requests.length, 2);
  }
});

test('concurrent double clicks cannot send two verification requests', async () => {
  let resolve;
  const h = harness(query, () => new Promise(done => { resolve = done; }));
  const first = h.click(); await h.click(); assert.equal(h.requests.length, 1);
  assert.equal(h.button.disabled, true);
  resolve({ok:true,status:200,json:async () => verified}); await first;
  assert.equal(h.account.hidden, false);
});

test('old/new web pages share the confirmation controller; new email path is outside existing app links', () => {
  for (const route of ['auth/confirmed', 'auth/verify-email']) {
    const html = fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
    assert.match(html, /id="confirm-email"[^>]*hidden/);
    assert.match(html, /confirmed\.js\?v=20261108-1/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.match(html, /noindex, nofollow, noarchive/);
    assert.doesNotMatch(html, /http-equiv="refresh"|autofocus|onclick=/);
  }
  const association = JSON.parse(fs.readFileSync(path.join(root, '.well-known/apple-app-site-association')));
  for (const detail of association.applinks.details) for (const component of detail.components) {
    assert.ok(!new RegExp('^'+component['/'].replaceAll('*','.*')+'$').test('/auth/verify-email/'));
  }
  assert.match(fs.readFileSync(path.join(root, 'hesabim/hesabim.js'), 'utf8'), /signup\?redirect_to=https%3A%2F%2Fmagazadanal\.com%2Fauth%2Fverify-email%2F/);
});

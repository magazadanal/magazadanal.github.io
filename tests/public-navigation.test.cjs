const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../home.js'),'utf8');
function home(value, blocked=false) {
  const account={hidden:false}, calls=[];
  vm.runInNewContext(source,{
    document:{getElementById(id){calls.push(id);assert.equal(id,'home-account-link');return account;}},
    sessionStorage:{getItem(key){assert.equal(key,'magazadanal.web.session.v1');if(blocked)throw Error('blocked');return value;}}
  });
  return {account,calls};
}
test('public navigation is not conditionally exposed by a stored session',()=>{
  for(const value of [null,'{}','invalid',JSON.stringify({user:{id:'synthetic'}})])assert.equal(home(value).account.hidden,false);
});
test('existing stored-session header behavior does not grant or modify account access',()=>{
  const result=home(JSON.stringify({refreshToken:'synthetic',user:{id:'synthetic'}}));
  assert.equal(result.account.hidden,true);assert.deepEqual(result.calls,['home-account-link']);
});
test('restricted storage leaves the public menu and login link usable',()=>{
  assert.equal(home(null,true).account.hidden,false);
});

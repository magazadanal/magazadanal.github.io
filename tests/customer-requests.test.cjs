const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../hesabim/order-rules.js');
const order = '20000000-0000-4000-8000-000000000001';
const older = {id:'30000000-0000-4000-8000-000000000002',order_id:order,action:'alternative_requested',current_assignment:true,created_at:'2026-11-13T00:00:00.000001Z'};
const newer = {...older,id:'30000000-0000-4000-8000-000000000001',created_at:'2026-11-13T00:00:00.000002Z'};
test('only the latest unanswered request is actionable, including microseconds and UUID ties', () => {
  for(const events of [[older,newer],[newer,older]])assert.equal(R.currentOrderRequest(events,order,older.action),newer);
  const tied={...newer,created_at:older.created_at};assert.equal(R.currentOrderRequest([older,tied],order,older.action),older);
  for(const response of ['alternative_approved','alternative_rejected'])assert.equal(R.currentOrderRequest([older,newer,{order_id:order,request_id:newer.id,action:response}],order,older.action),null);
  assert.equal(R.currentOrderRequest([older,newer,{order_id:order,request_id:older.id,action:'alternative_approved'}],order,older.action),newer);
  assert.equal(R.currentOrderRequest([older,{...newer,current_assignment:false}],order,older.action),null);
});
test('foreign, duplicate, malformed, unsupported and noncurrent requests cannot create controls', () => {
  for(const events of [null,[],[older,older],[{...older,order_id:newer.id}],[{...older,current_assignment:null}],[{...older,current_assignment:undefined}],[older,{...newer,id:'invalid'}],[older,{...newer,created_at:'invalid'}]])assert.equal(R.currentOrderRequest(events,order,older.action),null);
  assert.equal(R.currentOrderRequest([older],order,'alternative_approved'),null);
  assert.equal(R.currentOrderRequest([older],'invalid',older.action),null);
  assert.equal(R.currentOrderRequest([null,older],order,older.action),older);
});
test('alternative and extra-payment requests are independently bound and never fall back to an older payment', () => {
  const extra={...newer,action:'extra_payment_requested',amount:100.5};
  assert.equal(R.currentOrderRequest([older,extra],order,older.action),older);
  assert.equal(R.currentOrderRequest([older,extra],order,extra.action),extra);
  for(const response of ['extra_payment_reported','extra_payment_confirmed'])assert.equal(R.currentOrderRequest([extra,{order_id:order,request_id:extra.id,action:response}],order,extra.action),null);
  const row={id:'40000000-0000-4000-8000-000000000001',order_id:order,purpose:'adjustment',direction:'charge',method:'bank_transfer',status:'pending',amount:100.5,transfer_code:'EK-0123456789AB',created_at:'2026-11-12T23:59:59Z'};
  assert.equal(R.extraPaymentDetails([row],order,extra,[{...older,action:extra.action,amount:100.5},extra]).requestID,extra.id);
});

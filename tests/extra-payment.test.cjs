const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../hesabim/order-rules.js');
const orderID = '20000000-0000-4000-8000-000000000001';
const request = {id: '30000000-0000-4000-8000-000000000001', order_id: orderID, action: 'extra_payment_requested', current_assignment: true, amount: 100.5, created_at: '2026-11-12T12:00:01Z'};
const payment = {id: '40000000-0000-4000-8000-000000000001', order_id: orderID, purpose: 'adjustment', direction: 'charge', method: 'bank_transfer', status: 'pending', amount: '100.50', transfer_code: 'EK-0123456789AB', created_at: '2026-11-12T12:00:00Z'};
test('extra payment preserves cents and uses the actual matching server reference', () => {
  assert.deepEqual(R.extraPaymentDetails([payment], orderID, request, [request]), {paymentID: payment.id, requestID: request.id, code: payment.transfer_code, amount: 100.5});
  for (const [value, cents] of [[0.01,1],['100.50',10050],[99999999,9999999900]]) assert.equal(R.paymentCents(value),cents);
  for (const bad of [null,undefined,NaN,Infinity,0,-1,0.001,100000000,'1e2','100.500']) assert.throws(()=>R.paymentCents(bad));
});
test('foreign, ambiguous, stale, mismatched or settled adjustment data never produces bank details', () => {
  for (const rows of [[],[payment,payment],[{...payment,order_id:request.id}],[{...payment,amount:100}],[{...payment,status:'confirmed'}],[{...payment,purpose:'initial'}],[{...payment,direction:'refund'}],[{...payment,method:'card'}],[{...payment,transfer_code:'EK-2026-000018'}],[{...payment,created_at:'invalid'}],[{...payment,created_at:'2026-11-12T12:00:02Z'}]]) assert.throws(()=>R.extraPaymentDetails(rows,orderID,request,[request]));
  for (const events of [[],[{...request,current_assignment:false}],[request,{...request,id:payment.id,created_at:'2026-11-12T12:00:02Z'}],[request,{order_id:orderID,request_id:request.id,action:'extra_payment_reported'}],[request,{order_id:orderID,request_id:request.id,action:'extra_payment_confirmed'}]]) assert.throws(()=>R.extraPaymentDetails([payment],orderID,request,events));
});

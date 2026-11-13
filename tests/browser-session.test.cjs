const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { create } = require('../hesabim/browser-session.js');

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
function environment() {
  const data = new Map();
  let queue = Promise.resolve();
  const storage = { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const locks = { request(name, options, operation) { const next = queue.then(operation); queue = next.catch(() => {}); return next; } };
  return { data, storage, locks, guard: create({ storage: () => storage, locks, uuid: randomUUID }) };
}

test('same account shares only an opaque browser marker, not credentials', async () => {
  const { guard, data } = environment();
  const id = await guard.claim(A);
  assert.equal(await guard.claim(A), id);
  assert.equal(guard.assert(A, id).owner, A);
  assert.deepEqual(Object.keys(JSON.parse(data.get(guard.key))).sort(), ['id', 'owner', 'version']);
});

test('different accounts cannot win simultaneous claims in one browser', async () => {
  const { guard } = environment();
  const results = await Promise.allSettled([guard.claim(A), guard.claim(B)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'conflict');
});

test('another browser or device is independent', async () => {
  await environment().guard.claim(A);
  await environment().guard.claim(B);
});

test('logout invalidates old markers even when the same account logs in again', async () => {
  const { guard } = environment();
  const oldID = await guard.claim(A);
  await guard.release(A, oldID);
  assert.throws(() => guard.assert(A, oldID), { code: 'retired' });
  const newID = await guard.claim(A);
  assert.notEqual(newID, oldID);
  await assert.rejects(guard.claim(A, oldID), { code: 'retired' });
});

test('stale logout cannot release a newer account', async () => {
  const { guard } = environment();
  const oldID = await guard.claim(A);
  await guard.reset();
  const currentID = await guard.claim(B);
  await guard.release(A, oldID);
  assert.equal(guard.assert(B, currentID).owner, B);
});

test('existing tab-local sessions can adopt the first browser marker once', async () => {
  const { guard } = environment();
  const id = await guard.claim(A);
  assert.equal(await guard.claim(A, id), id);
  await assert.rejects(guard.claim(B), { code: 'conflict' });
});

test('missing storage or serialization support does not silently permit a second account', async () => {
  const blocked = create({ storage() { throw Error('blocked'); }, locks: environment().locks });
  await assert.rejects(blocked.claim(A), { code: 'unavailable' });
  await assert.rejects(create({ storage: () => environment().storage, locks: {} }).claim(A), { code: 'unavailable' });
});

test('corrupt or credential-bearing shared records are rejected and can be explicitly reset', async () => {
  const { guard, data } = environment();
  data.set(guard.key, JSON.stringify({ version: 1, owner: A, id: randomUUID(), accessToken: 'not-allowed' }));
  await assert.rejects(guard.claim(A), { code: 'unavailable' });
  await guard.reset();
  await guard.claim(B);
});

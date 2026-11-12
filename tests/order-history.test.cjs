const assert = require("node:assert/strict");
const test = require("node:test");
const R = require("../hesabim/order-rules.js");
const row = { id: "20000000-0000-4000-8000-000000000101", created_at: "2026-11-12T12:00:00.123456+00:00", status: "delivered" };

test("history cursor preserves server timestamp precision and the UUID tie-breaker", () => {
  const cursor = R.orderCursor(row);
  const query = new URLSearchParams(R.olderOrdersFilter(cursor).slice(1));
  assert.equal(query.get("or"), `(created_at.lt.${row.created_at},and(created_at.eq.${row.created_at},id.lt.${row.id}))`);
  assert.equal(cursor.created_at, row.created_at);
  assert.equal(R.orderHistoryPage([row], null).hasMore, false);
});

test("history cannot inject filters, accept malformed pages or repeat a full cursor", () => {
  for (const value of [null, {}, { ...row, id: "bad" }, { ...row, created_at: "2026-11-12),id.gt.0" }, { ...row, created_at: "invalid" }]) assert.throws(() => R.orderCursor(value));
  for (const value of [null, [row, row], [{ ...row, status: "shopping" }], Array(101).fill(row)]) assert.throws(() => R.orderHistoryPage(value, null));
  assert.throws(() => R.orderHistoryPage([row], R.orderCursor(row)));
  assert.deepEqual(R.orderHistoryPage([], row), { rows: [], cursor: row, hasMore: false });
});

test("history ordering preserves microseconds before the stable ID tie-breaker", () => {
  const older = { ...row, id: "20000000-0000-4000-8000-000000000999", created_at: "2026-11-12T12:00:00.123455Z" };
  const sameTimeHigherID = { ...row, id: "20000000-0000-4000-8000-000000000102" };
  assert.deepEqual([older, row, sameTimeHigherID].sort(R.newestOrderFirst), [sameTimeHigherID, row, older]);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../hesabim/realtime.js");

const ORDER = "11111111-2222-4333-8444-555555555555";
const ORDER2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "TEST.JWT.TOKEN";

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeWS.all.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.closed = true; }
  open() { this.readyState = 1; this.onopen(); }
  recv(message) { this.onmessage({ data: JSON.stringify(message) }); }
  drop() { this.readyState = 3; this.onclose(); }
}
function harness() {
  FakeWS.all = [];
  const timeouts = [], intervals = [], listeners = {};
  const doc = { hidden: false, addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  const signals = [], statuses = [];
  let token = TOKEN, tid = 0;
  const client = R.create({
    url: "wss://proj.supabase.co/realtime/v1/websocket", apikey: "sb_publishable_x", getToken: () => token,
    onSignal: (s) => signals.push(s), onStatus: (c) => statuses.push(c),
    WebSocket: FakeWS, document: doc, random: () => 0.5,
    setTimeout: (fn, ms) => { const id = ++tid; timeouts.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = timeouts.findIndex((t) => t.id === id); if (i >= 0) timeouts.splice(i, 1); },
    setInterval: (fn, ms) => { const id = ++tid; intervals.push({ id, fn, ms }); return id; },
    clearInterval: (id) => { const i = intervals.findIndex((t) => t.id === id); if (i >= 0) intervals.splice(i, 1); }
  });
  return { client, doc, listeners, timeouts, intervals, signals, statuses, setToken: (t) => { token = t; } };
}
function joinOk(ws, id) { ws.recv({ topic: `realtime:order:${id}`, event: "phx_reply", payload: { status: "ok", response: {} }, ref: "1" }); }

test("join message format and url carry only the publishable key", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  const ws = FakeWS.all[0];
  assert.equal(ws.url, "wss://proj.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0");
  assert.ok(!ws.url.includes(TOKEN));
  ws.open();
  const join = ws.sent[0];
  assert.equal(join.topic, `realtime:order:${ORDER}`);
  assert.equal(join.event, "phx_join");
  assert.deepEqual(join.payload.config, { broadcast: { self: false }, private: true });
  assert.equal(join.payload.access_token, TOKEN);
  assert.ok(join.ref && join.join_ref);
  assert.equal(h.client.connected, false);
  joinOk(ws, ORDER);
  assert.equal(h.client.connected, true);
  assert.deepEqual(h.statuses, [true]);
});

test("invalid order ids are ignored and no token means no connection", () => {
  const h = harness();
  h.client.setOrders(["not-a-uuid", "../x"]);
  assert.equal(FakeWS.all.length, 0);
  h.setToken(null);
  h.client.setOrders([ORDER]);
  assert.equal(FakeWS.all.length, 0);
});

test("heartbeat every 25s on the phoenix topic; missed reply reconnects", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  const ws = FakeWS.all[0]; ws.open();
  assert.equal(h.intervals[0].ms, 25000);
  const beat = h.intervals[0].fn;
  beat();
  const hb = ws.sent.at(-1);
  assert.equal(hb.topic, "phoenix"); assert.equal(hb.event, "heartbeat"); assert.deepEqual(hb.payload, {});
  ws.recv({ topic: "phoenix", event: "phx_reply", payload: { status: "ok" }, ref: hb.ref });
  beat();
  assert.equal(ws.sent.at(-1).event, "heartbeat");
  beat(); // no reply to the previous heartbeat
  assert.ok(ws.closed);
  assert.equal(h.timeouts.length, 1);
});

test("reconnects with exponential backoff and rejoins; backoff resets after a join", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  FakeWS.all[0].open(); joinOk(FakeWS.all[0], ORDER);
  FakeWS.all[0].drop();
  assert.equal(h.client.connected, false);
  const delays = [];
  for (let i = 0; i < 7; i++) {
    delays.push(h.timeouts[0].ms);
    h.timeouts.shift().fn();
    FakeWS.all.at(-1).drop();
  }
  assert.deepEqual(delays, [750, 1500, 3000, 6000, 12000, 22500, 22500]);
  h.timeouts.shift().fn();
  const ws = FakeWS.all.at(-1); ws.open();
  assert.equal(ws.sent[0].event, "phx_join");
  joinOk(ws, ORDER);
  assert.equal(h.client.connected, true);
  ws.drop();
  assert.equal(h.timeouts[0].ms, 750);
});

test("hidden tab closes the socket, visible tab reopens it", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  const ws = FakeWS.all[0]; ws.open(); joinOk(ws, ORDER);
  h.doc.hidden = true; h.listeners.visibilitychange();
  assert.ok(ws.closed); assert.equal(h.client.connected, false); assert.equal(h.timeouts.length, 0);
  h.doc.hidden = false; h.listeners.visibilitychange();
  assert.equal(FakeWS.all.length, 2);
  FakeWS.all[1].open();
  assert.equal(FakeWS.all[1].sent[0].topic, `realtime:order:${ORDER}`);
});

test("token refresh sends access_token on every channel; token never in URL", () => {
  const h = harness();
  h.client.setOrders([ORDER, ORDER2]);
  const ws = FakeWS.all[0]; ws.open();
  h.setToken("NEW.JWT.TOKEN");
  h.client.tokenChanged();
  const msgs = ws.sent.filter((m) => m.event === "access_token");
  assert.equal(msgs.length, 2);
  assert.ok(msgs.every((m) => m.payload.access_token === "NEW.JWT.TOKEN"));
  assert.deepEqual(msgs.map((m) => m.topic).sort(), [`realtime:order:${ORDER}`, `realtime:order:${ORDER2}`].sort());
  assert.ok(FakeWS.all.every((s) => !s.url.includes("JWT")));
});

test("broadcast signals call onSignal with order id and kind only", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  const ws = FakeWS.all[0]; ws.open(); joinOk(ws, ORDER);
  for (const kind of ["order_changed", "message", "position"]) {
    ws.recv({ topic: `realtime:order:${ORDER}`, event: "broadcast", payload: { type: "broadcast", event: kind, payload: { order_id: ORDER, kind: "x", id: "9", html: "<img src=x onerror=alert(1)>" } } });
  }
  assert.deepEqual(h.signals, [
    { orderID: ORDER, kind: "order_changed" }, { orderID: ORDER, kind: "message" }, { orderID: ORDER, kind: "position" }
  ]);
  ws.recv({ topic: `realtime:order:${ORDER}`, event: "broadcast", payload: { event: "evil", payload: { order_id: ORDER } } });
  ws.recv({ topic: `realtime:order:${ORDER}`, event: "broadcast", payload: { event: "message", payload: { order_id: ORDER2 } } });
  ws.recv({ topic: `realtime:order:${ORDER2}`, event: "broadcast", payload: { event: "message", payload: { order_id: ORDER2 } } });
  ws.onmessage({ data: "not json" });
  assert.equal(h.signals.length, 3);
});

test("failed join keeps status disconnected; removing orders leaves channel and closes when empty", () => {
  const h = harness();
  h.client.setOrders([ORDER, ORDER2]);
  const ws = FakeWS.all[0]; ws.open();
  joinOk(ws, ORDER);
  ws.recv({ topic: `realtime:order:${ORDER2}`, event: "phx_reply", payload: { status: "error", response: { reason: "denied" } } });
  assert.equal(h.client.connected, false);
  h.client.setOrders([ORDER]);
  assert.equal(h.client.connected, true);
  h.client.setOrders([]);
  assert.ok(ws.closed); assert.equal(h.client.connected, false);
});

test("stop closes everything and cancels reconnects", () => {
  const h = harness();
  h.client.setOrders([ORDER]);
  const ws = FakeWS.all[0]; ws.open(); ws.drop();
  assert.equal(h.timeouts.length, 1);
  h.client.stop();
  assert.equal(h.timeouts.length, 0); assert.equal(h.intervals.length, 0);
  assert.equal(h.client.connected, false);
});

test("account page wiring: signal refreshes, polling interval depends on connection, CSP allows wss", () => {
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const account = read("hesabim/hesabim.js");
  assert.match(account, /TRACKING_POLL_MS = 2000, TRACKING_POLL_REALTIME_MS = 30000/);
  assert.match(account, /trackingPollMs\(\) \{ return realtimeConnected \? TRACKING_POLL_REALTIME_MS : TRACKING_POLL_MS; \}/);
  assert.match(account, /kind === "message"[\s\S]*panel\.refresh\(\)/);
  assert.match(account, /kind === "order_changed"\) requestTrackingRefresh\(\)/);
  assert.match(account, /realtime\?\.stop\(\)/);
  assert.match(account, /realtime\?\.tokenChanged\(\)/);
  const html = read("hesabim/index.html");
  assert.match(html, /\/hesabim\/realtime\.js\?v=\d{8}-\d+" defer/);
  assert.ok(html.indexOf("realtime.js") < html.indexOf("hesabim.js?v="));
  const accountHeaders = read("_headers").split("/hesabim/*")[1].split("\n")[1];
  for (const text of [html, accountHeaders]) assert.ok(text.includes("connect-src 'self' wss://zxqqbzggfbxoasyhueqb.supabase.co https://zxqqbzggfbxoasyhueqb.supabase.co https://photon.komoot.io;"));
  const code = read("hesabim/realtime.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /innerHTML|insertAdjacent|document\.write|eval\(|console\./);
});

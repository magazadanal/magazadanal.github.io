const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const M = require("../hesabim/order-messages.js");

test("client precheck flags link, email, iban, phone and long digit runs and passes ordinary text", () => {
  assert.equal(M.precheck("https://evil.example/x"), "link");
  assert.equal(M.precheck("bak www.site.com"), "link");
  assert.equal(M.precheck("yaz: ali@mail.com"), "email");
  assert.equal(M.precheck("TR33 0006 1005 1978 6457 8413 26"), "iban");
  assert.equal(M.precheck("0532 123 45 67"), "phone");
  assert.equal(M.precheck("+90 (532) 123-45-67"), "phone");
  assert.equal(M.precheck("kod 12345678901234"), "digits");
  assert.equal(M.precheck("Kapı kodu 4521, 3. kat daire 12"), null);
  assert.equal(M.precheck("Merhaba, 10 dakikaya oradayım."), null);
});

test("send results map to Turkish messages and keep the text unless sent", () => {
  assert.deepEqual(M.sendOutcome({ status: "sent" }), { sent: true, keepText: false, definitive: true, text: "" });
  const labels = { link: "bağlantı", email: "e-posta", iban: "IBAN", phone: "telefon numarası" };
  for (const [reason, word] of Object.entries(labels)) {
    const o = M.sendOutcome({ status: "blocked", reason });
    assert.equal(o.sent, false); assert.equal(o.keepText, true);
    assert.match(o.text, /^Güvenliğin için .* paylaşılamaz\.$/); assert.ok(o.text.includes(word));
  }
  assert.match(M.sendOutcome({ status: "closed" }).text, /Sohbet kapandı/);
  const notYet = M.sendOutcome({ status: "not_yet" });
  assert.equal(notYet.sent, false); assert.equal(notYet.keepText, true); assert.equal(notYet.definitive, true);
  assert.equal(notYet.text, "Bu sohbete şu anda mesaj yazılamıyor.");
  assert.equal(M.sendOutcome({ status: "rate_limited" }).text, "Çok hızlı mesaj gönderiyorsun, biraz bekle.");
  assert.match(M.sendOutcome({ status: "unauthorized" }).text, /yetkin yok/);
  assert.equal(M.sendOutcome({ status: "weird" }).definitive, false);
  assert.equal(M.sendOutcome(null, { status: 401 }).definitive, true);
  const net = M.sendOutcome(null, new TypeError("fetch"));
  assert.equal(net.definitive, false); assert.match(net.text, /Bağlantını kontrol/);
});

test("list normalization drops malformed rows and labels senders", () => {
  assert.equal(M.normalizeList({ status: "nope" }), null);
  const list = M.normalizeList({ status: "ok", open: true, messages: [
    { id: "a", sender_role: "admin", body: "x", created_at: "2026-11-16T10:00:00Z", is_mine: false },
    { id: "b", sender_role: "hacker", body: "y" }, { id: 3, sender_role: "courier", body: "z" }] });
  assert.equal(list.messages.length, 1);
  assert.equal(M.senderLabel({ sender_role: "admin", is_mine: false }), "Mağazadan AL");
  assert.equal(M.senderLabel({ sender_role: "courier", is_mine: false }), "Kurye");
  assert.equal(M.senderLabel({ sender_role: "customer", is_mine: true }), "");
  assert.equal(M.isChatStatus("on_the_way"), true); assert.equal(M.isChatStatus("delivered"), false);
});

function fakeDocument() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.className = ""; this._text = ""; this.value = ""; this.hidden = false; this.scrollHeight = 0; this.scrollTop = 0; this.clientHeight = 0; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set innerHTML(_) { throw new Error("innerHTML must not be used"); }
    append(...n) { this.children.push(...n); }
    replaceChildren(...n) { this.children = n; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(t, f) { this.listeners[t] = f; }
    find(cls) { if (this.className.split(" ").includes(cls)) return this; for (const c of this.children) { const r = c.find(cls); if (r) return r; } return null; }
  }
  return { createElement: (t) => new Node(t) };
}

test("panel renders bodies as text only, keeps text when blocked, reuses request id on retry", async () => {
  const doc = fakeDocument(), calls = [];
  let sendResult = new TypeError("down"), ids = 0;
  const rpc = async (name, body) => {
    calls.push([name, body]);
    if (name === "list_order_messages") return { status: "ok", open: true, courier_muted: false, messages: [{ id: "m1", sender_role: "courier", body: "<img src=x onerror=alert(1)>", created_at: "2026-11-16T10:00:00Z", is_mine: false }] };
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  };
  const panel = M.createPanel({ document: doc, orderID: "o1", rpc, uuid: () => `id-${++ids}` });
  await panel.refresh();
  assert.equal(panel.node.hidden, false);
  const body = panel.node.find("chat-body");
  assert.equal(body.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(calls.at(-1)[1].p_after, null);
  const input = panel.node.find("chat-input"), feedback = panel.node.find("chat-feedback"), form = panel.node.find("chat-form");
  const submit = () => form.listeners.submit({ preventDefault() {} });
  input.value = "  selam  "; await submit();               // network error
  input.value = "selam"; await submit();                   // same text -> same id
  const sends = calls.filter((c) => c[0] === "send_order_message");
  assert.equal(sends.length, 2); assert.equal(sends[0][1].p_client_request_id, sends[1][1].p_client_request_id);
  assert.equal(input.value, "selam"); assert.match(feedback.textContent, /Bağlantını/);
  input.value = "ara 0532 111 22 33"; await submit();      // client precheck, nothing sent
  assert.equal(calls.filter((c) => c[0] === "send_order_message").length, 2);
  assert.match(feedback.textContent, /telefon numarası paylaşılamaz/); assert.equal(input.value, "ara 0532 111 22 33");
  sendResult = { status: "blocked", reason: "link" }; input.value = "x"; await submit();
  assert.match(feedback.textContent, /bağlantı paylaşılamaz/); assert.equal(input.value, "x");
  sendResult = { status: "sent", message_id: "m2" }; await submit();
  assert.equal(input.value, ""); assert.equal(feedback.hidden, true);
  assert.equal(calls.at(-1)[1].p_after, "2026-11-16T09:58:00.000Z"); // 2 dk geriden (geç kesinleşen mesaj atlanmasın)
});

test("ended orders become read-only with the closed note", async () => {
  const doc = fakeDocument();
  const rpc = async () => ({ status: "ok", open: false, courier_muted: false, messages: [{ id: "m1", sender_role: "admin", body: "Merhaba", created_at: "2026-11-16T10:00:00Z", is_mine: false }] });
  const panel = M.createPanel({ document: doc, orderID: "o1", rpc, uuid: () => "id" });
  panel.setOrderStatus("delivered"); await panel.refresh();
  assert.equal(panel.node.find("chat-form").hidden, true);
  assert.equal(panel.node.find("chat-closed").hidden, false);
  assert.match(panel.node.find("chat-closed").textContent, /Sohbet kapandı/);
  assert.equal(panel.node.find("chat-sender").textContent, "Mağazadan AL");
});

test("customer: no chat section without a message, no waiting note anywhere", async () => {
  const doc = fakeDocument();
  const data = { status: "ok", open: false, can_write_from: "courier_first", courier_muted: false, messages: [] };
  const panel = M.createPanel({ document: doc, orderID: "o1", rpc: async () => data, uuid: () => "id" });
  panel.setOrderStatus("on_the_way"); await panel.refresh();
  assert.equal(panel.node.hidden, true);
  assert.equal(panel.node.find("chat-waiting"), null);
  const ended = M.createPanel({ document: doc, orderID: "o2", rpc: async () => ({ status: "ok", open: false, can_write_from: null, messages: [] }), uuid: () => "id" });
  ended.setOrderStatus("delivered"); await ended.refresh();
  assert.equal(ended.node.hidden, true);
  assert.equal(M.isChatStatus("courier_assigned"), false); assert.equal(M.isChatStatus("shopping"), false);
  assert.doesNotMatch(fs.readFileSync("hesabim/order-messages.js", "utf8"), /Kuryen sana yazarsa|chat-waiting/);
});

test("customer: section appears after the first courier message and then accepts replies", async () => {
  const doc = fakeDocument();
  let data = { status: "ok", open: false, can_write_from: "courier_first", courier_muted: false, messages: [] };
  const panel = M.createPanel({ document: doc, orderID: "o1", rpc: async () => data, uuid: () => "id" });
  panel.setOrderStatus("on_the_way"); await panel.refresh();
  assert.equal(panel.node.hidden, true);
  data = { status: "ok", open: true, can_write_from: null, courier_muted: false, messages: [{ id: "m2", sender_role: "courier", body: "Kapıdayım", created_at: "2026-11-17T10:00:00Z", is_mine: false }] };
  await panel.refresh();
  assert.equal(panel.node.hidden, false);
  assert.equal(panel.node.find("chat-form").hidden, false);
  assert.equal(panel.node.find("chat-body").textContent, "Kapıdayım");
});

test("sources never use innerHTML and index loads the script with a version", () => {
  assert.doesNotMatch(fs.readFileSync("hesabim/order-messages.js", "utf8").replace(/\/\/.*$/gm, ""), /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(fs.readFileSync("hesabim/index.html", "utf8"), /order-messages\.js\?v=\d{8}-\d+/);
  assert.doesNotMatch(fs.readFileSync("hesabim/index.html", "utf8"), /<script(?![^>]*src)/);
});

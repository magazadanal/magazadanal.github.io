"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = readFileSync(path.join(__dirname, "../password-reset/password-reset.js"), "utf8");
const accountSource = readFileSync(path.join(__dirname, "../hesabim/hesabim.js"), "utf8");
const key = "magazadanal.password-recovery";
const hash = "b".repeat(56);
const password = "Synthetic-Only-Password-123";
const token = (owner) => "synthetic." + Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".MOCK";
const tokenA = token("account-a"), tokenB = token("account-b");

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}
function eventNode() {
  const events = new Map();
  return {
    value: "", disabled: false, hidden: false, checked: false, dataset: {}, textContent: "", className: "",
    classList: { add() {}, remove() {}, toggle() {} }, focus() {}, replaceChildren() {}, append() {},
    addEventListener(name, callback) { events.set(name, callback); },
    async dispatch(name, values = {}) { await events.get(name)?.({ preventDefault() {}, ...values }); }
  };
}
function documentFixture() {
  const nodes = new Map();
  return { title: "Synthetic", documentElement: { dataset: {} }, hidden: false,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, eventNode()); return nodes.get(id); },
    querySelectorAll: () => [], addEventListener() {} };
}
function page({ search = "", fragment = "", store = storage(), reject = false } = {}) {
  const document = documentFixture(), window = eventNode(), calls = [];
  window.location = { search, hash: fragment, pathname: "/password-reset/" };
  window.history = { replaceState() {} };
  vm.runInNewContext(source, {
    document, window, sessionStorage: store, URLSearchParams,
    atob: (v) => Buffer.from(v, "base64").toString("binary"),
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.redirect, "error");
      if (reject) return { ok: false, status: 401, json: async () => ({}) };
      if (url.endsWith("/verify")) return { ok: true, json: async () => ({ access_token: tokenB }) };
      assert.equal(options.method, "PUT");
      return { ok: true, json: async () => ({}) };
    }
  }, { timeout: 1000 });
  return { calls, store, window, document, async submit() {
    document.getElementById("new-password").value = password;
    document.getElementById("confirm-password").value = password;
    await document.getElementById("password-reset-form").dispatch("submit");
  } };
}
function cached() {
  const store = storage();
  store.setItem(key, JSON.stringify({ accessToken: tokenA, expiresAt: Date.now() + 600000 }));
  return store;
}

test("fresh reset hash verifies B and cannot restore cached A", async () => {
  const p = page({ store: cached(), search: `?token_hash=${hash}&type=recovery` });
  await p.submit();
  assert.equal(p.calls.length, 2);
  assert.equal(JSON.parse(p.calls[0].body).token_hash, hash);
  assert.equal(p.calls[1].headers.Authorization, `Bearer ${tokenB}`);
  assert.equal(p.store.getItem(key), null);
});
test("bare reset cannot reuse a previous recovery credential", async () => {
  const p = page({ store: cached() });
  assert.equal(p.document.getElementById("submit-button").disabled, true);
  await p.submit();
  assert.equal(p.calls.length, 0);
  assert.equal(p.store.getItem(key), null);
});
test("fragment recovery remains in memory only and clears on success", async () => {
  const p = page({ fragment: `#access_token=${tokenA}&type=recovery` });
  assert.equal(p.store.getItem(key), null);
  await p.submit();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].headers.Authorization, `Bearer ${tokenA}`);
  assert.equal(p.document.getElementById("reset-status").className, "status status-success");
});
for (const search of [`?token_hash=bad&type=recovery`, `?token_hash=${hash}&token_hash=${hash}&type=recovery`,
  `?token_hash=${hash}&type=signup`, `?token_hash=${hash}&type=recovery&error_description=expired`]) {
  test(`invalid explicit recovery fails closed: ${search.slice(0, 45)}`, async () => {
    const p = page({ store: cached(), search }); await p.submit();
    assert.equal(p.calls.length, 0);
    assert.equal(p.document.getElementById("submit-button").disabled, true);
  });
}
test("leaving a reset page invalidates its back-forward cache authority", async () => {
  const p = page({ fragment: `#access_token=${tokenA}&type=recovery` });
  await p.window.dispatch("pagehide"); await p.window.dispatch("pageshow", { persisted: true });
  await p.submit(); assert.equal(p.calls.length, 0);
  assert.equal(p.document.getElementById("submit-button").disabled, true);
});
test("rejected provider credential never reports success", async () => {
  const p = page({ fragment: `#access_token=${tokenA}&type=recovery`, reject: true });
  await p.submit();
  assert.equal(p.document.getElementById("reset-status").className, "status status-error");
  assert.equal(p.document.getElementById("submit-button").disabled, true);
});
test("actual account logout clears legacy cached recovery", async () => {
  const store = cached(), document = documentFixture(), window = eventNode();
  store.setItem("magazadanal.web.session.v1", JSON.stringify({ accessToken: "mock-access", refreshToken: "mock-refresh",
    expiresAt: Date.now() + 3600000, user: { id: "10000000-0000-4000-8000-000000000001", email: "synthetic@example.invalid" } }));
  Object.assign(window, { createMAOrderFlow: () => ({ sync() {}, show() {}, clear() {} }), setTimeout: () => 1,
    clearTimeout() {}, setInterval: () => 1, clearInterval() {}, location: { replace() {} } });
  vm.runInNewContext(accountSource, { document, window, sessionStorage: store, localStorage: storage(), URLSearchParams,
    AbortController, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
    fetch: async (url) => url.includes("get_public_runtime_status") ? new Promise(() => {}) : ({ ok: true, status: 200, json: async () => ({}) })
  }, { timeout: 1000 });
  await document.getElementById("logout-button").dispatch("click");
  assert.equal(store.getItem(key), null);
  assert.equal(store.getItem("magazadanal.web.session.v1"), null);
});

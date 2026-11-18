const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hesabim/session-restore.js"), "utf8");

function stateFor(search, stored = null) {
  const documentElement = { dataset: {} };
  vm.runInNewContext(source, {
    document: { documentElement },
    location: { search },
    URLSearchParams,
    sessionStorage: { getItem: () => stored }
  });
  return documentElement.dataset.sessionState;
}

test("guest order and cart links never start on the login form", () => {
  assert.equal(stateFor("?view=shop"), "restoring");
  assert.equal(stateFor("?view=cart"), "restoring");
  assert.equal(stateFor("?view=shop", "{bozuk"), "restoring");
});

test("guest account pages still start on the login form", () => {
  for (const search of ["", "?view=orders", "?view=profile", "?view=home"]) assert.equal(stateFor(search), undefined);
});

test("a stored session restores on every page", () => {
  const stored = JSON.stringify({ refreshToken: "x", user: { id: "u" } });
  for (const search of ["", "?view=orders", "?view=shop"]) assert.equal(stateFor(search, stored), "restoring");
});

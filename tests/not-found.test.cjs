const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "404.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/not-found.css"), "utf8");

test("both static hosts have a root custom 404 with a Turkish recovery page", () => {
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /<h1>Sayfa bulunamadı<\/h1>/);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /href="\/hesabim\/\?view=shop"/);
  assert.match(html, /href="\/destek\/"/);
});

test("missing nested URLs cannot change asset paths or inject reflected navigation", () => {
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(links.length >= 7);
  assert.ok(links.every(link => link.startsWith("/") && !link.startsWith("//")));
  assert.doesNotMatch(html, /<base|http-equiv="refresh"|<form|<iframe|<script(?! src=)/i);
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]), ["/theme.js?v=20261019-1"]);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test("the missing-page presentation remains scoped and has stable readable dimensions", () => {
  assert.match(css, /\.not-found-page h1/);
  assert.match(css, /letter-spacing: 0/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /\d(?:vw|vmin)|linear-gradient|@import/);
});

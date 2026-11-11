const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
test("public company, fees, regions, refund and pending-card disclosures are available without login", () => {
  const page = read("alisveris-kosullari/index.html");
  for (const value of ["0610169688900001", "6101696889", "No: 1", "360 TL", "288 TL", "70 TL", "36 TL", "Havale", "İptal", "Cayma", "destek@magazadanal.com", "henüz aktif değildir"]) assert.ok(page.includes(value), value);
  assert.ok(!page.includes("0530 673 02 11"));
  assert.ok(read("index.html").includes("/alisveris-kosullari/"));
  assert.ok(read("hesabim/index.html").includes("/hesap-silme/"));
});
test("QNB does not introduce card data collection, third-party scripts or fake payment success", () => {
  const flow = read("hesabim/order-flow.js");
  assert.ok(flow.includes("cardInput.disabled = true"));
  assert.ok(flow.includes("Ödeme henüz doğrulanmadı."));
  assert.ok(!/name=["'](?:card|cvv)|MerchantPassword/.test(flow));
  const html = read("hesabim/index.html");
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
  assert.ok(html.includes("frame-src 'self'"));
  assert.ok(!html.includes('frame-src https:') && !html.includes('challenges.cloudflare.com'));
  assert.ok(!html.includes("unsafe-eval"));
});
test("pinned map dependency retains license and audited bytes", () => {
  for (const [file, expected] of [["leaflet.js", "db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a"], ["leaflet.css", "a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6"]]) assert.equal(crypto.createHash("sha256").update(read(`assets/vendor/leaflet/${file}`)).digest("hex"), expected);
  assert.ok(read("assets/vendor/leaflet/LICENSE").includes("Redistribution"));
});
test("account and public conditions policies allow only their required resources", () => {
  const account = read("hesabim/index.html"), terms = read("alisveris-kosullari/index.html"), preview = read("scripts/preview.cjs");
  assert.ok(account.includes("connect-src 'self' https://zxqqbzggfbxoasyhueqb.supabase.co;"));
  assert.ok(account.includes("img-src 'self' data: https://tile.openstreetmap.org;"));
  assert.ok(terms.includes("connect-src 'self';"));
  for (const html of [account, terms]) {
    assert.ok(html.includes("default-src 'none';"));
    assert.ok(html.includes("script-src 'self';"));
    assert.ok(!/unsafe-inline|unsafe-eval|https:\/\/\*/.test(html));
  }
  assert.ok(account.includes("frame-src 'self';"));
  assert.ok(read("_headers").split("/hesabim/*")[0].includes("frame-src 'none';"));
  assert.ok(preview.includes('geolocation=${account ? "(self)" : "()"}'));
  assert.ok(read("docs/web-bank-readiness.md").includes("GitHub Pages tarafından uygulanmaz"));
});

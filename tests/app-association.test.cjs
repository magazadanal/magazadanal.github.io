const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const associationPath = "/.well-known/apple-app-site-association";
const bytes = fs.readFileSync(path.join(root, associationPath));
const association = JSON.parse(bytes);

test("corporate and legacy apps share only the existing auth paths", () => {
  assert.ok(bytes.length < 128 * 1024);
  assert.deepEqual(Object.keys(association), ["applinks"]);
  assert.equal(association.applinks.details.length, 1);
  const detail = association.applinks.details[0];
  assert.deepEqual(detail.appIDs, [
    "H7SP354548.com.magazadanal.mobile",
    "6LSP96MK35.com.magazadanal.app",
  ]);
  assert.deepEqual(detail.components.map(component => component["/"]), [
    "/auth/confirmed/*", "/auth/recovery/*",
  ]);
  assert.equal(detail.appIDs.some(id => id.includes("*") || id.includes("review")), false);
});

test("JSON response header is scoped to exactly the association file", () => {
  const headers = fs.readFileSync(path.join(root, "_headers"), "utf8");
  const sections = headers.trim().split(/\n\s*\n/);
  const jsonSections = sections.filter(section => /Content-Type:\s*application\/json/.test(section));
  assert.equal(jsonSections.length, 1);
  assert.equal(jsonSections[0].split("\n")[0], associationPath);
  assert.match(sections[0], /X-Content-Type-Options: nosniff/);
  assert.match(sections[0], /X-Frame-Options: DENY/);
  for (const route of ["/auth/*", "/password-reset/*", "/hesabim/*"]) {
    const section = sections.find(value => value.split("\n")[0] === route);
    assert.match(section, /Cache-Control: no-store, max-age=0/);
  }
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../hesabim/photon.js");

const point = { latitude: 41.0602, longitude: 28.9877 };
const feature = (properties, xy = [point.longitude, point.latitude]) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: xy } });
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test("only district and neighbourhood are filled; street and door number never come from a single result", () => {
  const full = feature({ countrycode: "TR", county: "Sisli", district: "Test Mahallesi", street: "Test Sokak", housenumber: "1", name: "Untrusted POI" });
  assert.deepEqual(P.cleanAddress({ features: [full] }, point), { city: "İstanbul", district: "Şişli", neighborhood: "Test Mahallesi" });
  // Measured live response shape (2026-11-19): city carries the district, locality the neighbourhood.
  const live = feature({ osm_key: "amenity", type: "house", name: "Burger King", street: "Halaskargazi Caddesi", locality: "19 Mayıs", city: "Şişli", state: "İstanbul", countrycode: "TR" });
  assert.deepEqual(P.cleanAddress({ features: [live] }, point), { city: "İstanbul", district: "Şişli", neighborhood: "19 Mayıs" });
  assert.deepEqual(P.cleanAddress({ features: [feature({ countrycode: "DE", city: "Şişli" })] }, point), {});
  assert.deepEqual(P.cleanAddress({ features: [feature({ countrycode: "TR", city: "Şişli" }, [28.5, 41.2])] }, point), {}, "A far-away result is ignored");
  assert.throws(() => P.cleanAddress({}, point));
});

test("nearby street options: nearer and repeated first, Sokak/Sokağı merged, platforms and unsafe text dropped, at most four", () => {
  const at = (dx, dy) => [point.longitude + dx, point.latitude + dy];
  const data = { features: [
    feature({ countrycode: "TR", type: "house", osm_key: "amenity", osm_value: "cafe", street: "Hacı Emin Efendi Sokağı" }, at(0.0004, 0.0001)),
    feature({ countrycode: "TR", type: "house", osm_key: "tourism", osm_value: "hotel", name: "Hotel", street: "Hacı Emin Efendi Sokağı", housenumber: "57" }, at(0.0005, 0.0002)),
    feature({ countrycode: "TR", type: "street", osm_key: "highway", osm_value: "residential", name: "Güzelbahçe Sokak" }, at(-0.0004, 0.0003)),
    feature({ countrycode: "TR", type: "street", osm_key: "highway", osm_value: "residential", name: "Güzelbahçe Sokağı" }, at(-0.0005, 0.0004)),
    feature({ countrycode: "TR", type: "street", osm_key: "highway", osm_value: "service", name: "Peron 3" }, at(0.0001, 0.0001)),
    feature({ countrycode: "TR", type: "house", osm_key: "highway", osm_value: "bus_stop", name: "Durak", street: "Peron 2" }, at(0.0001, 0.0001)),
    feature({ countrycode: "TR", type: "house", osm_key: "shop", osm_value: "clothes", name: "Shop", street: "<b>x</b>" }, at(0.0001, 0.0001)),
    feature({ countrycode: "TR", type: "street", osm_key: "highway", osm_value: "residential", name: "Yedi Kardeşler Sokağı" }, at(0.0006, 0.0004)),
    feature({ countrycode: "TR", type: "house", osm_key: "shop", osm_value: "clothes", name: "Shop", street: "Şakayık Sokağı" }, at(0.0007, 0.0004)),
    feature({ countrycode: "TR", type: "house", osm_key: "shop", osm_value: "clothes", name: "Shop", street: "Uzak Sokak" }, at(0.01, 0.01)),
  ] };
  assert.deepEqual(P.streetOptions(data, point), ["Hacı Emin Efendi Sokağı", "Güzelbahçe Sokak", "Yedi Kardeşler Sokağı", "Şakayık Sokağı"]);
  assert.deepEqual(P.streetOptions({}, point), []);
});

test("reverse lookup sends only the coordinate, without cookies or referrer, and returns street options", async () => {
  let seen;
  const fetcher = async (url, options) => { seen = { url: new URL(url), options }; return reply({ features: [
    feature({ countrycode: "TR", city: "Beyoğlu", district: "Asmalımescit", street: "Test Caddesi", housenumber: "7" }),
    feature({ countrycode: "TR", type: "street", osm_key: "highway", osm_value: "residential", name: "Öteki Sokak", city: "Beyoğlu" }),
  ] }); };
  const address = await P.reverseAddress(point.latitude, point.longitude, fetcher);
  assert.equal(seen.url.origin, "https://photon.komoot.io"); assert.equal(seen.url.pathname, "/reverse");
  assert.deepEqual([...seen.url.searchParams.keys()].sort(), ["lat", "limit", "lon", "radius"]);
  assert.equal(seen.url.searchParams.get("limit"), "10"); assert.equal(seen.url.searchParams.get("radius"), "0.15");
  assert.equal(seen.options.credentials, "omit"); assert.equal(seen.options.referrerPolicy, "no-referrer"); assert.equal(seen.options.method, "GET");
  assert.equal(seen.options.body, undefined);
  assert.deepEqual(address, { city: "İstanbul", district: "Beyoğlu", neighborhood: "Asmalımescit", street_options: ["Test Caddesi", "Öteki Sokak"] });
});

test("reverse lookup outside Istanbul never calls the provider; provider failures carry their status", async () => {
  let calls = 0; const fetcher = async () => { calls++; return reply({ features: [] }); };
  assert.deepEqual(await P.reverseAddress(39.9, 32.8, fetcher), {}); assert.equal(calls, 0);
  await assert.rejects(P.reverseAddress(point.latitude, point.longitude, async () => reply({}, 403)), error => error.status === 403);
  await assert.rejects(P.reverseAddress(point.latitude, point.longitude, async () => reply({}, 429)), error => error.status === 429);
  await assert.rejects(P.reverseAddress(point.latitude, point.longitude, async () => { throw TypeError("network"); }), error => error.status === 0);
  const huge = { ok: true, status: 200, text: async () => "x".repeat(200000) };
  await assert.rejects(P.reverseAddress(point.latitude, point.longitude, async () => huge));
});

test("store search keeps the store-prefix rule, bounds Istanbul and cleans results", async () => {
  assert.equal(P.storeQuery("Zara", "Zara Nişantaşı"), "zara nişantaşı");
  assert.equal(P.storeQuery("Zara", "Nişantaşı"), null);
  assert.equal(P.storeQuery("Unknown", "Unknown"), null);
  assert.equal(P.storeQuery("Zara", "Zara 123456"), null);
  assert.equal(P.storeQuery("Zara", "Zara a@b"), null);
  let seen;
  const rows = await P.searchStores("Zara", "Zara  Nişantaşı", async url => { seen = new URL(url); return reply({ features: [
    feature({ name: "Zara", street: "Abdi İpekçi", housenumber: "5", city: "Şişli" }, [28.99, 41.05]),
    feature({ name: "Zara Ankara" }, [32.8, 39.9]),
    feature({ street: "No name" }, [28.99, 41.05]),
  ] }); });
  assert.equal(seen.pathname, "/api/"); assert.equal(seen.searchParams.get("q"), "zara nişantaşı"); assert.equal(seen.searchParams.get("bbox"), "28.5,40.6,29.9,41.5");
  assert.deepEqual(rows, [{ name: "Zara, Abdi İpekçi, 5, Şişli", latitude: 41.05, longitude: 28.99 }]);
  await assert.rejects(P.searchStores("Zara", "Başka", async () => reply({ features: [] })), error => error.status === 400);
});

test("the account page loads Photon before the order flow and allows it in both security policies", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "hesabim/index.html"), "utf8");
  const headers = fs.readFileSync(path.join(root, "_headers"), "utf8");
  assert.ok(html.indexOf("/hesabim/photon.js") > 0 && html.indexOf("/hesabim/photon.js") < html.indexOf("/hesabim/order-flow.js"));
  for (const text of [html, headers.slice(headers.indexOf("/hesabim/*"))]) assert.ok(text.includes("https://zxqqbzggfbxoasyhueqb.supabase.co https://photon.komoot.io;"));
  const flow = fs.readFileSync(path.join(root, "hesabim/order-flow.js"), "utf8");
  assert.ok(!flow.includes("web-address-lookup") && !flow.includes("web-store-search"), "The blocked server lookups are no longer called");
  assert.ok(flow.includes("IP adresin tarayıcından doğrudan Photon"), "The customer is told that the IP address reaches Photon");
});

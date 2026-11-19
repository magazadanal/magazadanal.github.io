// Photon (komoot) address and store lookup straight from the customer's browser.
// Photon refuses requests from our server (HTTP 403, measured 2026-11-19), so the browser asks it directly.
// Only the coordinate or the store text leaves the browser; no name, phone or account data is sent.
// Mapping and filtering match the former web-address-lookup / web-store-search server functions.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MAPhoton = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const BASE = "https://photon.komoot.io";
  const districts = ["Şişli", "Beşiktaş", "Beyoğlu", "Kağıthane", "Sarıyer"];
  const stores = ["Beymen", "Sephora", "Zara", "Pull&Bear", "Oysho", "Bershka", "Mango", "Nike", "Adidas", "Ebebek", "Massimo Dutti", "Penti", "İpekyol", "Boyner", "SuperStep", "Under Armour", "Alo", "Victoria's Secret", "Calzedonia", "Beymen Club", "Network", "Twist", "Brooks Brothers", "Brandy's", "Divarese", "Gant", "Gap", "Apple", "Lacoste", "MAC", "Nautica", "Teknosa", "Pandora"];
  const MAX_BYTES = 131072;

  function istanbulPoint(latitude, longitude) {
    return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= 40.6 && latitude <= 41.5 && longitude >= 28.5 && longitude <= 29.9;
  }
  const text = value => typeof value === "string" && value.length <= 200 && !/[<>\u0000-\u001f\u007f]/u.test(value) ? value.trim() : "";
  const folded = value => text(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("ı", "i");

  function cleanAddress(data, point) {
    if (!Array.isArray(data?.features)) throw Error("Invalid provider response");
    for (const row of data.features.slice(0, 3)) {
      const xy = row?.geometry?.coordinates, p = row?.properties;
      if (row?.geometry?.type !== "Point" || !Array.isArray(xy) || xy.length !== 2 || !p
        || !istanbulPoint(xy[1], xy[0])
        || Math.abs(xy[1] - point.latitude) > 0.01 || Math.abs(xy[0] - point.longitude) > 0.01
        || (p.countrycode && String(p.countrycode).toUpperCase() !== "TR")) continue;
      const district = districts.find(name => [p.county, p.city, p.district, p.locality].some(value => folded(value) === folded(name)));
      if (!district && ![p.city, p.state].some(value => folded(value) === "istanbul")) continue;
      const neighborhood = [p.district, p.locality].map(text).find(value => value && !districts.some(name => folded(name) === folded(value)) && !["istanbul", "turkiye", "turkey"].includes(folded(value)));
      // Street and door number are not taken from a single result: the nearest shop's address often names a
      // neighbouring street (measured 2026-11-19), and a wrong street misleads the courier. See streetOptions.
      return Object.fromEntries(Object.entries({ city: "İstanbul", district, neighborhood }).filter(([, value]) => value));
    }
    return {};
  }

  // Platforms, service roads and paths are not delivery streets.
  const SKIP = new Set(["service", "platform", "bus_stop", "footway", "steps", "path", "track", "cycleway", "corridor", "elevator", "bus_station"]);
  const streetKey = name => folded(name).replace(/\b(sokagi|sokak|sk|caddesi|cadde|cd|bulvari|bulvar|araligi|aralik|cikmazi|cikmaz)\b\.?/g, "").replace(/\s+/g, " ").trim();
  // Up to four nearby street names for the customer to choose from. Nearer and repeated names rank first;
  // "X Sokak" and "X Sokağı" count as one street.
  function streetOptions(data, point, max = 4) {
    if (!Array.isArray(data?.features)) return [];
    const ranked = new Map();
    data.features.slice(0, 10).forEach((row, index) => {
      const xy = row?.geometry?.coordinates, p = row?.properties;
      if (row?.geometry?.type !== "Point" || !Array.isArray(xy) || xy.length !== 2 || !p || !istanbulPoint(xy[1], xy[0])
        || Math.abs(xy[1] - point.latitude) > 0.003 || Math.abs(xy[0] - point.longitude) > 0.004
        || (p.countrycode && String(p.countrycode).toUpperCase() !== "TR") || SKIP.has(p.osm_value)) return;
      const name = p.type === "street" && p.osm_key === "highway" ? text(p.name) : text(p.street);
      const key = name && streetKey(name);
      if (!key) return;
      const entry = ranked.get(key) || { name, score: 0, first: index };
      entry.score += 1 / (1 + index); ranked.set(key, entry);
    });
    return [...ranked.values()].sort((a, b) => b.score - a.score || a.first - b.first).slice(0, max).map(entry => entry.name);
  }

  function storeQuery(store, query) {
    if (!stores.includes(store) || typeof query !== "string") return null;
    const value = query.normalize("NFKC").trim().replace(/\s+/g, " ");
    const prefix = store.normalize("NFKC").toLocaleLowerCase("tr-TR");
    const lower = value.toLocaleLowerCase("tr-TR");
    if (value.length > 120 || !(lower === prefix || lower.startsWith(prefix + " ")) || /[@<>\r\n]|\d{6}/.test(value)) return null;
    return lower;
  }

  function cleanResults(data) {
    if (!Array.isArray(data?.features)) throw Error("Invalid provider response");
    return data.features.slice(0, 6).filter(row => row?.geometry?.type === "Point" && Array.isArray(row.geometry.coordinates) && typeof row.properties?.name === "string")
      .map(row => ({ name: [row.properties.name, row.properties.street, row.properties.housenumber, row.properties.district, row.properties.city]
        .filter(value => typeof value === "string" && value.trim()).join(", ").slice(0, 250),
        latitude: Number(row.geometry.coordinates[1]), longitude: Number(row.geometry.coordinates[0]) }))
      .filter(row => row.name && istanbulPoint(row.latitude, row.longitude));
  }

  function failure(status) { const error = Error("Photon unavailable"); error.status = status; return error; }

  async function request(path, params, fetcher) {
    const target = new URL(path, BASE);
    target.search = new URLSearchParams(params).toString();
    let response;
    try {
      response = await fetcher(target.toString(), { method: "GET", credentials: "omit", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    } catch { throw failure(0); }
    if (!response.ok) throw failure(response.status);
    const body = await response.text();
    if (body.length > MAX_BYTES) throw failure(0);
    return JSON.parse(body);
  }

  async function reverseAddress(latitude, longitude, fetcher = globalThis.fetch.bind(globalThis)) {
    if (!istanbulPoint(latitude, longitude)) return {};
    const point = { latitude, longitude };
    const data = await request("/reverse", { lat: String(latitude), lon: String(longitude), radius: "0.15", limit: "10" }, fetcher);
    const address = cleanAddress(data, point);
    const streets = streetOptions(data, point);
    return streets.length ? { ...address, street_options: streets } : address;
  }

  async function searchStores(store, query, fetcher = globalThis.fetch.bind(globalThis)) {
    const q = storeQuery(store, query);
    if (!q) throw failure(400);
    const data = await request("/api/", { q, limit: "6", bbox: "28.5,40.6,29.9,41.5" }, fetcher);
    return cleanResults(data);
  }

  return { BASE, stores, cleanAddress, streetOptions, storeQuery, cleanResults, reverseAddress, searchStores };
});

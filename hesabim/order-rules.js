(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MAOrderRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const districts = ["Şişli", "Beşiktaş", "Beyoğlu", "Kağıthane", "Sarıyer"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function splitName(value) {
    const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
  }
  function splitPhone(value, countries = []) {
    const normalized = phone(value) || String(value || "").replace(/[ ()-]/g, "");
    const codes = [...new Set(countries.map(country => country.code))].sort((a, b) => b.length - a.length);
    const code = codes.find(code => normalized.startsWith(code)) || "+90";
    return { code, number: normalized.startsWith(code) ? normalized.slice(code.length) : String(value || "").replace(/\D/g, "") };
  }
  function joinedPhone(code, number) {
    if (!/^\+[1-9]\d{0,3}$/.test(code)) return null;
    let national = String(number || "").replace(/[ ()-]/g, "");
    if (code === "+90" && national.startsWith("0")) national = national.slice(1);
    return /^\d+$/.test(national) ? phone(code + national) : null;
  }
  function point(lat, lng) {
    return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }
  function link(value) {
    try {
      const u = new URL(value);
      return value.length <= 2048 && ["https:", "http:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password;
    } catch { return false; }
  }
  function phone(value) {
    let s = String(value || "").replace(/[ ()-]/g, "");
    if (/^05\d{9}$/.test(s)) s = `+90${s.slice(1)}`;
    else if (/^5\d{9}$/.test(s)) s = `+90${s}`;
    else if (/^90\d{10}$/.test(s)) s = `+${s}`;
    else if (s.startsWith("00")) s = `+${s.slice(2)}`;
    return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
  }
  function freshPosition(p, now = Date.now()) {
    if (!p || !point(p.latitude, p.longitude) || !Number.isFinite(p.accuracy_meters) || p.accuracy_meters < 0 || p.accuracy_meters > 500) return false;
    return [p.captured_at, p.received_at].every((date) => {
      const age = now - Date.parse(date); return age >= -5000 && age <= 120000;
    });
  }
  function totals(items, express, percent = 0) {
    const products = items.reduce((sum, item) => sum + Number(item.estimated_price), 0);
    const stores = new Set(items.map((item) => item.store.trim())).size;
    const service = items.length && typeof express === "boolean" ? (express ? 360 : 288) + Math.max(0, stores - 1) * 70 + Math.max(0, items.length - 1) * 36 : 0;
    const discount = Math.floor(service * Math.min(100, Math.max(0, percent)) / 100 + 0.5);
    return { products, service, discount, total: products + service - discount, stores };
  }
  function validStoreName(value) {
    return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 100
      && /[\p{L}\p{N}]/u.test(value) && !/[<>\u0000-\u001f\u007f]/u.test(value);
  }
  function productName(items, store) {
    return `Ürün ${items.filter(item => item.store === store).length + 1}`;
  }
  function missingStores(draft) {
    return (draft.selectedStores || []).filter(store => !draft.items.some(item => item.store === store));
  }
  function validateItem(item) {
    if (!UUID.test(item.client_item_id)) throw Error("Ürün kimliği geçersiz.");
    if (!validStoreName(item.store)) throw Error("Geçerli bir mağaza adı gir (en fazla 100 karakter).");
    for (const key of ["branch", "product_name", "size", "color"]) {
      if (!String(item[key] || "").trim() || item[key].length > 200) throw Error("Ürün, şube, beden ve renk bilgilerini tamamla.");
    }
    if (!/^[\p{L}\s]+$/u.test(item.color) || item.color.replace(/\s/g, "").length < 3) throw Error("Rengi en az üç harfle yaz.");
    if (!Number.isInteger(item.estimated_price) || item.estimated_price < 1 || item.estimated_price > 1000000) throw Error("Ürün fiyatını 1–1.000.000 TL arasında tam sayı olarak gir.");
    if (item.product_link && !link(item.product_link)) throw Error("Ürün bağlantısı http veya https olmalıdır.");
    if (!item.image_data_base64 && !link(item.product_link || "")) throw Error("Ürün fotoğrafı veya bağlantısı ekle.");
    if (item.image_data_base64 && (!/^\/9j\/[A-Za-z0-9+/=]+$/.test(item.image_data_base64) || item.image_data_base64.length > 1048576)) throw Error("Fotoğraf geçersiz veya çok büyük.");
    if (!point(item.store_latitude, item.store_longitude)) throw Error("Bu şubeden al bölümünde mağaza konumunu seç.");
    if ((item.order_note || "").length > 1000) throw Error("Sipariş notu en fazla 1000 karakter olabilir.");
    return item;
  }
  function validate(draft, stores) {
    if (!draft.items?.length || draft.items.length > 30) throw Error("Sepette 1–30 ürün olmalıdır.");
    if (draft.selectedStores !== undefined && (!Array.isArray(draft.selectedStores) || draft.selectedStores.length > 30 || !draft.selectedStores.every(validStoreName))) throw Error("Mağaza seçimini kontrol et.");
    if (missingStores(draft).length) throw Error(`${missingStores(draft).join(", ")} için ürün bilgilerini tamamla.`);
    draft.items.forEach((item) => validateItem(item, stores));
    validateAddress(draft.address);
    if (!UUID.test(draft.requestID)) throw Error("Sipariş talep kimliği geçersiz.");
    return true;
  }
  function validateAddress(a) {
    if (!a || !districts.includes(a.district)) throw Error("Hizmet verilen bir ilçe seç.");
    for (const key of ["customer_name", "customer_phone", "neighborhood", "address_line", "building_no", "building_name", "directions"]) {
      if (!String(a[key] || "").trim() || a[key].length > 500) throw Error("Teslimat adresindeki tüm alanları tamamla.");
    }
    if (!phone(a.customer_phone)) throw Error("Geçerli bir cep telefonu gir.");
    if (a.customer_name.trim().length < 2 || a.customer_name.trim().length > 100) throw Error("Alıcı ad soyadını kontrol et.");
    if (!point(a.latitude, a.longitude)) throw Error("Teslimat konumunu haritadan seç.");
    return true;
  }
  function addressSummary(a) {
    return [a.address_line, `No: ${a.building_no}`, a.building_name, a.neighborhood, a.district, a.directions].filter(Boolean).join(", ");
  }
  async function hash(text) {
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
  }
  async function documents(draft, catalog, email, stores) {
    validate(draft, stores);
    if (typeof draft.express !== "boolean") throw Error("Teslimat seçeneğini seç.");
    const t = totals(draft.items, draft.express, draft.promotion?.percent || 0);
    const values = {
      REQUEST_ID: draft.requestID, CREATED_AT: draft.createdAt,
      CUSTOMER_NAME: draft.buyer?.full_name || draft.address.customer_name, CUSTOMER_EMAIL: email,
      CUSTOMER_PHONE: draft.buyer?.phone || draft.address.customer_phone, DELIVERY_ADDRESS: addressSummary(draft.address),
      PRODUCT_LINES: draft.items.map((item, i) => `${i + 1}. ${item.store} / ${item.product_name}: ${item.estimated_price} TL`).join("\n"),
      STORE_NAMES: [...new Set(draft.items.map((item) => item.store))].join(", "),
      PRODUCT_TOTAL: String(t.products), SERVICE_TOTAL: String(t.service), DISCOUNT: String(t.discount), GRAND_TOTAL: String(t.total),
      DELIVERY_OPTION: draft.express ? "1-3 saatte teslim" : "Gün içinde teslim"
    };
    return Promise.all(catalog.order.map(async (doc) => {
      const content = doc.template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
        if (!(key in values)) throw Error("Sözleşme alanı eksik.");
        return values[key];
      });
      return { document_type: doc.document_type, document_version: doc.document_version,
        transaction_model: doc.transaction_model, content, content_hash: await hash(content), accepted: true, title: doc.title };
    }));
  }
  function payload(draft, docs) {
    if (typeof draft.express !== "boolean") throw Error("Teslimat seçeneğini seç.");
    const address = clone(draft.address);
    address.summary = addressSummary(address);
    address.is_different_region = false;
    address.customer_phone = phone(address.customer_phone);
    return { p_client_request_id: draft.requestID, items: clone(draft.items), delivery_address: address,
      delivery_option: draft.express ? "1-3 saatte teslim" : "Gün içinde teslim", payment_method: "bank_transfer",
      legal_acceptances: clone(docs), p_promotion_code: draft.promotion?.code || null };
  }
  function newDraft() {
    return { requestID: globalThis.crypto.randomUUID(), createdAt: new Date().toISOString(), items: [], selectedStores: [], multiStore: false, address: {}, express: null, payment: null, selectionVersion: 1, promotion: null };
  }
  function result(row, expectedAmount) {
    if (row?.authorized !== true || !["success", "already_created"].includes(row.result) || !UUID.test(row.order_id || "")
      || !Number.isFinite(row.amount) || row.amount <= 0 || typeof row.transfer_code !== "string" || !row.transfer_code.trim()) {
      throw Error("Sipariş sonucu doğrulanamadı. Aynı talep ile yeniden kontrol et; yeni sipariş oluşturma.");
    }
    return { ...row, amountChanged: Math.abs(row.amount - expectedAmount) > 0.005 };
  }
  return { districts, UUID, clone, splitName, splitPhone, joinedPhone, point, link, phone, freshPosition, totals, validStoreName, productName, missingStores, validateItem, validateAddress, validate, addressSummary, hash, documents, payload, newDraft, result };
});

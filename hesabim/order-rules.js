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
  function signupName(first, last) {
    const parts = [[first, "Ad"], [last, "Soyad"]].map(([value, label]) => {
      if (typeof value !== "string" || !value.trim()) throw Error(`${label} alanını doldur.`);
      const text = value.trim().replace(/\s+/g, " ");
      if (text.length > 50 || !/\p{L}/u.test(text) || /[<>\u0000-\u001f\u007f]/u.test(text)) throw Error(`${label} alanını kontrol et.`);
      return text;
    });
    const full = parts.join(" ");
    if (full.length > 100) throw Error("Ad ve soyad toplamı en fazla 100 karakter olabilir.");
    return full;
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
  function clipboardLink(text) {
    if (typeof text !== "string" || text.length > 8192) return null;
    const value = text.trim();
    const candidates = /\s/.test(value) ? (value.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || []) : [value];
    for (const candidate of candidates) {
      const url = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
      if (link(url)) return new URL(url).href;
    }
    return null;
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
  function pickupBranch(store, name = "") {
    return (String(name || "").trim() || `${store} · Haritadan seçilen konum`).slice(0, 200);
  }
  function missingStores(draft) {
    return (draft.selectedStores || []).filter(store => !draft.items.some(item => item.store === store));
  }
  function validateItem(item) {
    if (!UUID.test(item.client_item_id)) throw Error("Ürün kimliği geçersiz.");
    if (!validStoreName(item.store)) throw Error("Geçerli bir mağaza adı gir (en fazla 100 karakter).");
    for (const [key, label] of [["branch", "Mağaza şubesi"], ["product_name", "Ürün"], ["size", "Beden / boyut"], ["color", "Renk"]]) {
      if (typeof item[key] !== "string" || !item[key].trim()) throw Error(`${label} alanını doldur.`);
      if (item[key].length > 200) throw Error(`${label} en fazla 200 karakter olabilir.`);
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
    for (const [key, label] of [["customer_name", "Alıcı adı soyadı"], ["customer_phone", "Alıcı cep telefonu"], ["neighborhood", "Mahalle"], ["address_line", "Cadde / sokak"], ["building_no", "Bina numarası"], ["building_name", "Bina adı, kat ve daire"], ["directions", "Adres tarifi"]]) {
      if (typeof a[key] !== "string" || !a[key].trim()) throw Error(`${label} alanını doldur.`);
      if (a[key].length > 500) throw Error(`${label} en fazla 500 karakter olabilir.`);
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
      REQUEST_ID: referenceCode(draft, draft.checkoutReference?.owner) || draft.requestID, CREATED_AT: draft.createdAt,
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
  function referenceCode(draft, owner) {
    const reference = draft.checkoutReference;
    return UUID.test(owner || "") && reference?.owner === owner && reference.requestID === draft.requestID
      && typeof reference.code === "string" && /^[0-9]{6,19}$/.test(reference.code) ? reference.code : null;
  }
  function reservation(row) {
    if (row?.authorized !== true || !["reserved", "already_created"].includes(row.result)
      || typeof row.reference_code !== "string" || !/^[0-9]{6,19}$/.test(row.reference_code) || (row.result === "already_created" && !UUID.test(row.order_id || ""))) {
      throw Error("Açıklama kodu doğrulanamadı. Para göndermeden önce yeniden dene.");
    }
    return row;
  }
  function result(row, expectedAmount) {
    if (row?.authorized !== true || !["success", "already_created"].includes(row.result) || !UUID.test(row.order_id || "")
      || !Number.isFinite(row.amount) || row.amount <= 0 || typeof row.transfer_code !== "string" || !row.transfer_code.trim()) {
      throw Error("Sipariş sonucu doğrulanamadı. Aynı talep ile yeniden kontrol et; yeni sipariş oluşturma.");
    }
    return { ...row, amountChanged: Math.abs(row.amount - expectedAmount) > 0.005 };
  }
  function paymentCents(value) {
    const amount = typeof value === "number" ? value : typeof value === "string" && /^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/.test(value) ? Number(value) : NaN;
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999 || Math.abs(amount * 100 - cents) > 0.0001) throw Error("Ek ödeme tutarı doğrulanamadı.");
    return cents;
  }
  function extraPaymentDetails(rows, orderID, request, events) {
    if (!UUID.test(orderID) || !UUID.test(request?.id) || !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(events)) throw Error("Ek ödeme bilgileri doğrulanamadı.");
    const current = events.filter(e => e.order_id === orderID && e.action === "extra_payment_requested" && e.current_assignment === true)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id))).at(-1);
    if (current?.id !== request.id || !Number.isFinite(Date.parse(current.created_at)) || events.some(e => e.order_id === orderID && e.request_id === request.id && ["extra_payment_reported", "extra_payment_confirmed"].includes(e.action))) throw Error("Ek ödeme talebi değişti. Güncel siparişi kontrol et.");
    const row = rows[0], cents = paymentCents(row.amount);
    if (!UUID.test(row.id) || row.order_id !== orderID || row.purpose !== "adjustment" || row.direction !== "charge" || row.method !== "bank_transfer" || row.status !== "pending"
      || !/^EK-[A-F0-9]{12}$/.test(row.transfer_code || "") || cents !== paymentCents(request.amount) || cents !== paymentCents(current.amount)
      || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) > Date.parse(current.created_at)) throw Error("Ek ödeme kaydı talep ile eşleşmiyor.");
    return {paymentID: row.id, requestID: request.id, code: row.transfer_code, amount: cents / 100};
  }
  return { districts, UUID, clone, splitName, signupName, splitPhone, joinedPhone, point, link, clipboardLink, phone, freshPosition, totals, validStoreName, productName, pickupBranch, missingStores, validateItem, validateAddress, validate, addressSummary, hash, documents, payload, newDraft, referenceCode, reservation, result, paymentCents, extraPaymentDetails };
});

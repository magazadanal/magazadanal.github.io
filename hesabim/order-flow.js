(() => {
  "use strict";
  const R = window.MAOrderRules;
  const money = (n) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, className = "button compact-button") => {
    const node = el("button", text, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const icon = (name) => {
    const node = el("img"); node.src = `/assets/icons/${name}.png`; node.alt = ""; node.className = "app-icon";
    return node;
  };
  function field(parent, text, key, value = "", type = "text", options = {}) {
    const label = el("label", undefined, "app-field");
    const input = el(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    input.name = key;
    if (input.tagName === "INPUT") input.type = type;
    if (type === "select") for (const v of options.values || []) {
      const o = el("option", v.label ?? v); o.value = v.value ?? v; input.append(o);
    }
    input.value = value ?? "";
    input.required = options.required !== false;
    if (options.max) input.maxLength = options.max;
    if (options.min !== undefined) input.min = options.min;
    if (options.maxNumber) input.max = options.maxNumber;
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    label.append(el("span", text), input); parent.append(label);
    return input;
  }
  function status(parent, message, error = false) {
    parent.textContent = message;
    parent.className = `status status-${error ? "error" : "info"}`;
    parent.hidden = !message;
  }
  function modal(title) {
    const dialog = el("dialog", undefined, "app-dialog");
    dialog.setAttribute("aria-label", title);
    const header = el("div", undefined, "app-dialog-header");
    const close = button("", () => dialog.close(), "app-close");
    close.append(icon("close")); close.title = "Kapat"; close.setAttribute("aria-label", "Kapat");
    header.append(el("h2", title), close);
    const body = el("div", undefined, "app-dialog-body");
    const footer = el("div", undefined, "app-dialog-footer");
    dialog.append(header, body, footer); document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    return { dialog, body, footer };
  }
  function showPhoto(base64) {
    if (!/^\/9j\/[A-Za-z0-9+/=]+$/.test(base64) || base64.length > 1048576) return;
    const view = modal("Ürün fotoğrafı");
    const img = el("img", undefined, "photo-expanded"); img.src = `data:image/jpeg;base64,${base64}`; img.alt = "Ürün"; view.body.append(img);
  }
  async function image(file) {
    if (!file || file.size > 32 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw Error("JPEG, PNG veya WebP fotoğraf seç (en fazla 32 MB).");
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const valid = (bytes[0] === 255 && bytes[1] === 216) || (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
      || (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
    if (!valid) throw Error("Fotoğraf biçimi doğrulanamadı.");
    const bitmap = await createImageBitmap(file);
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64000000) throw Error("Fotoğraf çözünürlüğü çok büyük.");
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.45]) {
        const value = canvas.toDataURL("image/jpeg", quality).split(",")[1];
        if (value.length <= 1048576) return value;
      }
      throw Error("Fotoğraf küçültülemedi; başka bir fotoğraf seç.");
    } finally { bitmap.close(); }
  }
  function choosePoint(initial, onChoose) {
    const view = modal("Konum seç");
    const info = el("p", "Haritayı açtığında OpenStreetMap’e IP adresin ve görüntülenen harita alanı iletilir. Adresini ve bina numaranı ayrıca kontrol et.", "muted");
    const start = button("Haritayı aç", () => {
      start.remove();
      const box = el("div", undefined, "app-map"); box.setAttribute("aria-label", "Konum haritası"); view.body.append(box);
      let selected = R.point(initial?.latitude, initial?.longitude) ? [initial.latitude, initial.longitude] : null;
      const map = L.map(box).setView(selected || [41.072, 28.99], selected ? 16 : 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, referrerPolicy: "strict-origin", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(map);
      let marker;
      const location = el("p", "Haritada teslim alma / teslimat noktasına dokun.", "muted"); view.body.append(location);
      const set = (lat, lng) => {
        if (!R.point(lat, lng)) return;
        selected = [lat, lng];
        if (marker) marker.setLatLng(selected); else marker = L.circleMarker(selected, { radius: 10, color: "#13675b", fillColor: "#2f9c85", fillOpacity: 1 }).addTo(map);
        location.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      };
      if (selected) set(...selected);
      map.on("click", (e) => set(e.latlng.lat, e.latlng.lng));
      const locate = button("Konumum", () => {
        if (!navigator.geolocation) return status(location, "Bu tarayıcı konumu desteklemiyor.", true);
        navigator.geolocation.getCurrentPosition((p) => {
          if (!view.dialog.isConnected) return;
          set(p.coords.latitude, p.coords.longitude); map.setView(selected, 17);
        }, () => status(location, "Konum alınamadı. Haritadan nokta seçebilirsin.", true), { timeout: 12000, maximumAge: 30000 });
      });
      view.footer.append(locate, button("Bu konumu kullan", () => {
        if (!selected) return status(location, "Önce haritadan bir nokta seç.", true);
        onChoose({ latitude: selected[0], longitude: selected[1] }); view.dialog.close();
      }, "button primary-button"));
      view.dialog.addEventListener("close", () => map.remove(), { once: true });
    }, "button primary-button");
    view.body.append(info, start);
  }
  window.createMAOrderFlow = function (host) {
    let stores = [], legal = null, owner = null, profile = null, addresses = [], runtime = null;
    let draft = R.newDraft(), stage = "stores", editing = null, checkout = false, frozen = null, busy = false, loaded = false, epoch = 0;
    let accepted = null, serviceAccepted = false, profileAcks = [];
    const productPanel = document.getElementById("order-flow");
    const cartPanel = document.getElementById("cart-flow");
    const notice = document.getElementById("order-status");
    const key = () => `magazadanal.web.draft.v1.${owner}`;
    const t = () => R.totals(draft.items, draft.express, draft.promotion?.percent || 0);
    const rpc = (name, body = {}) => host.api(`/rest/v1/rpc/${name}`, { method: "POST", body });
    const allowed = () => owner && profile?.is_active && profile.role === "customer" && runtime?.customer_ordering_enabled === true && runtime?.maintenance_enabled !== true;
    function save() {
      if (!owner) return;
      const storedDraft = frozen ? { requestID: draft.requestID, createdAt: draft.createdAt, items: [], address: {}, express: draft.express, promotion: null } : draft;
      try { sessionStorage.setItem(key(), JSON.stringify({ owner, updated: Date.now(), draft: storedDraft, frozen, stage, checkout })); return true; }
      catch { status(notice, "Taslak güvenli biçimde kaydedilemedi. Fotoğraf sayısını/boyutunu azalt veya başka bir tarayıcı kullan. Sipariş henüz gönderilmedi.", true); return false; }
    }
    function mutate() {
      if (frozen || busy) throw Error("Gönderilmiş talebin sonucu kontrol ediliyor; içeriği değiştirme.");
      accepted = null; serviceAccepted = false; save(); updateCartCount();
    }
    function updateCartCount() {
      document.querySelectorAll("[data-cart-count]").forEach((n) => { n.textContent = draft.items.length ? ` (${draft.items.length})` : ""; });
    }
    function message(text, error = true) { status(notice, text, error); }
    function formBase(parent, title) {
      parent.replaceChildren(el("h2", title));
    }
    function beginProduct(name, fresh = false) {
      if (frozen || busy) return message("Önce gönderilmiş sipariş talebini kontrol et.");
      status(notice, "");
      if (!fresh && editing) {
        if (editing.store !== name) {
          editing.store = name; editing.product_name = R.productName(draft.items, name);
          editing.branch = ""; delete editing.store_latitude; delete editing.store_longitude;
        }
      } else {
        editing = { client_item_id: crypto.randomUUID(), store: name, branch: "", product_name: R.productName(draft.items, name), size: "", color: "", estimated_price: "", alternative_size: "İstemiyorum", alternative_color: "İstemiyorum", product_link: "", order_note: "", image_data_base64: null };
      }
      stage = "product"; draft.editing = editing; mutate(); productPage();
    }
    function storePage() {
      formBase(productPanel, "Hangi mağazadan alalım?");
      if (draft.customStoreVisible) {
        const custom = el("form", undefined, "custom-store-form"); custom.noValidate = true;
        const name = field(custom, "Mağaza adı", "custom_store", draft.customStoreInput || "", "text", { max: 100 });
        name.addEventListener("input", () => { draft.customStoreInput = name.value; save(); });
        const next = el("button", undefined, "button compact-button"); next.type = "submit"; next.append(icon("chevron_right")); next.title = "Bu mağazadan al"; next.setAttribute("aria-label", "Bu mağazadan al"); custom.append(next);
        custom.addEventListener("submit", event => {
          event.preventDefault(); if (frozen || busy) return message("Önce gönderilmiş sipariş talebini kontrol et.");
          const value = name.value.trim();
          if (!R.validStoreName(value)) return message("Geçerli bir mağaza adı gir (en fazla 100 karakter).");
          draft.selectedStores = [value]; draft.multiStore = false; draft.customStoreVisible = false; draft.customStoreInput = "";
          beginProduct(value);
        });
        productPanel.append(custom);
      } else productPanel.append(button("Farklı mağaza girişi", () => {
        if (frozen || busy) return message("Önce gönderilmiş sipariş talebini kontrol et.");
        draft.customStoreVisible = true; save(); storePage(); productPanel.querySelector('[name="custom_store"]').focus();
      }, "button compact-button custom-store-toggle"));
      const grid = el("div", undefined, "store-grid");
      stores.forEach((name) => {
        const choice = button(name, () => {
          if (frozen || busy) return message("Önce gönderilmiş sipariş talebini kontrol et.");
          if (draft.multiStore) {
            const selected = draft.selectedStores || [];
            if (!selected.includes(name) && selected.length >= 30) return message("En fazla 30 mağaza seçebilirsin.");
            draft.selectedStores = selected.includes(name) ? selected.filter(value => value !== name) : [...selected, name];
            mutate(); status(notice, ""); storePage();
          } else { draft.selectedStores = [name]; beginProduct(name); }
        }, "store-button");
        if (draft.multiStore) choice.setAttribute("aria-pressed", String((draft.selectedStores || []).includes(name)));
        grid.append(choice);
      });
      productPanel.append(grid);
      const actions = el("div", undefined, "store-selection-actions");
      if (draft.multiStore) actions.append(button("Ürünlere geç", () => {
        if ((draft.selectedStores || []).length < 2) return message("Çoklu mağaza siparişi için en az iki mağaza seç.");
        const store = draft.selectedStores.includes(editing?.store) ? editing.store : R.missingStores(draft)[0] || draft.selectedStores[0];
        beginProduct(store);
      }, "button primary-button"));
      const multi = button(draft.multiStore ? "Çoklu mağaza açık" : "Çoklu mağaza seç", () => {
        if (frozen || busy) return message("Önce gönderilmiş sipariş talebini kontrol et.");
        const previous = draft.selectedStores?.at(-1) || editing?.store;
        draft.multiStore = !draft.multiStore; draft.selectedStores = draft.multiStore || !previous ? [] : [previous];
        mutate(); status(notice, ""); storePage();
      });
      multi.setAttribute("aria-pressed", String(!!draft.multiStore)); actions.append(multi); productPanel.append(actions);
      if (draft.items.length) productPanel.append(button(`Sepete git (${draft.items.length})`, () => host.openView("cart"), "button primary-button app-sticky"));
      const fees = el("a", "Ücretler, teslimat ve satış koşulları"); fees.href = "/alisveris-kosullari/"; productPanel.append(fees);
    }
    function productPage() {
      formBase(productPanel, editing.store);
      const back = button("", () => { stage = "stores"; save(); storePage(); }, "product-back");
      back.append(icon("chevron_left")); back.title = "Mağaza seçimine dön"; back.setAttribute("aria-label", "Mağaza seçimine dön"); productPanel.append(back);
      const form = el("form", undefined, "app-form"); form.noValidate = true;
      const inputs = {};
      const photo = field(form, "Ürün fotoğrafı", "product_photo", "", "file", { required: false });
      photo.accept = "image/jpeg,image/png,image/webp";
      const preview = button("", () => editing.image_data_base64 && showPhoto(editing.image_data_base64), "photo-preview");
      const refreshPhoto = () => {
        preview.replaceChildren(icon("image"));
        if (editing.image_data_base64) { const img = el("img"); img.src = `data:image/jpeg;base64,${editing.image_data_base64}`; img.alt = "Seçilen ürün fotoğrafını büyüt"; preview.replaceChildren(img); }
      };
      refreshPhoto(); form.append(preview);
      form.append(button("Fotoğrafı kaldır", () => { editing.image_data_base64 = null; photo.value = ""; mutate(); refreshPhoto(); }, "text-button"));
      photo.addEventListener("change", async () => {
        const version = epoch; const target = editing;
        photo.disabled = true; submit.disabled = true;
        try { const value = await image(photo.files[0]); if (version !== epoch || target !== editing) return; editing.image_data_base64 = value; mutate(); refreshPhoto(); }
        catch (e) { message(e.message); }
        finally { photo.disabled = false; submit.disabled = false; }
      });
      inputs.product_link = field(form, "Ürün linki", "product_link", editing.product_link, "url", { max: 2048, required: false });
      const branch = el("details", undefined, "app-disclosure"); const summary = el("summary", "Bu şubeden al"); branch.append(summary);
      inputs.branch = field(branch, "Mağaza şubesi", "branch", editing.branch, "text", { max: 200 });
      const locationButton = button("", () => choosePoint({ latitude: editing.store_latitude, longitude: editing.store_longitude }, (p) => {
        editing.store_latitude = p.latitude; editing.store_longitude = p.longitude; mutate(); locationLabel();
      }));
      const locationLabel = () => { locationButton.textContent = R.point(editing.store_latitude, editing.store_longitude) ? "Konum seçildi · Değiştir" : "Mağaza konumu seç"; };
      locationLabel(); branch.append(locationButton); form.append(branch);
      inputs.branch.addEventListener("input", () => { delete editing.store_latitude; delete editing.store_longitude; locationLabel(); });
      const grid = el("div", undefined, "app-form-grid"); form.append(grid);
      for (const [key, label] of [["size", "Beden / boyut"], ["color", "Renk"]]) inputs[key] = field(grid, label, key, editing[key], "text", { max: 200 });
      inputs.estimated_price = field(form, "Tahmini ürün fiyatı (TL)", "estimated_price", editing.estimated_price, "number", { min: 1, maxNumber: 1000000 }); inputs.estimated_price.step = "1";
      inputs.order_note = field(form, "Sipariş notu", "order_note", editing.order_note, "textarea", { max: 1000, required: false });
      for (const [key, input] of Object.entries(inputs)) input.addEventListener("input", () => {
        editing[key] = key === "estimated_price" ? Number(input.value) : input.value; mutate();
      });
      const submit = el("button", draft.items.some((i) => i.client_item_id === editing.client_item_id) ? "Değişiklikleri kaydet" : "Sepete ekle", "button primary-button"); submit.type = "submit";
      form.append(submit); productPanel.append(form);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          if (!owner) return host.requireLogin();
          if (!editing.product_name) editing.product_name = R.productName(draft.items, editing.store);
          R.validateItem(editing, stores);
          if (!draft.items.some((i) => i.client_item_id === editing.client_item_id) && draft.items.length >= 30) throw Error("En fazla 30 ürün ekleyebilirsin.");
          draft.items = draft.items.filter((i) => i.client_item_id !== editing.client_item_id).concat(R.clone(editing));
          delete draft.editing; editing = null; stage = "stores"; checkout = false; mutate();
          const next = draft.multiStore ? R.missingStores(draft)[0] : null;
          if (next) { beginProduct(next, true); message(`${next} için ürün bilgilerini tamamla.`, false); }
          else host.openView("cart");
        } catch (e) { message(e.message); }
      });
    }
    function addressForm(parent, address, onChange) {
      const inputs = {};
      const grid = el("div", undefined, "app-form-grid"); parent.append(grid);
      for (const [key, label] of [["customer_name", "Alıcı adı soyadı"], ["customer_phone", "Cep telefonu"]]) inputs[key] = field(grid, label, key, address[key] || profile?.[key === "customer_name" ? "full_name" : "phone"], key === "customer_phone" ? "tel" : "text", { max: 100 });
      inputs.district = field(grid, "İlçe", "district", address.district || "", "select", { values: [{ label: "İlçe seç", value: "" }, ...R.districts] });
      for (const [key, label] of [["neighborhood", "Mahalle"], ["address_line", "Cadde / sokak"], ["building_no", "Bina numarası"], ["building_name", "Bina adı, kat ve daire"], ["directions", "Adres tarifi"]]) inputs[key] = field(grid, label, key, address[key], "text", { max: 500 });
      for (const key of ["customer_name", "customer_phone"]) if (!address[key]) address[key] = inputs[key].value;
      const locationButton = button("", () => choosePoint(address, (p) => { Object.assign(address, p); label(); onChange(); }));
      function label() { locationButton.textContent = R.point(address.latitude, address.longitude) ? "Teslimat konumu seçildi · Değiştir" : "Teslimat konumu seç"; }
      for (const [key, input] of Object.entries(inputs)) input.addEventListener("input", () => {
        address[key] = input.value;
        if (["district", "neighborhood", "address_line", "building_no"].includes(key)) { delete address.latitude; delete address.longitude; label(); }
        onChange();
      });
      label(); parent.append(locationButton);
    }
    function cartPage() {
      formBase(cartPanel, checkout ? "Teslimat ve ödeme" : "Sepetim");
      if (!draft.items.length && !frozen) {
        cartPanel.append(el("p", "Sepetin boş.", "empty-state"), button("Ürün ekle", () => host.openView("shop"), "button primary-button")); return;
      }
      if (frozen) { pendingPage(); return; }
      if (checkout) { paymentPage(); return; }
      const list = el("div", undefined, "cart-items");
      draft.items.forEach((item) => {
        const row = el("article", undefined, "cart-item");
        const thumbnail = button("", () => item.image_data_base64 && showPhoto(item.image_data_base64), "photo-preview");
        if (item.image_data_base64) { const img = el("img"); img.src = `data:image/jpeg;base64,${item.image_data_base64}`; img.alt = `${item.product_name} fotoğrafını büyüt`; thumbnail.append(img); }
        else { thumbnail.append(icon("image")); thumbnail.disabled = true; }
        const detail = el("div", undefined, "cart-item-detail");
        detail.append(el("strong", item.store), el("span", item.product_name), el("small", `${item.size} · ${item.color} · ${item.branch}`), el("strong", money(item.estimated_price)));
        const commands = el("div", undefined, "item-commands");
        const remove = button("", () => {
          const view = modal("Ürünü sepetten kaldır?"); view.body.append(el("p", item.product_name));
          view.footer.append(button("Vazgeç", () => view.dialog.close()), button("Kaldır", () => { draft.items = draft.items.filter((i) => i.client_item_id !== item.client_item_id); mutate(); view.dialog.close(); cartPage(); }, "button danger-button"));
        }, "app-close"); remove.append(icon("close")); remove.title = "Ürünü kaldır"; remove.setAttribute("aria-label", "Ürünü kaldır");
        commands.append(button("Düzenle", () => { editing = R.clone(item); draft.editing = editing; stage = "product"; save(); host.openView("shop"); }, "text-button"), remove);
        row.append(thumbnail, detail, commands); list.append(row);
      });
      cartPanel.append(list, button("Başka ürün / mağaza ekle", () => { stage = "stores"; host.openView("shop"); }));
      cartPanel.append(el("h3", "Teslimat adresi"));
      if (addresses.length) {
        const select = field(cartPanel, "Kayıtlı adreslerim", "saved_address", draft.addressID || "", "select", { values: [{ label: "Farklı adres gir", value: "" }, ...addresses.map((a) => ({ value: a.id, label: a.title }))] });
        select.addEventListener("change", () => {
          const a = addresses.find((v) => v.id === select.value);
          draft.addressID = a?.id || null;
          draft.address = a ? { ...R.clone(a), customer_name: profile.full_name, customer_phone: profile.phone } : {};
          mutate(); cartPage();
        });
      }
      addressForm(cartPanel, draft.address, () => { draft.addressID = null; mutate(); });
      cartPanel.append(button("Ödemeye geç", () => {
        try { R.validate(draft, stores); checkout = true; save(); cartPage(); window.scrollTo(0, 0); }
        catch (e) { message(e.message); }
      }, "button primary-button"));
    }
    function paymentPage() {
      const delivery = el("fieldset", undefined, "app-options"); delivery.append(el("legend", "Teslimat seçeneği"));
      for (const express of [true, false]) {
        const label = el("label", undefined, "choice-row"); const input = el("input"); input.type = "radio"; input.name = "delivery"; input.checked = draft.express === express;
        input.addEventListener("change", () => { draft.express = express; mutate(); cartPage(); });
        const text = el("div"); text.append(el("strong", express ? "1–3 saatte teslim" : "Gün içinde teslim"), el("span", money(R.totals(draft.items, express, draft.promotion?.percent || 0).service)));
        label.append(input, text); delivery.append(label);
      }
      cartPanel.append(delivery);
      const payments = el("fieldset", undefined, "app-options"); payments.append(el("legend", "Ödeme yöntemi"));
      const bank = el("label", undefined, "choice-row"); const bankInput = el("input"); bankInput.type = "radio"; bankInput.name = "payment"; bankInput.checked = true;
      bank.append(bankInput, el("strong", "Havale / EFT"));
      const card = el("label", undefined, "choice-row is-disabled"); const cardInput = el("input"); cardInput.type = "radio"; cardInput.disabled = true;
      const cardText = el("div"); cardText.append(el("strong", "Banka / kredi kartı"), el("small", "Banka entegrasyonu tamamlanınca açılacak.")); card.append(cardInput, cardText); payments.append(bank, card);
      cartPanel.append(payments, el("p", "Havale / EFT için hesap bilgileri ve siparişe özel açıklama kodu sipariş oluşturulduktan sonra gösterilir. Ödeme onayı bankadan / yönetimden doğrulanır.", "muted"));
      const summary = el("dl", undefined, "price-summary");
      for (const [name, value] of [["Tahmini ürün bedeli", t().products], ["Hizmet ve teslimat (KDV dahil)", t().service], ["Promosyon indirimi", -t().discount], ["Toplam", t().total]]) {
        const row = el("div"); row.append(el("dt", name), el("dd", money(value))); summary.append(row);
      }
      cartPanel.append(summary);
      const promoForm = el("form", undefined, "promo-form");
      const code = field(promoForm, "Promosyon kodu", "promotion", draft.promotion?.code || "", "text", { required: false, max: 40 });
      const apply = el("button", draft.promotion ? "Kaldır" : "Uygula", "button compact-button"); apply.type = "submit"; promoForm.append(apply);
      promoForm.addEventListener("submit", async (e) => {
        e.preventDefault(); if (draft.promotion) { draft.promotion = null; mutate(); cartPage(); return; }
        apply.disabled = true; const version = epoch;
        try {
          const row = (await rpc("validate_promotion_code", { p_code: code.value.trim() }))?.[0];
          if (version !== epoch || busy || frozen) return;
          if (row?.authorized !== true || row.result !== "valid" || !Number.isFinite(row.discount_percent) || row.discount_percent < 0 || row.discount_percent > 100 || typeof row.normalized_code !== "string") throw Error("Promosyon kullanılamıyor.");
          draft.promotion = { code: row.normalized_code, percent: row.discount_percent }; mutate(); cartPage();
        } catch (e) { message(e.message || "Promosyon doğrulanamadı."); } finally { apply.disabled = false; }
      }); cartPanel.append(promoForm);
      cartPanel.append(button(accepted ? "Sipariş sözleşmeleri · Onaylandı" : "Sipariş sözleşmelerini oku ve onayla", async () => {
        const version = epoch;
        try {
          const docs = await R.documents(draft, legal, host.email(), stores);
          if (version !== epoch) return;
          const view = modal("Sipariş sözleşmeleri");
          for (const doc of docs.filter((d) => d.document_type !== "service_start")) {
            const section = el("details", undefined, "app-disclosure"); section.open = true;
            section.append(el("summary", doc.title), el("pre", doc.content, "legal-text")); view.body.append(section);
          }
          view.footer.append(button("Okudum ve kabul ediyorum", async () => {
            const current = await R.documents(draft, legal, host.email(), stores);
            if (version !== epoch || JSON.stringify(current) !== JSON.stringify(docs)) { view.dialog.close(); return message("Bilgiler değişti; sözleşmeleri yeniden onayla."); }
            accepted = docs; view.dialog.close(); cartPage();
          }, "button primary-button"));
        } catch (e) { message(e.message); }
      }));
      const serviceDoc = legal.order.find((d) => d.document_type === "service_start");
      const consent = el("label", undefined, "consent-row"); const checkbox = el("input"); checkbox.type = "checkbox"; checkbox.checked = serviceAccepted;
      checkbox.addEventListener("change", () => { serviceAccepted = checkbox.checked; });
      consent.append(checkbox, el("span", "Hizmetin cayma süresi dolmadan başlamasını açıkça talep ediyorum.")); cartPanel.append(consent);
      cartPanel.append(button("Hizmet başlangıcı onay metni", async () => {
        const docs = await R.documents(draft, legal, host.email(), stores); const view = modal(serviceDoc.title);
        view.body.append(el("pre", docs.find((d) => d.document_type === "service_start").content, "legal-text"));
      }, "text-button"));
      const submit = button("Sipariş oluştur · Ödeme yükümlülüğü doğurur", submitOrder, "button primary-button");
      submit.disabled = !allowed(); cartPanel.append(submit);
      if (!allowed()) cartPanel.append(el("p", "Şu anda yeni sipariş alınamıyor. Sepetindeki bilgiler korunuyor.", "status status-error"));
      cartPanel.append(button("Sepeti ve adresi düzenle", () => { checkout = false; save(); cartPage(); }, "text-button"));
    }
    async function ensureProfileLegal() {
      const version = epoch;
      profileAcks = await rpc("list_customer_legal_acknowledgements");
      if (version !== epoch) return false;
      const missing = legal.profile.filter((doc) => !profileAcks.some((a) => a.document_type === doc.p_document_type && a.document_version === doc.p_document_version && a.document_hash === doc.p_document_hash));
      if (!missing.length) return true;
      const view = modal("Hesap sözleşmeleri");
      view.body.append(el("p", "Sipariş öncesi güncel hesap metinlerini inceleyip her birini onayla."));
      for (const doc of missing) {
        const box = el("details", undefined, "app-disclosure"); box.append(el("summary", doc.title), el("pre", doc.p_document_text, "legal-text"));
        const consent = el("label", undefined, "consent-row"); const input = el("input"); input.type = "checkbox";
        consent.append(input, el("span", doc.p_document_type === "membership" ? "Okudum ve kabul ediyorum" : "Okudum, anladım")); box.append(consent); view.body.append(box);
        input.addEventListener("change", async () => {
          if (!input.checked) return; input.disabled = true; const version = epoch;
          try {
            const { title, ...payload } = doc;
            if (await rpc("record_customer_legal_acknowledgement", payload) !== true) throw Error();
            if (version !== epoch) return;
            consent.append(el("span", "Kaydedildi"));
          } catch { input.checked = false; input.disabled = false; message("Hesap onayı kaydedilemedi."); }
        });
      }
      view.footer.append(button("Tamam", () => view.dialog.close(), "button primary-button"));
      return false;
    }
    async function submitOrder() {
      if (busy || frozen) return;
      const version = epoch;
      busy = true;
      productPanel.inert = true; cartPanel.inert = true;
      try {
        if (!await host.checkRuntime() || !allowed()) throw Error("Yeni sipariş alımı şu anda kapalı.");
        if (!accepted || !serviceAccepted) throw Error("Sipariş sözleşmelerini ve hizmet başlangıcını onayla.");
        const snapshot = R.clone(draft);
        const docs = await R.documents(snapshot, legal, host.email(), stores);
        if (JSON.stringify(docs) !== JSON.stringify(accepted)) throw Error("Sipariş bilgileri değişti. Sözleşmeleri yeniden onayla.");
        if (!await ensureProfileLegal() || version !== epoch) return;
        if (JSON.stringify(snapshot) !== JSON.stringify(draft)) throw Error("Sipariş bilgileri değişti; yeniden kontrol edip onayla.");
        frozen = { payload: R.payload(snapshot, docs), expectedAmount: R.totals(snapshot.items, snapshot.express, snapshot.promotion?.percent || 0).total, result: null };
        if (!save()) { frozen = null; throw Error("Sepet bu sekmeye sığmadığı için sipariş gönderilmedi. Fotoğrafları azaltıp yeniden dene."); }
        cartPage(); await sendFrozen(version);
      } catch (e) { message(e.message || "Sipariş gönderilemedi."); }
      finally { busy = false; productPanel.inert = false; cartPanel.inert = false; }
    }
    function pendingPage() {
      if (frozen.result) {
        const row = frozen.result;
        cartPanel.append(el("h3", "Sipariş talebi alındı"));
        if (row.amountChanged) cartPanel.append(el("p", "Sunucu tutarı sepet tahmininden farklı. Para göndermeden önce Bize Ulaşın üzerinden kontrol iste.", "status status-error"));
        cartPanel.append(el("p", `Sunucunun doğruladığı tutar: ${money(row.amount)}`), el("p", "Ödeme henüz doğrulanmadı."));
        if (!row.amountChanged) {
          const bank = el("dl", undefined, "price-summary");
          for (const [name, value] of [["Alıcı", "Mağazadan AL Dijital Servisler Lojistik Anonim Şirketi"], ["IBAN", "TR78 0011 1000 0000 0168 3796 58"], ["Açıklama kodu", row.transfer_code]]) {
            const line = el("div"); line.append(el("dt", name), el("dd", value)); bank.append(line);
          } cartPanel.append(bank);
        }
        cartPanel.append(button("Siparişi takip et", () => host.showOrder(row.order_id), "button primary-button"), button("Yeni sepet", () => {
          draft = R.newDraft(); frozen = null; accepted = null; serviceAccepted = false; checkout = false; save(); updateCartCount(); cartPage();
        }));
      } else {
        cartPanel.append(el("p", "Sipariş talebinin sonucu bekleniyor. Tekrar kontrol aynı talep koduyla yapılır; yeni sipariş oluşturulmaz."));
        cartPanel.append(button("Aynı talebi kontrol et", async (e) => {
          if (busy) return; busy = true; e.currentTarget.disabled = true;
          try { await sendFrozen(epoch); } finally { busy = false; if (e.currentTarget) e.currentTarget.disabled = false; }
        }, "button primary-button"));
      }
    }
    async function sendFrozen(version) {
      try {
        if (!save()) throw Error("Sipariş talebi bu sekmede kaydedilemediği için gönderilmedi. Sayfayı kapatma; tarayıcı depolamasını kontrol et.");
        if (!await host.checkRuntime() || !allowed()) throw Error("Sipariş güvenlik kontrolü doğrulanamadı. Talep korunuyor.");
        const data = await rpc("create_customer_order_v7", frozen.payload);
        if (version !== epoch) return;
        frozen.result = R.result(data?.[0], frozen.expectedAmount); frozen.payload = null; draft.items = []; draft.address = {}; delete draft.editing; save(); updateCartCount(); cartPage(); host.refresh();
      } catch (e) { if (version === epoch) message(e.message || "Sonuç alınamadı. Aynı talebi kontrol et."); }
    }
    async function addressEditor(address = null) {
      const value = address ? R.clone(address) : { id: crypto.randomUUID(), city: "İstanbul" };
      const view = modal(address ? "Adresi düzenle" : "Yeni adres ekle");
      const form = el("form", undefined, "app-form"); form.noValidate = true;
      const title = field(form, "Adres başlığı", "title", value.title || "", "text", { max: 100 });
      addressForm(form, value, () => {});
      const invoiceLabel = el("label", undefined, "consent-row"); const invoice = el("input"); invoice.type = "checkbox"; invoice.checked = !!value.is_invoice;
      invoiceLabel.append(invoice, el("span", "Fatura adresim olsun")); form.append(invoiceLabel);
      const feedback = el("div"); feedback.setAttribute("role", "status"); view.body.append(form, feedback);
      const submit = button("Kaydet", async () => {
        value.title = title.value.trim(); submit.disabled = true; const version = epoch;
        try {
          if (!value.title) throw Error("Adres başlığı gir.");
          R.validateAddress(value);
          const body = { p_id: value.id, p_make_invoice: invoice.checked };
          for (const key of ["title", "city", "district", "neighborhood", "address_line", "building_no", "building_name", "directions", "latitude", "longitude"]) body[`p_${key}`] = value[key];
          if (await rpc("save_customer_address", body) !== true) throw Error("Adres kaydedilemedi.");
          if (version !== epoch) return;
          view.dialog.close(); await host.refresh();
        } catch (e) { status(feedback, e.message || "Adres kaydedilemedi.", true); } finally { submit.disabled = false; }
      }, "button primary-button"); view.footer.append(submit);
    }
    function renderAddresses() {
      const panel = document.getElementById("addresses-list"); panel.replaceChildren();
      panel.append(button("Yeni adres ekle", () => addressEditor(), "button primary-button"));
      if (!addresses.length) panel.append(el("p", "Kayıtlı adresin yok."));
      addresses.forEach((a) => {
        const row = el("article", undefined, "saved-address");
        row.append(el("strong", `${a.title}${a.is_invoice ? " · Fatura adresi" : ""}`), el("p", R.addressSummary(a)));
        const commands = el("div", undefined, "item-commands");
        commands.append(button("Düzenle", () => addressEditor(a), "text-button"));
        const remove = button("Sil", () => {
          const view = modal("Adresi sil?"); view.body.append(el("p", a.title));
          let replacement = null;
          if (a.is_invoice && addresses.length > 1) replacement = field(view.body, "Yeni fatura adresi", "replacement", "", "select", { values: [{ label: "Adres seç", value: "" }, ...addresses.filter((v) => v.id !== a.id).map((v) => ({ label: v.title, value: v.id }))] });
          view.footer.append(button("Vazgeç", () => view.dialog.close()), button("Sil", async (e) => {
            const target = e.currentTarget; target.disabled = true; const version = epoch;
            try {
              if (replacement && !replacement.value) throw Error("Yeni fatura adresini seç.");
              if (await rpc("delete_customer_address", { target_address_id: a.id, replacement_invoice_address_id: replacement?.value || null }) !== true) throw Error();
              if (version !== epoch) return;
              view.dialog.close(); await host.refresh();
            } catch { status(view.body, "Adres silinemedi. Fatura adresi seçimini kontrol et.", true); } finally { target.disabled = false; }
          }, "button danger-button"));
        }, "text-button text-danger"); commands.append(remove); row.append(commands); panel.append(row);
      });
    }
    async function init() {
      try {
        const [c, l] = await Promise.all([fetch("/assets/order-catalog.json", { credentials: "omit" }), fetch("/assets/legal-v6.json", { credentials: "omit" })]);
        if (!c.ok || !l.ok) throw Error();
        stores = (await c.json()).stores; legal = await l.json(); loaded = true; render();
      } catch { productPanel.replaceChildren(el("p", "Sipariş içeriği yüklenemedi. Sayfayı yeniden aç.", "status status-error")); }
    }
    function render() {
      if (!loaded) return;
      if (stage === "product" && editing) productPage(); else storePage();
      cartPage(); renderAddresses(); updateCartCount();
    }
    init();
    return {
      sync(data) {
        const changed = owner !== data.owner;
        if (changed) {
          epoch++; document.querySelectorAll(".app-dialog").forEach((n) => n.close());
          owner = data.owner; draft = R.newDraft(); frozen = null; accepted = null; serviceAccepted = false; stage = "stores"; editing = null; checkout = false;
          if (owner) try {
            const stored = JSON.parse(sessionStorage.getItem(key()));
            if (stored?.owner === owner && (stored.frozen || Date.now() - stored.updated < 86400000) && stored.draft?.items?.length <= 30 && JSON.stringify(stored).length < 15000000) {
              draft = stored.draft; frozen = stored.frozen; checkout = stored.checkout; stage = stored.stage; editing = draft.editing || null;
            }
          } catch { /* Invalid drafts are not submitted. */ }
        }
        profile = data.profile; addresses = data.addresses || []; runtime = data.runtime;
        if (changed) render(); else renderAddresses();
      },
      show(view) { if (!loaded) return; if (view === "shop") { if (stage === "product" && editing) productPage(); else storePage(); } if (view === "cart") cartPage(); },
      clear() {
        if (owner) try { sessionStorage.removeItem(key()); } catch { /* Memory-only browser. */ }
        this.sync({ owner: null, profile: null, addresses: [], runtime: null });
      },
      photo: showPhoto,
      map: choosePoint,
      showDocuments(rows) {
        const view = modal("Sipariş sözleşmeleri");
        if (!rows?.length) view.body.append(el("p", "Bu sipariş için belge bulunamadı."));
        for (const row of rows || []) {
          const section = el("details", undefined, "app-disclosure");
          section.append(el("summary", `${row.document_type} · ${row.document_version}`), el("pre", row.document_text, "legal-text")); view.body.append(section);
        }
      },
      async editProfile() {
        const version = epoch;
        try {
          const [billings, photos] = await Promise.all([
            host.api(`/rest/v1/customer_billing_profiles?select=identity_number,invoice_type,company_name,tax_office,tax_number,billing_address,postal_code&user_id=eq.${owner}`),
            host.api(`/rest/v1/customer_profile_photos?select=photo_base64&user_id=eq.${owner}`)
          ]);
          if (version !== epoch) return;
          const billing = billings?.[0] || {};
          const view = modal("Profil ve fatura bilgileri");
          const form = el("form", undefined, "app-form"); form.noValidate = true;
          const name = field(form, "Ad soyad", "profile_full_name", profile.full_name, "text", { max: 100 });
          const phone = field(form, "Cep telefonu", "profile_phone", profile.phone, "tel", { max: 25 });
          const fields = {};
          fields.invoice_type = field(form, "Fatura türü", "invoice_type", billing.invoice_type || "individual", "select", { values: [{ value: "individual", label: "Bireysel" }, { value: "corporate", label: "Kurumsal" }] });
          for (const [key, label, max] of [["identity_number", "T.C. kimlik numarası", 11], ["company_name", "Şirket unvanı", 200], ["tax_office", "Vergi dairesi", 100], ["tax_number", "Vergi numarası", 11], ["billing_address", "Fatura adresi", 500], ["postal_code", "Posta kodu", 10]]) fields[key] = field(form, label, key, billing[key], "text", { required: false, max });
          const feedback = el("div"); view.body.append(form, feedback);
          const saveButton = button("Kaydet", async () => {
            saveButton.disabled = true;
            try {
              if (version !== epoch) return;
              if (!name.value.trim() || !R.phone(phone.value)) throw Error("Ad soyad ve telefonunu kontrol et.");
              const body = { p_full_name: name.value.trim(), p_phone: R.phone(phone.value), p_photo_base64: photos?.[0]?.photo_base64 || "" };
              for (const [key, input] of Object.entries(fields)) body[`p_${key}`] = input.value.trim();
              const result = await rpc("update_customer_profile_secure", body);
              if (version !== epoch) return;
              if (![true, "success", "updated"].includes(result)) throw Error("Bilgiler kaydedilemedi. Fatura ve kimlik bilgilerini kontrol et.");
              view.dialog.close(); await host.refresh();
            } catch (e) { status(feedback, e.message || "Bilgiler kaydedilemedi.", true); } finally { saveButton.disabled = false; }
          }, "button primary-button"); view.footer.append(saveButton);
        } catch { host.error("Profil bilgileri alınamadı. Biraz sonra tekrar dene."); }
      }
    };
  };
})();

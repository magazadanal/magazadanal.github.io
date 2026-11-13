(() => {
  "use strict";

  const SUPABASE_URL = "https://zxqqbzggfbxoasyhueqb.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_";
  const SESSION_KEY = "magazadanal.web.session.v1";
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Restricted browser storage must not prevent a memory-only session.
  }
  const ACTIVE_ORDER_STATUSES = new Set([
    "draft",
    "payment_waiting",
    "payment_received",
    "courier_assigned",
    "shopping",
    "on_the_way"
  ]);
  const ORDER_STEPS = [
    "Talep alındı",
    "Kurye mağazaya doğru yola çıktı",
    "Ürün alındı, kurye size doğru yolda",
    "Teslim edildi"
  ];
  const STATUS_LABELS = new Map([
    ["draft", "Talep alındı"],
    ["payment_waiting", "Talep alındı"],
    ["payment_received", "Talep alındı"],
    ["courier_assigned", "Talep alındı"],
    ["shopping", "Kurye mağazaya doğru yola çıktı"],
    ["on_the_way", "Ürün alındı, kurye size doğru yolda"],
    ["delivered", "Teslim edildi"],
    ["cancelled", "İptal edildi"]
  ]);
  const ACTIVITY_LABELS = new Map([
    ["alternative_requested", "Alternatif ürün onayı istendi"],
    ["extra_payment_requested", "Ek ödeme talebi oluşturuldu"],
    ["alternative_approved", "Alternatif ürün onaylandı"],
    ["alternative_rejected", "Alternatif ürün reddedildi"],
    ["extra_payment_reported", "Ek ödeme bildirildi"],
    ["extra_payment_confirmed", "Ek ödeme onaylandı"],
    ["store_departure_started", "Kurye mağazaya doğru yola çıktı"],
    ["admin_support_requested", "Kurye yönetici desteği istedi"]
  ]);

  const state = {
    session: null,
    profile: null,
    addresses: [],
    orders: [],
    historyOrders: [],
    historyCursor: null,
    historyHasMore: false,
    historyLoading: false,
    activities: [],
    supportTickets: [],
    refreshTimer: null,
    runtimeStatusTimer: null,
    runtimeCheckInFlight: false,
    webAccountEnabled: false,
    runtime: null,
    generation: 0,
    refreshInFlight: null,
    authBusy: false,
    loadInFlight: false,
    collapsedActiveOrders: new Set(),
    openLocationMaps: new Set(),
    maintenanceMessage: "Müşteri web hesabı güvenlik kontrolü nedeniyle geçici olarak kapalı."
  };

  const elements = {
    authView: document.getElementById("auth-view"),
    portalView: document.getElementById("portal-view"),
    loginForm: document.getElementById("login-form"),
    email: document.getElementById("login-email"),
    password: document.getElementById("login-password"),
    showPassword: document.getElementById("show-login-password"),
    loginButton: document.getElementById("login-button"),
    forgotPasswordButton: document.getElementById("forgot-password-button"),
    authStatus: document.getElementById("auth-status"),
    portalStatus: document.getElementById("portal-status"),
    loading: document.getElementById("portal-loading"),
    logoutButton: document.getElementById("logout-button"),
    ordersList: document.getElementById("orders-list"),
    historyList: document.getElementById("history-list"),
    historyMore: document.getElementById("history-more"),
    historyStatus: document.getElementById("history-status"),
    addressesList: document.getElementById("addresses-list"),
    supportForm: document.getElementById("support-form"),
    supportOrder: document.getElementById("support-order"),
    supportMessage: document.getElementById("support-message"),
    supportCharacterCount: document.getElementById("support-character-count"),
    supportSubmit: document.getElementById("support-submit"),
    supportList: document.getElementById("support-list"),
    profileName: document.getElementById("profile-name"),
    profileSurname: document.getElementById("profile-surname"),
    profileEmail: document.getElementById("profile-email"),
    profilePhone: document.getElementById("profile-phone"),
    profilePasswordReset: document.getElementById("profile-password-reset")
  };
  const locationControllers = new Map();

  class APIError extends Error {
    constructor(status) {
      super(`Request failed: ${status}`);
      this.status = status;
    }
  }

  class ProfileError extends Error {}

  async function api(path, options = {}) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new APIError(400);
    const owner = state.session?.user?.id;
    const generation = state.generation;
    if (owner && !Object.prototype.hasOwnProperty.call(options, "token") && state.session.expiresAt < Date.now() + 30000) await refreshSession();
    if (/^\/rest\/v1\/rpc\/(?:create_|save_|delete_|update_|record_|set_customer_|customer_respond)/.test(path) && (!state.webAccountEnabled || !state.runtime)) throw new APIError(503);
    const headers = {
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const token = Object.prototype.hasOwnProperty.call(options, "token")
      ? options.token
      : state.session?.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response, data;
    try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: controller.signal
    });
    data = await response.json().catch(() => null);
    } finally { clearTimeout(timeout); }
    if (!Object.prototype.hasOwnProperty.call(options, "token") && owner && (generation !== state.generation || owner !== state.session?.user?.id)) throw new APIError(409);
    if (!response.ok) throw new APIError(response.status);
    return data;
  }

  function sessionFromResponse(data) {
    if (!data?.access_token || !data?.refresh_token || !data?.user?.id) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
      user: {
        id: data.user.id,
        email: data.user.email || ""
      }
    };
  }

  function saveSession(session) {
    if (!session || state.session?.user?.id !== session.user?.id) try {
      sessionStorage.removeItem("magazadanal.password-recovery");
    } catch { /* Recovery credentials from older clients must not survive account changes. */ }
    if (!session && state.session?.user?.id) try {
      sessionStorage.removeItem(`magazadanal.web.view.v1.${state.session.user.id}`);
      sessionStorage.removeItem(`magazadanal.web.support.v1.${state.session.user.id}`);
    } catch { /* No persisted form state. */ }
    if (state.session?.user?.id !== session?.user?.id) state.generation++;
    state.session = session;
    if (session) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        // The current page can continue with the in-memory session.
      }
      scheduleRefresh();
    } else {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // There may be no persisted session to clear.
      }
      if (state.refreshTimer) window.clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function readStoredSession() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!parsed?.refreshToken || !parsed?.user?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function scheduleRefresh() {
    if (state.refreshTimer) window.clearTimeout(state.refreshTimer);
    const delay = Math.max(15000, (state.session?.expiresAt || Date.now()) - Date.now() - 120000);
    state.refreshTimer = window.setTimeout(() => {
      refreshSession().catch((error) => {
        if ([400, 401, 403].includes(error.status)) handleExpiredSession();
        else state.refreshTimer = window.setTimeout(() => scheduleRefresh(), 15000);
      });
    }, delay);
  }

  async function refreshSession() {
    if (state.refreshInFlight) return state.refreshInFlight;
    const current = state.session || readStoredSession();
    if (!current?.refreshToken) throw new APIError(401);
    const generation = state.generation;
    const operation = (async () => {
    const data = await api("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: current.refreshToken },
      token: null
    });
    const session = sessionFromResponse(data);
    if (!session || session.user.id !== current.user.id) throw new APIError(401);
    if (generation !== state.generation) throw new APIError(409);
    saveSession(session);
    return session;
    })();
    state.refreshInFlight = operation;
    try { return await operation; } finally { if (state.refreshInFlight === operation) state.refreshInFlight = null; }
  }

  function showStatus(target, message, kind = "info") {
    target.textContent = message;
    target.className = `status status-${kind}`;
    target.hidden = false;
  }

  function hideStatus(target) {
    target.hidden = true;
    target.textContent = "";
  }

  function setAuthBusy(busy) {
    state.authBusy = busy;
    elements.email.disabled = busy;
    elements.password.disabled = busy || !state.webAccountEnabled;
    elements.showPassword.disabled = busy || !state.webAccountEnabled;
    elements.loginButton.disabled = busy || !state.webAccountEnabled;
    elements.forgotPasswordButton.disabled = busy;
    elements.loginButton.textContent = busy ? "Kontrol ediliyor..." : "Giriş yap";
  }

  async function fetchRuntimeStatus() {
    const rows = await api("/rest/v1/rpc/get_public_runtime_status", {
      method: "POST",
      body: {},
      token: null
    });
    const status = Array.isArray(rows) ? rows[0] : null;
    if (!status) throw new APIError(503);
    state.webAccountEnabled = status.customer_web_account_enabled !== false;
    state.runtime = status;
    syncOrderFlow();
    state.maintenanceMessage = status.maintenance_message || state.maintenanceMessage;
    setAuthBusy(state.authBusy);
    return state.webAccountEnabled;
  }

  function showWebMaintenance() {
    saveSession(null);
    clearPortalData();
    setPortalVisible(false);
    showStatus(elements.authStatus, state.maintenanceMessage, "error");
  }

  async function enforceRuntimeStatus() {
    if (state.runtimeCheckInFlight) return state.webAccountEnabled;
    state.runtimeCheckInFlight = true;
    try {
      if (!await fetchRuntimeStatus()) {
        showWebMaintenance();
        return false;
      }
      return true;
    } catch {
      state.webAccountEnabled = false;
      state.runtime = null;
      syncOrderFlow();
      state.maintenanceMessage = "Müşteri web hesabının güvenlik durumu doğrulanamadı. Lütfen biraz sonra tekrar deneyin.";
      setAuthBusy(false);
      showStatus(state.session ? elements.portalStatus : elements.authStatus, state.maintenanceMessage, "error");
      return false;
    } finally {
      state.runtimeCheckInFlight = false;
    }
  }

  function startRuntimeStatusMonitor() {
    if (state.runtimeStatusTimer) window.clearInterval(state.runtimeStatusTimer);
    state.runtimeStatusTimer = window.setInterval(() => {
      void enforceRuntimeStatus();
    }, 30_000);
  }

  function setPortalVisible(isVisible) {
    document.documentElement.dataset.sessionState = isVisible ? "signed-in" : "signed-out";
    elements.authView.hidden = isVisible;
    elements.portalView.hidden = !isVisible;
    if (!isVisible) orderFlow?.show("auth");
    if (!isVisible) document.querySelectorAll("#account-sidebar [data-view]").forEach(button => {
      button.classList.remove("is-active"); button.setAttribute("aria-current", "false");
    });
  }

  function clearPortalData() {
    const previousOwner = state.profile?.id;
    if (previousOwner) try {
      sessionStorage.removeItem(`magazadanal.web.view.v1.${previousOwner}`);
      sessionStorage.removeItem(`magazadanal.web.support.v1.${previousOwner}`);
    } catch { /* No persisted form in restricted browsers. */ }
    orderFlow?.clear();
    state.profile = null;
    state.addresses = [];
    state.orders = [];
    state.historyOrders = []; state.historyCursor = null;
    state.historyHasMore = false; state.historyLoading = false;
    elements.historyMore.hidden = true; elements.historyMore.disabled = false;
    hideStatus(elements.historyStatus);
    state.collapsedActiveOrders.clear();
    state.openLocationMaps.clear();
    locationControllers.forEach(controller => controller.destroy());
    locationControllers.clear();
    state.activities = [];
    state.supportTickets = [];
    elements.ordersList.replaceChildren();
    delete elements.ordersList.dataset.signature;
    elements.historyList.replaceChildren();
    delete elements.historyList.dataset.signature;
    elements.addressesList.replaceChildren();
    elements.supportList.replaceChildren();
    elements.profileName.textContent = "-";
    elements.profileSurname.textContent = "-";
    elements.profileEmail.textContent = "-";
    elements.profilePhone.textContent = "-";
    elements.supportMessage.value = "";
    elements.supportMessage.readOnly = false;
    elements.supportOrder.value = "";
    elements.supportOrder.disabled = false;
    delete elements.supportForm.dataset.orderID;
    delete elements.supportForm.dataset.requestID;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return "Tarih belirtilmedi";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Tarih belirtilmedi";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function orderCode(order) {
    const value = String(order.order_no || "");
    return value.includes("-") ? value.split("-").pop() : value;
  }

  function activityText(activity) {
    if (activity.action === "status_changed") {
      return STATUS_LABELS.get(activity.to_status) || "Sipariş durumu güncellendi";
    }
    if (activity.action === "alternative_requested" && activity.message) {
      return `Alternatif ürün: ${activity.message}`;
    }
    if (activity.action === "extra_payment_requested" && activity.amount) {
      return `Ek ödeme talebi: ${formatMoney(activity.amount)}`;
    }
    return ACTIVITY_LABELS.get(activity.action) || "Sipariş hareketi";
  }

  function renderEmpty(container, title, text) {
    container.replaceChildren();
    const empty = element("div", "empty-state");
    empty.append(element("strong", "", title), element("p", "", text));
    container.append(empty);
  }

  function renderTimeline(order = null) {
    const timeline = element("ol", "order-timeline");
    if (order?.status === "cancelled") {
      const cancelled = element("li", "is-current is-cancelled", "Sipariş iptal edildi");
      timeline.append(cancelled);
      return timeline;
    }

    const orderActivities = state.activities.filter((item) => item.order_id === order?.id);
    const courierStarted = order?.status === "shopping"
      || order?.status === "on_the_way"
      || order?.status === "delivered"
      || orderActivities.some((item) => item.action === "store_departure_started" && item.current_assignment === true);
    const currentIndex = !order ? -1 : order.status === "delivered"
      ? 3
      : order.status === "on_the_way"
        ? 2
        : courierStarted
          ? 1
          : 0;
    ORDER_STEPS.forEach((label, index) => {
      const item = element("li", index <= currentIndex ? "is-complete" : "", label);
      timeline.append(item);
    });
    return timeline;
  }

  function customerStatusText(order) {
    if (["cancelled", "delivered", "on_the_way", "shopping"].includes(order.status)) {
      return STATUS_LABELS.get(order.status);
    }
    const courierStarted = state.activities.some((item) => item.order_id === order.id && item.action === "store_departure_started" && item.current_assignment === true);
    return courierStarted ? "Kurye mağazaya doğru yola çıktı" : "Talep alındı";
  }

  function renderCourierLocation(card, order) {
    const section = element("section", "courier-location");
    section.setAttribute("aria-label", "Kurye konumu");
    const timestamp = element("p", "muted", "Güncel kurye konumu bekleniyor.");
    const coordinates = element("p", "courier-coordinates"); coordinates.hidden = true;
    const privacy = element("p", "muted", "Haritayı açtığında OpenStreetMap’e IP adresin ve görüntülenen alan iletilir.");
    const mapButton = element("button", "button compact-button", "Kurye haritasını aç"); mapButton.type = "button";
    const mapBox = element("div", "app-map"); mapBox.hidden = true; mapBox.setAttribute("aria-label", "Güncel kurye haritası");
    const mapStatus = element("p", "muted"); mapStatus.setAttribute("role", "status");
    section.append(element("h3", "", "Kurye konumu"), timestamp, coordinates, privacy, mapButton, mapBox, mapStatus);
    const version = state.generation;
    let map = null, marker = null, position = null, snapshot = null, inFlight = false, destroyed = false;
    function clearLocation(message) {
      timestamp.textContent = message; coordinates.textContent = ""; coordinates.hidden = true;
      position = null; snapshot = null;
      if (marker) { marker.remove(); marker = null; }
    }
    function openMap() {
      try {
        if (!window.L?.map) throw Error();
        mapBox.hidden = false;
        const fresh = position && MAOrderRules.freshPosition(snapshot);
        if (!map) {
          map = L.map(mapBox).setView(fresh ? position : [41.072, 28.99], fresh ? 15 : 11);
          const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, referrerPolicy: "strict-origin", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);
          tiles.on("tileerror", () => { mapStatus.textContent = "Harita görüntüsü alınamıyor. İnternet bağlantını kontrol et; konum bilgisi ayrıca güncellenir."; });
          tiles.on("load", () => { if (mapBox.querySelector(".leaflet-tile-loaded")) mapStatus.textContent = ""; });
        }
        if (fresh) {
          if (!marker) { marker = L.circleMarker(position, { radius: 9, color: "#13675b", fillOpacity: 1 }).addTo(map); map.setView(position, 15); }
          else { marker.setLatLng(position); if (!map.getBounds().contains(position)) map.panTo(position); }
        }
        requestAnimationFrame(() => { if (!destroyed && map) map.invalidateSize(); });
        mapButton.hidden = true;
      } catch { mapStatus.textContent = "Harita bileşeni açılamadı. Sayfayı yeniden açabilirsin."; mapButton.hidden = false; }
    }
    mapButton.addEventListener("click", () => {
      if (!MAOrderRules.freshPosition(snapshot)) clearLocation("Güncel kurye konumu bekleniyor.");
      state.openLocationMaps.add(order.id); openMap(); void update();
    });
    async function update() {
      if (destroyed || inFlight || !card.isConnected || !card.open || document.hidden || card.closest("[data-panel]")?.hidden || version !== state.generation) return;
      if (!MAOrderRules.freshPosition(snapshot)) clearLocation("Güncel kurye konumu bekleniyor.");
      inFlight = true;
      try {
        const rows = await api("/rest/v1/rpc/get_order_courier_position", { method: "POST", body: { target_order_id: order.id } });
        if (destroyed || version !== state.generation || !card.isConnected || !state.orders.some(value => value.id === order.id && ACTIVE_ORDER_STATUSES.has(value.status))) return;
        const point = rows?.[0];
        if (MAOrderRules.freshPosition(point)) {
          snapshot = point; position = [point.latitude, point.longitude];
          timestamp.textContent = "Kurye konumu güncel.";
          coordinates.textContent = `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`; coordinates.hidden = false;
          mapButton.disabled = false;
          if (marker) marker.setLatLng(position);
          if (state.openLocationMaps.has(order.id)) openMap();
        } else {
          const moving = ["shopping", "on_the_way"].includes(order.status) || state.activities.some(event => event.order_id === order.id && event.action === "store_departure_started" && event.current_assignment === true);
          clearLocation(moving ? "Güncel kurye konumu bekleniyor." : "Kurye mağazaya doğru yola çıktığında konumu burada görünecek.");
        }
      } catch { if (!destroyed && version === state.generation) clearLocation("Konum şu anda alınamıyor."); }
      finally { inFlight = false; }
    }
    const timer = setInterval(() => {
      if (!card.isConnected || version !== state.generation) controller.destroy(); else void update();
    }, 2000);
    const onToggle = () => { if (card.open) void update(); };
    card.addEventListener("toggle", onToggle);
    const controller = {
      update,
      destroy() { destroyed = true; clearInterval(timer); card.removeEventListener("toggle", onToggle); if (map) { map.remove(); map = null; } locationControllers.delete(card); }
    };
    locationControllers.set(card, controller);
    return section;
  }

  function renderOrderCard(order) {
    const card = element("details", `order-card status-${order.status}`);
    const summary = element("summary");
    const heading = element("div", "order-card-heading");
    const titleGroup = element("div");
    titleGroup.append(
      element("strong", "order-number", `Sipariş ${orderCode(order)}`),
      element("span", "order-date", formatDate(order.created_at))
    );
    const status = element("span", "order-status", customerStatusText(order) || "Güncelleniyor");
    heading.append(titleGroup, status);
    summary.append(heading);

    const meta = element("div", "order-meta");
    meta.append(
      element("span", "", `${Number(order.selected_store_count) || 1} mağaza`),
      element("strong", "", formatMoney(order.customer_total))
    );
    summary.append(meta); card.append(summary);

    card.append(renderTimeline(order));
    if (ACTIVE_ORDER_STATUSES.has(order.status)) card.append(renderCourierLocation(card, order));
    const products = element("div"); card.append(products);
    for (const product of order.order_items || []) {
      const row = element("div", "order-item-compact");
      const detail = element("div"); detail.append(element("strong", "", product.store_name), element("p", "", product.product_name), element("p", "", `${product.size || ""} · ${product.color || ""} · ${formatMoney(product.final_price ?? product.estimated_price)}`));
      if (product.store_branch) detail.append(element("p", "muted", `Şube ${product.store_branch}`));
      if (product.order_note) detail.append(element("p", "muted", product.order_note));
      row.append(detail); products.append(row);
    }
    if (!ACTIVE_ORDER_STATUSES.has(order.status) && order.delivery_address_snapshot && typeof order.delivery_address_snapshot === "object") {
      const address = order.delivery_address_snapshot;
      card.append(element("p", "", `Teslimat adresi: ${MAOrderRules.addressSummary(address)}`));
      if (address.customer_name) card.append(element("p", "", `Alıcı: ${address.customer_name}`));
      if (address.customer_phone) card.append(element("p", "", `Telefon: ${address.customer_phone}`));
      card.append(element("p", "", `Ödeme yöntemi: ${{bank_transfer: "Havale / EFT", card: "Banka / kredi kartı"}[order.payment_method] || "Belirtilmedi"}`));
    }
    const contact = element("button", "button compact-button", "Bize Ulaşın"); contact.type = "button";
    contact.addEventListener("click", () => {
      openView("support");
      if (elements.supportForm.dataset.requestID) return;
      elements.supportOrder.value = order.id; persistSupport();
    }); card.append(contact);
    const extras = element("div"); card.append(extras);
    const documentButton = element("button", "text-button", "Sipariş sözleşmeleri"); documentButton.type = "button";
    documentButton.addEventListener("click", async () => {
      documentButton.disabled = true;
      try {
        const rows = await api("/rest/v1/rpc/get_customer_order_legal_documents", { method: "POST", body: { target_order_id: order.id } });
        orderFlow.showDocuments(rows);
      } catch { showStatus(elements.portalStatus, "Sözleşmeler şu anda alınamıyor.", "error"); }
      finally { documentButton.disabled = false; }
    }); card.append(documentButton);
    if (ACTIVE_ORDER_STATUSES.has(order.status)) {
      const events = state.activities.filter((a) => a.order_id === order.id);
      const requests = ["alternative_requested", "extra_payment_requested"].map(action => MAOrderRules.currentOrderRequest(events, order.id, action)).filter(Boolean);
      for (const request of requests) {
        const box = element("div", "app-disclosure"); box.append(element("p", "", activityText(request)));
        if (request.action === "extra_payment_requested") {
          const owner = state.session?.user?.id, generation = state.generation;
          const selection = element("label", "choice-row"), selected = element("input"); selected.type = "radio"; selected.name = `extra-payment-${request.id}`;
          selection.append(selected, element("strong", "", "Havale / EFT")); box.append(selection);
          const bank = element("div"), feedback = element("p", "status"); feedback.setAttribute("role", "status"); feedback.hidden = true;
          const command = element("button", "button compact-button", "Havale Yaptım, Bildir"); command.type = "button"; command.disabled = true;
          box.append(bank, feedback, command); let verified = null;
          const current = () => box.isConnected && generation === state.generation && owner === state.session?.user?.id;
          async function loadDetails() {
            const rows = await api(`/rest/v1/payments?select=id,order_id,purpose,direction,method,status,amount,transfer_code,created_at&order_id=eq.${order.id}&purpose=eq.adjustment&direction=eq.charge&method=eq.bank_transfer&status=eq.pending&order=created_at.desc,id.desc&limit=2`);
            const latest = await api("/rest/v1/rpc/list_order_activity", {method: "POST", body: {target_order_ids: [order.id]}});
            return MAOrderRules.extraPaymentDetails(rows, order.id, request, latest);
          }
          selected.addEventListener("change", async () => {
            command.disabled = true; verified = null; bank.replaceChildren(); showStatus(feedback, "Ek ödeme bilgileri alınıyor…");
            try {
              const details = await loadDetails(); if (!current() || !selected.checked) return;
              verified = details; orderFlow.bankDetails(bank, details.code);
              bank.append(element("p", "", `Ödeme tutarı: ${formatMoney(details.amount)}`)); hideStatus(feedback); command.disabled = false;
            } catch { if (current()) { selected.checked = false; showStatus(feedback, "Ek ödeme bilgileri doğrulanamadı. Tekrar Havale / EFT seçerek deneyebilirsin.", "error"); } }
          });
          command.addEventListener("click", async () => {
            if (!verified || !selected.checked || !current()) return;
            const reviewed = verified; command.disabled = true; selected.disabled = true;
            try {
              const fresh = await loadDetails();
              if (!current()) return;
              if (fresh.paymentID !== reviewed.paymentID || fresh.code !== reviewed.code || fresh.amount !== reviewed.amount) throw Error();
              const result = await api("/rest/v1/rpc/customer_respond_to_order_request", {method: "POST", body: {target_order_id: order.id, target_request_id: request.id, response_name: "extra_payment_reported"}});
              if (!["success", "already_responded", true].includes(result)) throw Error();
              if (current()) await loadPortal({quiet: true});
            } catch { if (current()) { verified = null; selected.checked = false; bank.replaceChildren(); showStatus(feedback, "Ek ödeme bildirimi doğrulanamadı. Güncel bilgileri yeniden kontrol et.", "error"); } }
            finally { selected.disabled = false; command.disabled = !verified || !selected.checked; }
          });
          card.append(box); continue;
        }
        const owner = state.session?.user?.id, generation = state.generation;
        const current = () => box.isConnected && owner === state.session?.user?.id && generation === state.generation;
        let responding = false;
        const choices = [["Onayla", "alternative_approved"], ["Reddet", "alternative_rejected"]];
        for (const [label, response] of choices) {
          const command = element("button", "button compact-button", label); command.type = "button";
          command.addEventListener("click", async () => {
            if (!current() || responding) return;
            responding = true;
            box.querySelectorAll("button").forEach((n) => { n.disabled = true; });
            try {
              const result = await api("/rest/v1/rpc/customer_respond_to_order_request", { method: "POST", body: { target_order_id: order.id, target_request_id: request.id, response_name: response } });
              if (!["success", "already_responded", true].includes(result)) throw Error();
              if (current()) await loadPortal({ quiet: true });
            } catch { if (current()) showStatus(elements.portalStatus, "Yanıt doğrulanamadı. Sipariş durumu otomatik olarak yeniden kontrol edilecek.", "error"); }
            finally { responding = false; if (current()) box.querySelectorAll("button").forEach((n) => { n.disabled = false; }); }
          }); box.append(command);
        } card.append(box);
      }
    }
    let detailsLoading = false, photosLoaded = false, codeLoaded = !ACTIVE_ORDER_STATUSES.has(order.status);
    const detailStatus = element("p", "muted"); detailStatus.hidden = true; extras.append(detailStatus);
    card.addEventListener("toggle", async () => {
      if (!card.open || detailsLoading || (photosLoaded && codeLoaded)) return;
      const version = state.generation;
      const current = () => version === state.generation && card.isConnected;
      detailsLoading = true; detailStatus.hidden = true;
      // A slow or failed photo request must not hold up the delivery code.
      const photosTask = (async () => {
      try {
        const ids = [...new Set((order.order_items || []).map((i) => i.id).filter((id) => MAOrderRules.UUID.test(id)))];
        if (!photosLoaded) {
          for (let i = 0; i < ids.length; i += 3) {
            const batch = ids.slice(i, i + 3);
            const photos = await api("/rest/v1/rpc/get_order_product_photos", { method: "POST", body: { target_item_ids: batch } });
            if (!current()) return;
            if (!Array.isArray(photos)) throw Error();
            for (const photo of photos) {
              if (!photo || !batch.includes(photo.order_item_id) || !/^\/9j\/[A-Za-z0-9+/=]+$/.test(photo.photo_base64 || "") || photo.photo_base64.length > 1048576) continue;
              const index = (order.order_items || []).findIndex((p) => p.id === photo.order_item_id);
              const row = products.children[index];
              if (!row) continue;
              const thumb = element("button", "photo-preview"); thumb.type = "button"; thumb.title = "Ürün fotoğrafını büyüt"; thumb.setAttribute("aria-label", `${order.order_items[index].store_name || "Ürün"} fotoğrafını büyüt`);
              const img = element("img"); img.src = `data:image/jpeg;base64,${photo.photo_base64}`; img.alt = "Ürün fotoğrafı"; thumb.append(img); thumb.addEventListener("click", () => { if (current()) orderFlow.photo(photo.photo_base64); });
              const previous = row.querySelector(".photo-preview");
              if (previous) previous.replaceWith(thumb); else row.prepend(thumb);
            }
          }
          photosLoaded = true;
        }
      } catch { if (current()) { detailStatus.textContent = "Fotoğraflar şu anda alınamıyor. Kartı kapatıp yeniden açabilirsin."; detailStatus.hidden = false; } }
      })();
      const codeTask = (async () => {
      try {
        if (current() && !codeLoaded) {
          const code = await api("/rest/v1/rpc/get_order_delivery_code", { method: "POST", body: { target_order_id: order.id } });
          if (!current()) return;
          const value = code?.[0]?.delivery_code || code?.[0]?.code;
          if (!/^\d{4}$/.test(value)) throw Error();
          extras.append(element("p", "", "Teslim kodu"), element("strong", "delivery-code", value)); codeLoaded = true;
        }
      } catch { if (current()) { detailStatus.textContent = "Teslim kodu şu anda alınamıyor. Kartı kapatıp yeniden açabilirsin."; detailStatus.hidden = false; } }
      })();
      try { await Promise.all([photosTask, codeTask]); } finally { detailsLoading = false; }
    });
    const activities = state.activities
      .filter((item) => item.order_id === order.id)
      .filter((item) => !(item.action === "status_changed" && item.to_status === "courier_assigned"))
      .slice(-6)
      .reverse();
    if (activities.length) {
      const activityList = element("div", "activity-list");
      activities.forEach((activity) => {
        const row = element("div", "activity-row");
        row.append(
          element("span", "", activityText(activity)),
          element("time", "", formatDate(activity.created_at))
        );
        activityList.append(row);
      });
      card.append(activityList);
    }
    return card;
  }

  function renderOrderList(container, orders, active) {
    const ids = new Set(orders.map(order => order.id));
    const signature = JSON.stringify([orders, state.activities.filter(event => ids.has(event.order_id))]);
    if (container.dataset.signature === signature) return;
    const openOrders = new Set([...container.querySelectorAll("details[open]")].map(node => node.dataset.orderId));
    container.querySelectorAll("details[data-order-id]").forEach(card => locationControllers.get(card)?.destroy());
    container.dataset.signature = signature;
    if (orders.length) {
      container.replaceChildren(...orders.map(order => {
        const card = renderOrderCard(order); card.dataset.orderId = order.id;
        card.open = active ? !state.collapsedActiveOrders.has(order.id) : openOrders.has(order.id);
        if (active) card.addEventListener("toggle", () => {
          if (!card.isConnected) return;
          if (card.open) state.collapsedActiveOrders.delete(order.id); else state.collapsedActiveOrders.add(order.id);
        });
        return card;
      }));
    } else {
      if (active) {
        const empty = element("article", "order-card empty-state tracking-placeholder");
        empty.append(element("strong", "", "Aktif sipariş yok"), renderTimeline()); container.replaceChildren(empty);
      } else renderEmpty(container, "Geçmiş sipariş bulunamadı", "Tamamlanan siparişlerini bu bölümden açabilirsin.");
    }
  }
  function renderOrders() {
    renderOrderList(elements.ordersList, state.orders.filter(order => ACTIVE_ORDER_STATUSES.has(order.status)), true);
    renderOrderList(elements.historyList, state.historyOrders, false);
    elements.historyMore.hidden = !state.historyHasMore;
    elements.historyMore.disabled = state.historyLoading;
    elements.historyMore.textContent = state.historyLoading ? "Yükleniyor..." : "Daha eski siparişleri göster";
  }

  function renderAddresses() {
    if (!state.addresses.length) {
      renderEmpty(elements.addressesList, "Kayıtlı adres yok", "Yeni adres ekleyebilirsin.");
      return;
    }

    const rows = state.addresses.map((address) => {
      const row = element("article", "data-row");
      const heading = element("div", "data-row-heading");
      heading.append(element("strong", "", address.title || "Adres"));
      if (address.is_invoice) heading.append(element("span", "data-badge", "Fatura adresi"));
      const summary = [
        address.neighborhood,
        address.address_line,
        address.building_no ? `No: ${address.building_no}` : "",
        address.district,
        address.city
      ].filter(Boolean).join(", ");
      row.append(heading, element("p", "", summary));
      return row;
    });
    elements.addressesList.replaceChildren(...rows);
  }

  function renderSupport() {
    const pending = elements.supportForm.dataset.requestID;
    const selected = pending ? elements.supportForm.dataset.orderID || "" : elements.supportOrder.value;
    const general = element("option", "", "Genel konu"); general.value = "";
    elements.supportOrder.replaceChildren(general);
    for (const order of knownOrders()) {
      const option = element("option", "", `Sipariş ${orderCode(order)}`); option.value = order.id; elements.supportOrder.append(option);
    }
    if (pending && MAOrderRules.UUID.test(selected) && !knownOrders().some(order => order.id === selected)) {
      const previous = element("option", "", "Bekleyen mesajın siparişi"); previous.value = selected; elements.supportOrder.append(previous);
    }
    elements.supportOrder.value = selected; elements.supportOrder.disabled = !!pending;
    if (!state.supportTickets.length) {
      renderEmpty(elements.supportList, "Mesaj geçmişi boş", "Gönderdiğin destek mesajları burada görünecek.");
      return;
    }

    const rows = state.supportTickets.map((ticket) => {
      const row = element("article", "data-row support-row");
      const heading = element("div", "data-row-heading");
      heading.append(
        element("strong", "", ticket.status === "closed" ? "Yanıtlandı" : "İnceleniyor"),
        element("time", "", formatDate(ticket.created_at))
      );
      row.append(heading, element("p", "", ticket.message || ""));
      for (const reply of ticket.replies || []) row.append(element("strong", "", "Mağazadan AL"), element("p", "", reply.message || ""), element("time", "", formatDate(reply.created_at)));
      return row;
    });
    elements.supportList.replaceChildren(...rows);
  }

  function renderProfile() {
    const parts = MAOrderRules.splitName(state.profile?.full_name);
    elements.profileName.textContent = parts.firstName || "-";
    elements.profileSurname.textContent = parts.lastName || "-";
    elements.profileEmail.textContent = state.session?.user?.email || "-";
    elements.profilePhone.textContent = state.profile?.phone || "-";
  }

  function renderAll() {
    renderProfile();
    renderOrders();
    renderAddresses();
    renderSupport();
    syncOrderFlow();
  }

  async function fetchProfile() {
    const owner = state.session.user.id;
    const path = `/rest/v1/profiles?select=id,role,full_name,phone,is_active&id=eq.${encodeURIComponent(owner)}`;
    let rows = await api(path);
    if (!Array.isArray(rows)) throw new APIError(502);
    if (rows.length === 0) {
      // Confirmation-required signups have no session yet, so their profile is completed at first login.
      const user = await api("/auth/v1/user");
      if (user?.id !== owner || user.is_anonymous === true) throw new APIError(401);
      if (typeof user.email_confirmed_at !== "string" || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
        throw new ProfileError("Giriş yapmadan önce e-posta adresini doğrula.");
      }
      const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
      const phone = typeof user.user_metadata?.phone === "string" ? normalizePhone(user.user_metadata.phone) : null;
      if (name.length < 2 || name.length > 120 || !phone) {
        throw new ProfileError("Üyelik bilgilerin tamamlanamadı. Lütfen Bize Ulaşın üzerinden destek iste.");
      }
      const ready = await api("/rest/v1/rpc/ensure_customer_profile", {
        method: "POST", body: { p_full_name: name, p_phone: phone }
      });
      if (ready !== true) throw new ProfileError("Müşteri profilin tamamlanamadı. Lütfen Bize Ulaşın üzerinden destek iste.");
      rows = await api(path);
      if (!Array.isArray(rows)) throw new APIError(502);
    }
    const profile = rows?.[0];
    if (rows.length !== 1 || !profile || profile.id !== owner) {
      throw new ProfileError("Müşteri profilin doğrulanamadı. Lütfen Bize Ulaşın üzerinden destek iste.");
    }
    if (profile.role !== "customer" || profile.is_active !== true) {
      throw new ProfileError("Bu hesapla müşteri web alanına giriş yapılamıyor.");
    }
    return profile;
  }

  async function fetchAddresses() {
    return api(`/rest/v1/customer_addresses?select=id,title,city,district,neighborhood,address_line,building_no,building_name,directions,is_invoice,latitude,longitude,recipient_name,recipient_phone&customer_id=eq.${state.session.user.id}&order=created_at.desc`);
  }

  const orderSelection = "id,order_no,status,delivery_address_snapshot,selected_store_count,payment_method,customer_total,created_at,order_items(id,store_name,store_branch,product_name,order_note,size,color,estimated_price,final_price)";
  async function fetchOrders(filter = "") {
    return api(`/rest/v1/orders?select=${orderSelection}&customer_id=eq.${state.session.user.id}&order=created_at.desc,id.desc&limit=100${filter}`);
  }

  async function fetchActiveOrders() {
    const orders = [], seen = new Set();
    let cursor = null;
    do {
      const page = await fetchOrders(`&status=in.(${[...ACTIVE_ORDER_STATUSES].join(",")})${cursor ? MAOrderRules.olderOrdersFilter(cursor) : ""}`);
      if (!Array.isArray(page) || page.length > 100) throw new APIError(502);
      for (const order of page) {
        if (!MAOrderRules.UUID.test(order?.id) || seen.has(order.id)) throw new APIError(502);
        seen.add(order.id);
        if (ACTIVE_ORDER_STATUSES.has(order.status)) orders.push(order);
      }
      if (page.length < 100) return orders;
      cursor = MAOrderRules.orderCursor(page.at(-1));
    } while (true);
  }

  async function fetchOrderIDs(ids) {
    const rows = [];
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      if (chunk.some(id => !MAOrderRules.UUID.test(id))) throw new APIError(400);
      const page = await fetchOrders(`&id=in.(${chunk.join(",")})`);
      if (!Array.isArray(page)) throw new APIError(502);
      rows.push(...page.filter(order => chunk.includes(order?.id)));
    }
    return rows;
  }

  function knownOrders() {
    return [...new Map([...state.historyOrders, ...state.orders].map(order => [order.id, order])).values()];
  }

  function mergeRecentHistory(orders) {
    if (orders.length < 100) {
      state.historyOrders = orders.filter(order => ["delivered", "cancelled"].includes(order.status));
      state.historyCursor = null; state.historyHasMore = false;
      return;
    }
    const currentIDs = new Set(orders.map(order => order.id));
    state.historyOrders = [...orders.filter(order => ["delivered", "cancelled"].includes(order.status)),
      ...state.historyOrders.filter(order => !currentIDs.has(order.id))];
    if (!state.historyCursor) {
      try { state.historyCursor = MAOrderRules.orderCursor(orders.at(-1)); state.historyHasMore = true; }
      catch { showStatus(elements.historyStatus, "Eski siparişlerin sayfası doğrulanamadı. Daha sonra yeniden dene.", "error"); }
    }
  }

  async function loadOlderHistory() {
    if (!state.session || state.historyLoading || !state.historyHasMore || !state.historyCursor) return;
    const version = state.generation, owner = state.session.user.id, cursor = state.historyCursor;
    state.historyLoading = true; hideStatus(elements.historyStatus); renderOrders();
    try {
      const rows = await fetchOrders(`&status=in.(delivered,cancelled)${MAOrderRules.olderOrdersFilter(cursor)}`);
      const page = MAOrderRules.orderHistoryPage(rows, cursor);
      const events = await fetchActivities(page.rows.map(order => order.id));
      if (version !== state.generation || owner !== state.session?.user?.id || cursor !== state.historyCursor) return;
      const ids = new Set(knownOrders().map(order => order.id));
      state.historyOrders.push(...page.rows.filter(order => !ids.has(order.id)));
      state.activities = [...new Map([...state.activities, ...events].map(event => [event.id, event])).values()];
      state.historyCursor = page.cursor; state.historyHasMore = page.hasMore;
    } catch (error) {
      if (version !== state.generation || owner !== state.session?.user?.id) return;
      if (error instanceof APIError && [401, 403].includes(error.status)) { handleExpiredSession(); return; }
      showStatus(elements.historyStatus, "Eski siparişler yüklenemedi. Mevcut liste korundu; tekrar deneyebilirsin.", "error");
    } finally {
      if (version === state.generation && owner === state.session?.user?.id) { state.historyLoading = false; renderOrders(); }
    }
  }

  async function fetchSupportTickets() {
    return api("/rest/v1/rpc/list_support_tickets_v3", { method: "POST", body: {} });
  }

  async function fetchActivities(orderIDs) {
    if (!orderIDs.length) return [];
    const events = [];
    for (let index = 0; index < orderIDs.length; index += 100) {
      const chunk = orderIDs.slice(index, index + 100);
      const rows = await api("/rest/v1/rpc/list_order_activity", {
        method: "POST",
        body: { target_order_ids: chunk }
      });
      events.push(...rows);
    }
    return events;
  }

  async function loadPortal({ quiet = false, trackingOnly = false } = {}) {
    if (!state.session || state.loadInFlight) return;
    state.loadInFlight = true;
    const version = state.generation;
    try {
    if (!await enforceRuntimeStatus()) return;
    if (!quiet) elements.loading.hidden = false;
    hideStatus(elements.portalStatus);
    try {
      const profile = trackingOnly ? state.profile : await fetchProfile();
      let addresses = state.addresses, supportTickets = state.supportTickets, recent = null, orders;
      if (trackingOnly) {
        const active = await fetchActiveOrders(), activeIDs = new Set(active.map(order => order.id));
        const endedIDs = state.orders.filter(order => ACTIVE_ORDER_STATUSES.has(order.status) && !activeIDs.has(order.id)).map(order => order.id);
        const ended = await fetchOrderIDs(endedIDs);
        orders = [...active, ...ended];
      } else {
        [addresses, recent, supportTickets] = await Promise.all([fetchAddresses(), fetchOrders(), fetchSupportTickets()]);
        if (!Array.isArray(recent)) throw new APIError(502);
        const active = recent.length === 100 ? await fetchActiveOrders() : [];
        orders = [...new Map([...recent, ...active].map(order => [order.id, order])).values()];
        const present = new Set(orders.map(order => order.id));
        const endedIDs = state.orders.filter(order => ACTIVE_ORDER_STATUSES.has(order.status) && !present.has(order.id)).map(order => order.id);
        orders.push(...await fetchOrderIDs(endedIDs));
      }
      const activities = await fetchActivities(orders.map(order => order.id));
      if (version !== state.generation) return;
      state.profile = profile;
      state.addresses = addresses || [];
      const previousActive = new Set(state.orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).map((order) => order.id));
      const completed = (orders || []).filter(order => order.status === "delivered" && previousActive.has(order.id));
      const updatedIDs = new Set(orders.map(order => order.id));
      state.orders = trackingOnly ? [...orders, ...state.orders.filter(order => !ACTIVE_ORDER_STATUSES.has(order.status) && !updatedIDs.has(order.id))] : orders;
      if (recent) mergeRecentHistory(recent);
      const history = new Map([...state.historyOrders, ...orders.filter(order => ["delivered", "cancelled"].includes(order.status))].map(order => [order.id, order]));
      for (const order of state.orders) if (ACTIVE_ORDER_STATUSES.has(order.status)) history.delete(order.id);
      state.historyOrders = [...history.values()].sort(MAOrderRules.newestOrderFirst);
      for (const order of state.orders) if (!ACTIVE_ORDER_STATUSES.has(order.status)) {
        state.collapsedActiveOrders.delete(order.id); state.openLocationMaps.delete(order.id);
      }
      state.supportTickets = supportTickets || [];
      state.activities = [...state.activities.filter(event => !updatedIDs.has(event.order_id)), ...activities];
      renderAll();
      if (completed.length) showStatus(elements.portalStatus, `${completed.map(order => `Sipariş ${orderCode(order)}`).join(", ")} teslim edildi. Detayları Profil > Geçmiş siparişlerim bölümünde.`, "success");
    } catch (error) {
      if (error instanceof ProfileError) {
        handleExpiredSession(error.message);
        return;
      }
      if (error instanceof APIError && (error.status === 401 || error.status === 403)) {
        handleExpiredSession();
        return;
      }
      showStatus(elements.portalStatus, "Bilgiler şu anda yenilenemedi. Biraz sonra tekrar dene.", "error");
    } finally {
      elements.loading.hidden = true;
    }
    } finally { state.loadInFlight = false; }
  }

  function handleExpiredSession(message = "Oturumun sona erdi. Lütfen yeniden giriş yap.") {
    saveSession(null);
    clearPortalData();
    setPortalVisible(false);
    showStatus(elements.authStatus, message, "error");
  }

  function normalizePhone(value) {
    const trimmed = String(value || "").trim();
    const hasInternationalPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
    let digits = trimmed.replace(/\D/g, "");
    if (trimmed.startsWith("00")) digits = digits.slice(2);
    if (!hasInternationalPrefix && digits.length === 11 && digits.startsWith("0")) {
      digits = `90${digits.slice(1)}`;
    } else if (!hasInternationalPrefix && digits.length === 10) {
      digits = `90${digits}`;
    }
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
  }

  async function signIn(identifier, password) {
    if (!await enforceRuntimeStatus()) throw new APIError(503);
    const isEmail = identifier.includes("@");
    const data = await api(isEmail
      ? "/auth/v1/token?grant_type=password"
      : "/functions/v1/phone-password-login", {
      method: "POST",
      body: await protectedAuthBody("login", isEmail ? { email: identifier, password } : { phone: normalizePhone(identifier), password }),
      token: null
    });
    const session = sessionFromResponse(data);
    if (!session) throw new APIError(401);
    saveSession(session);
    return session;
  }

  async function requestPasswordReset(email) {
    await api(`/auth/v1/recover?redirect_to=${encodeURIComponent("https://magazadanal.com/password-reset/")}`, {
      method: "POST",
      body: await protectedAuthBody("recovery", { email }),
      token: null
    });
  }

  async function protectedAuthBody(action, body) {
    if (!window.MAAuthProtection) throw new APIError(503);
    return window.MAAuthProtection.protect(action, body);
  }

  async function logout() {
    const token = state.session?.accessToken;
    saveSession(null);
    clearPortalData();
    setPortalVisible(false);
    elements.password.value = "";
    if (token) {
      await api("/auth/v1/logout?scope=local", { method: "POST", body: {}, token }).catch(() => {});
    }
    window.location.replace("/hesabim/");
  }

  let homeLoad = null;
  function loadHome() {
    if (homeLoad) return homeLoad;
    const panel = document.getElementById("view-home");
    homeLoad = fetch("/", { credentials: "omit", cache: "no-cache" }).then(async response => {
      if (!response.ok) throw Error();
      const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
      const content = parsed.querySelector("main.home-main"); if (!content) throw Error();
      content.querySelectorAll("script, iframe, object, embed, form").forEach(node => node.remove());
      for (const node of content.querySelectorAll("*")) for (const attribute of [...node.attributes]) {
        if (attribute.name.startsWith("on")) node.removeAttribute(attribute.name);
      }
      panel.replaceChildren(...[...content.childNodes].map(node => document.importNode(node, true)));
    }).catch(() => { homeLoad = null; panel.replaceChildren(element("p", "status status-error", "Ana sayfa şu anda yüklenemiyor.")); });
    return homeLoad;
  }

  function openView(viewName) {
    if (!["home", "shop", "cart", "orders", "history", "profile", "addresses", "support"].includes(viewName)) return;
    if (!state.session && !["shop", "cart"].includes(viewName)) {
      if (viewName === "home") { window.location.assign("/"); return; }
      setPortalVisible(false);
      showStatus(elements.authStatus, "Devam etmek için hesabına giriş yap.");
      if (!elements.loginForm.hidden) elements.email.focus();
      return;
    }
    if (!state.session) {
      document.documentElement.dataset.sessionState = "guest";
      elements.authView.hidden = true;
      elements.portalView.hidden = false;
    }
    if (state.session) try { sessionStorage.setItem(`magazadanal.web.view.v1.${state.session.user.id}`, viewName); } catch { /* Memory-only navigation. */ }
    hideStatus(document.getElementById("order-status"));
    orderFlow?.show(viewName);
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== viewName;
    });
    document.querySelectorAll(".portal-tab[data-view]").forEach((button) => {
      const active = button.dataset.view === (["history", "addresses", "support"].includes(viewName) ? "profile" : viewName);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    if (viewName === "orders") locationControllers.forEach(controller => { void controller.update(); });
    if (viewName === "home") void loadHome();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = elements.email.value.trim().toLowerCase();
    const password = elements.password.value;
    const identifierIsValid = identifier.includes("@")
      ? identifier.includes(".")
      : normalizePhone(identifier) !== null;
    if (!identifierIsValid || password.length < 6) {
      showStatus(elements.authStatus, "E-posta/telefon ve şifreni kontrol et.", "error");
      return;
    }

    setAuthBusy(true);
    hideStatus(elements.authStatus);
    try {
      await signIn(identifier, password);
      elements.password.value = "";
      elements.showPassword.checked = false;
      elements.password.type = "password";
      setPortalVisible(true);
      await loadPortal();
      await restoreView(true);
      void loadHome();
    } catch (error) {
      saveSession(null);
      if (!state.webAccountEnabled) {
        showWebMaintenance();
      } else {
        showStatus(elements.authStatus, "E-posta/telefon veya şifre hatalı.", "error");
      }
    } finally {
      setAuthBusy(false);
    }
  });

  elements.showPassword.addEventListener("change", () => {
    elements.password.type = elements.showPassword.checked ? "text" : "password";
  });

  elements.forgotPasswordButton.addEventListener("click", async () => {
    const email = elements.email.value.trim().toLowerCase();
    if (!email.includes("@")) {
      showStatus(elements.authStatus, "Parola yenilemek için e-posta adresini yaz.", "error");
      elements.email.focus();
      return;
    }
    setAuthBusy(true);
    try {
      await requestPasswordReset(email);
      showStatus(elements.authStatus, "Parola yenileme bağlantısı mail adresine gönderildi.", "success");
    } catch {
      showStatus(elements.authStatus, "Bağlantı gönderilemedi. Biraz sonra tekrar dene.", "error");
    } finally {
      setAuthBusy(false);
    }
  });

  elements.logoutButton.addEventListener("click", logout);
  elements.profilePasswordReset.addEventListener("click", async () => {
    const email = state.session?.user?.email;
    if (!email) {
      showStatus(elements.portalStatus, "Mail adresi bulunamadı.", "error");
      return;
    }
    elements.profilePasswordReset.disabled = true;
    try {
      await requestPasswordReset(email);
      showStatus(elements.portalStatus, "Parola yenileme bağlantısı mail adresine gönderildi.", "success");
    } catch {
      showStatus(elements.portalStatus, "Bağlantı gönderilemedi. Biraz sonra tekrar dene.", "error");
    } finally {
      elements.profilePasswordReset.disabled = false;
    }
  });

  document.querySelectorAll(".portal-tab[data-view], [data-open-view]").forEach((button) => {
    button.addEventListener("click", () => {
      openView(button.dataset.view || button.dataset.openView);
    });
  });

  elements.supportMessage.addEventListener("input", () => {
    elements.supportCharacterCount.textContent = `${elements.supportMessage.value.length} / 2000`;
    persistSupport();
  });
  elements.supportOrder.addEventListener("change", () => persistSupport());
  function persistSupport(requestID = elements.supportForm.dataset.requestID || null) {
    if (!state.session) return false;
    try {
      const orderID = requestID ? elements.supportForm.dataset.orderID || null : elements.supportOrder.value || null;
      sessionStorage.setItem(`magazadanal.web.support.v1.${state.session.user.id}`, JSON.stringify({ message: elements.supportMessage.value, requestID, orderID })); return true;
    } catch { return false; }
  }

  elements.supportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.supportMessage.value.trim();
    if (message.length < 3) {
      showStatus(elements.portalStatus, "Mesaj en az 3 karakter olmalıdır.", "error");
      return;
    }
    elements.supportSubmit.disabled = true;
    elements.supportMessage.readOnly = true;
    try {
      const orderID = elements.supportForm.dataset.requestID ? elements.supportForm.dataset.orderID || null : elements.supportOrder.value || null;
      if (orderID && !MAOrderRules.UUID.test(orderID)) throw new APIError(400);
      const requestID = elements.supportForm.dataset.requestID || crypto.randomUUID();
      elements.supportForm.dataset.requestID = requestID;
      if (orderID) elements.supportForm.dataset.orderID = orderID; else delete elements.supportForm.dataset.orderID;
      elements.supportOrder.disabled = true;
      if (!persistSupport(requestID)) { elements.supportMessage.readOnly = false; elements.supportOrder.disabled = false; delete elements.supportForm.dataset.requestID; delete elements.supportForm.dataset.orderID; throw new APIError(507); }
      const response = await api("/rest/v1/rpc/create_support_ticket_v3", {
        method: "POST",
        body: { p_message: message, p_category: orderID ? "order_other" : "general", p_order_id: orderID, p_client_request_id: requestID }
      });
      if (response?.length !== 1 || !MAOrderRules.UUID.test(response[0].id || "")) throw new APIError(502);
      delete elements.supportForm.dataset.requestID;
      delete elements.supportForm.dataset.orderID;
      elements.supportOrder.disabled = false;
      elements.supportMessage.readOnly = false;
      try { sessionStorage.removeItem(`magazadanal.web.support.v1.${state.session.user.id}`); } catch { /* Memory-only draft. */ }
      elements.supportMessage.value = "";
      elements.supportCharacterCount.textContent = "0 / 2000";
      try { state.supportTickets = await fetchSupportTickets(); }
      catch { showStatus(elements.portalStatus, "Mesajın alındı; mesaj geçmişi şu anda yenilenemedi.", "success"); return; }
      renderSupport();
      showStatus(elements.portalStatus, "Mesajın alındı.", "success");
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        handleExpiredSession();
      } else {
        showStatus(elements.portalStatus, "Mesaj gönderilemedi. Biraz sonra tekrar dene.", "error");
      }
    } finally {
      elements.supportSubmit.disabled = false;
    }
  });

  async function bootstrap() {
    startRuntimeStatusMonitor();
    const stored = readStoredSession();
    if (stored) state.session = stored;
    if (!await enforceRuntimeStatus()) {
      if (document.documentElement.dataset.sessionState === "restoring") document.querySelector(".session-restoring").textContent = state.maintenanceMessage;
      window.setTimeout(bootstrap, 15000); return;
    }

    if (!stored) {
      setPortalVisible(false);
      const publicView = new URLSearchParams(location.search).get("view");
      if (["shop", "cart"].includes(publicView)) openView(publicView);
      return;
    }

    state.session = stored;
    try {
      if (!stored.accessToken || stored.expiresAt < Date.now() + 30000) await refreshSession();
      await loadPortal();
      if (!state.session) return;
      setPortalVisible(true);
      await restoreView();
      void loadHome();
    } catch (error) {
      if ([400, 401, 403].includes(error.status)) handleExpiredSession();
      else { setPortalVisible(true); await restoreView(); showStatus(elements.portalStatus, "Bağlantı kurulamadı; oturum ve taslak korunuyor. Yeniden bağlandığında bilgiler güncellenecek.", "error"); scheduleRefresh(); }
    }
  }

  const orderFlow = window.createMAOrderFlow({
    api,
    error: (text) => showStatus(elements.portalStatus, text, "error"),
    openView,
    email: () => state.session?.user?.email || "",
    requireLogin: () => {
      setPortalVisible(false);
      showStatus(elements.authStatus, "Sepetin korunuyor. Siparişini tamamlamak için giriş yap.");
      if (!elements.loginForm.hidden) elements.email.focus();
    },
    checkRuntime: enforceRuntimeStatus,
    refresh: () => loadPortal({ quiet: true }),
    showOrder: async (id) => {
      await loadPortal({ quiet: true });
      const version = state.generation;
      let order = knownOrders().find(order => order.id === id);
      if (!order && MAOrderRules.UUID.test(id)) {
        const rows = await fetchOrderIDs([id]);
        if (version !== state.generation) return;
        order = rows[0];
        if (order) {
          if (ACTIVE_ORDER_STATUSES.has(order.status)) state.orders.push(order);
          else state.historyOrders.push(order);
          renderOrders();
        }
      }
      const active = !order || ACTIVE_ORDER_STATUSES.has(order.status);
      openView(active ? "orders" : "history");
      const container = active ? elements.ordersList : elements.historyList;
      const card = [...container.children].find(node => node.dataset.orderId === id);
      if (card) card.open = true;
    }
  });
  document.getElementById("profile-edit").addEventListener("click", () => orderFlow.editProfile());
  elements.historyMore.addEventListener("click", () => { void loadOlderHistory(); });
  document.getElementById("profile-photo").addEventListener("click", () => orderFlow.editProfile());
  function syncOrderFlow() {
    orderFlow?.sync({ owner: state.session?.user?.id || null, profile: state.profile, addresses: state.addresses, runtime: state.runtime, orders: state.orders });
  }
  async function restoreView(freshLogin = false) {
    if (!state.session) return;
    const generation = state.generation;
    let saved = null;
    try {
      saved = sessionStorage.getItem(`magazadanal.web.view.v1.${state.session.user.id}`);
      const support = JSON.parse(sessionStorage.getItem(`magazadanal.web.support.v1.${state.session.user.id}`) || "null");
      elements.supportMessage.value = typeof support?.message === "string" ? support.message.slice(0, 2000) : "";
      if (MAOrderRules.UUID.test(support?.orderID || "")) {
        if (![...elements.supportOrder.options].some(option => option.value === support.orderID)) {
          const saved = element("option", "", "Seçili sipariş"); saved.value = support.orderID; elements.supportOrder.append(saved);
        }
        elements.supportOrder.value = support.orderID;
      }
      if (MAOrderRules.UUID.test(support?.requestID || "")) {
        elements.supportForm.dataset.requestID = support.requestID; elements.supportMessage.readOnly = true; elements.supportOrder.disabled = true;
        if (MAOrderRules.UUID.test(support?.orderID || "")) elements.supportForm.dataset.orderID = support.orderID;
      }
      elements.supportCharacterCount.textContent = `${elements.supportMessage.value.length} / 2000`;
    } catch { /* Restore only available tab-local state. */ }
    const guestCart = await orderFlow.resumeGuestCart();
    if (generation !== state.generation || !state.session) return;
    const target = guestCart ? "cart" : freshLogin ? "shop" : new URLSearchParams(location.search).get("view") || saved || "shop";
    openView(target);
  }
  document.getElementById("signup-toggle").addEventListener("click", () => {
    const form = document.getElementById("signup-form"); form.hidden = !form.hidden; elements.loginForm.hidden = !form.hidden;
    document.getElementById("signup-toggle").textContent = form.hidden ? "Hesap oluştur" : "Girişe dön";
  });
  document.getElementById("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type=submit]");
    const value = (id) => document.getElementById(`signup-${id}`).value.trim();
    let name;
    try { name = MAOrderRules.signupName(value("name"), value("surname")); }
    catch (error) { return showStatus(elements.authStatus, error.message, "error"); }
    const email = value("email"), phone = normalizePhone(value("phone"));
    const password = document.getElementById("signup-password").value;
    if (name.length < 2 || name.length > 100 || !email.includes("@") || !phone || password.length < 8 || password.length > 72 || password !== document.getElementById("signup-confirm").value) return showStatus(elements.authStatus, "Bilgileri ve aynı yazılan iki şifreyi kontrol et.", "error");
    submit.disabled = true;
    try {
      if (!await enforceRuntimeStatus()) return;
      const data = await api("/auth/v1/signup?redirect_to=https%3A%2F%2Fmagazadanal.com%2Fauth%2Fverify-email%2F", { method: "POST", token: null, body: await protectedAuthBody("signup", { email, password, data: { full_name: name, phone } }) });
      const session = sessionFromResponse(data);
      document.getElementById("signup-password").value = ""; document.getElementById("signup-confirm").value = "";
      if (session) {
        saveSession(session);
        if (await api("/rest/v1/rpc/ensure_customer_profile", { method: "POST", body: { p_full_name: name, p_phone: phone } }) !== true) throw new APIError(403);
        setPortalVisible(true); await loadPortal(); await restoreView(true);
      } else showStatus(elements.authStatus, "E-postana gelen doğrulama bağlantısını aç, ardından giriş yap.", "success");
    } catch { showStatus(elements.authStatus, "Kayıt tamamlanamadı. Bilgilerini kontrol edip yeniden dene.", "error"); }
    finally { submit.disabled = false; }
  });
  setInterval(() => {
    if (state.session && !document.hidden && !document.getElementById("view-orders").hidden) void loadPortal({ quiet: true, trackingOnly: true });
  }, 2000);
  setInterval(() => { if (state.session && !document.hidden) void loadPortal({ quiet: true }); }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.session) {
      void loadPortal({ quiet: true });
      locationControllers.forEach(controller => { void controller.update(); });
    }
  });
  bootstrap();
})();

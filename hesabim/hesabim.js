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
    activities: [],
    supportTickets: [],
    orderFilter: "active",
    refreshTimer: null
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
    welcomeTitle: document.getElementById("welcome-title"),
    lastUpdated: document.getElementById("last-updated"),
    refreshButton: document.getElementById("refresh-button"),
    logoutButton: document.getElementById("logout-button"),
    ordersList: document.getElementById("orders-list"),
    addressesList: document.getElementById("addresses-list"),
    supportForm: document.getElementById("support-form"),
    supportMessage: document.getElementById("support-message"),
    supportCharacterCount: document.getElementById("support-character-count"),
    supportSubmit: document.getElementById("support-submit"),
    supportList: document.getElementById("support-list"),
    profileName: document.getElementById("profile-name"),
    profileEmail: document.getElementById("profile-email"),
    profilePhone: document.getElementById("profile-phone"),
    profilePasswordReset: document.getElementById("profile-password-reset")
  };

  class APIError extends Error {
    constructor(status) {
      super(`Request failed: ${status}`);
      this.status = status;
    }
  }

  async function api(path, options = {}) {
    const headers = {
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const token = Object.prototype.hasOwnProperty.call(options, "token")
      ? options.token
      : state.session?.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });

    const data = await response.json().catch(() => null);
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
      refreshSession().catch(handleExpiredSession);
    }, delay);
  }

  async function refreshSession() {
    const current = state.session || readStoredSession();
    if (!current?.refreshToken) throw new APIError(401);
    const data = await api("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: current.refreshToken },
      token: null
    });
    const session = sessionFromResponse(data);
    if (!session) throw new APIError(401);
    saveSession(session);
    return session;
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
    elements.email.disabled = busy;
    elements.password.disabled = busy;
    elements.showPassword.disabled = busy;
    elements.loginButton.disabled = busy;
    elements.forgotPasswordButton.disabled = busy;
    elements.loginButton.textContent = busy ? "Kontrol ediliyor..." : "Giriş yap";
  }

  function setPortalVisible(isVisible) {
    elements.authView.hidden = isVisible;
    elements.portalView.hidden = !isVisible;
  }

  function clearPortalData() {
    state.profile = null;
    state.addresses = [];
    state.orders = [];
    state.activities = [];
    state.supportTickets = [];
    elements.welcomeTitle.textContent = "Hesabım";
    elements.lastUpdated.textContent = "";
    elements.ordersList.replaceChildren();
    elements.addressesList.replaceChildren();
    elements.supportList.replaceChildren();
    elements.profileName.textContent = "-";
    elements.profileEmail.textContent = "-";
    elements.profilePhone.textContent = "-";
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

  function renderTimeline(order) {
    const timeline = element("ol", "order-timeline");
    if (order.status === "cancelled") {
      const cancelled = element("li", "is-current is-cancelled", "Sipariş iptal edildi");
      timeline.append(cancelled);
      return timeline;
    }

    const orderActivities = state.activities.filter((item) => item.order_id === order.id);
    const courierStarted = order.status === "shopping"
      || order.status === "on_the_way"
      || order.status === "delivered"
      || orderActivities.some((item) => item.action === "store_departure_started");
    const currentIndex = order.status === "delivered"
      ? 3
      : order.status === "on_the_way"
        ? 2
        : courierStarted
          ? 1
          : 0;
    ORDER_STEPS.forEach((label, index) => {
      const item = element("li", index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : "", label);
      timeline.append(item);
    });
    return timeline;
  }

  function customerStatusText(order) {
    if (order.status === "cancelled" || order.status === "delivered" || order.status === "on_the_way") {
      return STATUS_LABELS.get(order.status);
    }
    const courierStarted = state.activities.some((item) => item.order_id === order.id && item.action === "store_departure_started");
    return courierStarted ? "Kurye mağazaya doğru yola çıktı" : "Talep alındı";
  }

  function renderOrderCard(order) {
    const card = element("article", `order-card status-${order.status}`);
    const heading = element("div", "order-card-heading");
    const titleGroup = element("div");
    titleGroup.append(
      element("strong", "order-number", `Sipariş ${orderCode(order)}`),
      element("span", "order-date", formatDate(order.created_at))
    );
    const status = element("span", "order-status", customerStatusText(order) || "Güncelleniyor");
    heading.append(titleGroup, status);
    card.append(heading);

    const meta = element("div", "order-meta");
    meta.append(
      element("span", "", `${Number(order.selected_store_count) || 1} mağaza`),
      element("strong", "", formatMoney(order.customer_total))
    );
    card.append(meta);

    card.append(renderTimeline(order));
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

  function renderOrders() {
    const activeOrders = state.orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));

    let filtered = state.orders;
    if (state.orderFilter === "active") filtered = activeOrders;
    if (state.orderFilter === "history") filtered = state.orders.filter((order) => !ACTIVE_ORDER_STATUSES.has(order.status));

    if (filtered.length) {
      elements.ordersList.replaceChildren(...filtered.map((order) => renderOrderCard(order)));
    } else {
      renderEmpty(elements.ordersList, "Sipariş bulunamadı", "Bu bölümde görüntülenecek bir sipariş yok.");
    }
  }

  function renderAddresses() {
    if (!state.addresses.length) {
      renderEmpty(elements.addressesList, "Kayıtlı adres yok", "Adres ekleme işlemini şimdilik iOS uygulamasından yapabilirsin.");
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
      return row;
    });
    elements.supportList.replaceChildren(...rows);
  }

  function renderProfile() {
    const name = state.profile?.full_name || "Müşteri";
    elements.welcomeTitle.textContent = `Merhaba, ${name.split(" ")[0]}`;
    elements.profileName.textContent = name;
    elements.profileEmail.textContent = state.session?.user?.email || "-";
    elements.profilePhone.textContent = state.profile?.phone || "-";
  }

  function renderAll() {
    renderProfile();
    renderOrders();
    renderAddresses();
    renderSupport();
    elements.lastUpdated.textContent = `Son güncelleme: ${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  }

  async function fetchProfile() {
    const rows = await api(`/rest/v1/profiles?select=id,role,full_name,phone,is_active&id=eq.${encodeURIComponent(state.session.user.id)}`);
    const profile = rows?.[0];
    if (!profile || profile.role !== "customer" || !profile.is_active) throw new APIError(403);
    return profile;
  }

  async function fetchAddresses() {
    return api("/rest/v1/customer_addresses?select=id,title,city,district,neighborhood,address_line,building_no,directions,is_invoice&order=created_at.desc");
  }

  async function fetchOrders() {
    return api("/rest/v1/orders?select=id,order_no,status,selected_store_count,payment_method,customer_total,created_at&order=created_at.desc");
  }

  async function fetchSupportTickets() {
    return api("/rest/v1/rpc/list_support_tickets", { method: "POST", body: {} });
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

  async function loadPortal({ quiet = false } = {}) {
    if (!state.session) return;
    if (!quiet) elements.loading.hidden = false;
    elements.refreshButton.disabled = true;
    hideStatus(elements.portalStatus);
    try {
      const [profile, addresses, orders, supportTickets] = await Promise.all([
        fetchProfile(),
        fetchAddresses(),
        fetchOrders(),
        fetchSupportTickets()
      ]);
      state.profile = profile;
      state.addresses = addresses || [];
      state.orders = orders || [];
      state.supportTickets = supportTickets || [];
      state.activities = await fetchActivities(state.orders.map((order) => order.id));
      renderAll();
    } catch (error) {
      if (error instanceof APIError && (error.status === 401 || error.status === 403)) {
        handleExpiredSession();
        return;
      }
      showStatus(elements.portalStatus, "Bilgiler şu anda yenilenemedi. Biraz sonra tekrar dene.", "error");
    } finally {
      elements.loading.hidden = true;
      elements.refreshButton.disabled = false;
    }
  }

  function handleExpiredSession() {
    saveSession(null);
    clearPortalData();
    setPortalVisible(false);
    showStatus(elements.authStatus, "Oturumun sona erdi. Lütfen yeniden giriş yap.", "error");
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
    const isEmail = identifier.includes("@");
    const data = await api(isEmail
      ? "/auth/v1/token?grant_type=password"
      : "/functions/v1/phone-password-login", {
      method: "POST",
      body: isEmail ? { email: identifier, password } : { phone: normalizePhone(identifier), password },
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
      body: { email },
      token: null
    });
  }

  async function logout() {
    const token = state.session?.accessToken;
    saveSession(null);
    clearPortalData();
    setPortalVisible(false);
    elements.password.value = "";
    if (token) {
      await api("/auth/v1/logout", { method: "POST", body: {}, token }).catch(() => {});
    }
    window.location.replace("/hesabim/");
  }

  function openView(viewName) {
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== viewName;
    });
    document.querySelectorAll(".portal-tab").forEach((button) => {
      const active = button.dataset.view === viewName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
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
    } catch {
      saveSession(null);
      showStatus(elements.authStatus, "E-posta/telefon veya şifre hatalı.", "error");
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

  elements.refreshButton.addEventListener("click", () => loadPortal());
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

  document.querySelectorAll(".portal-tab").forEach((button) => {
    button.addEventListener("click", () => openView(button.dataset.view));
  });
  document.querySelectorAll("[data-order-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orderFilter = button.dataset.orderFilter;
      document.querySelectorAll("[data-order-filter]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderOrders();
    });
  });

  elements.supportMessage.addEventListener("input", () => {
    elements.supportCharacterCount.textContent = `${elements.supportMessage.value.length} / 2000`;
  });

  elements.supportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.supportMessage.value.trim();
    if (message.length < 3) {
      showStatus(elements.portalStatus, "Mesaj en az 3 karakter olmalıdır.", "error");
      return;
    }
    elements.supportSubmit.disabled = true;
    try {
      await api("/rest/v1/rpc/create_support_ticket", {
        method: "POST",
        body: { p_message: message }
      });
      elements.supportMessage.value = "";
      elements.supportCharacterCount.textContent = "0 / 2000";
      state.supportTickets = await fetchSupportTickets();
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
    const stored = readStoredSession();
    if (!stored) {
      setPortalVisible(false);
      return;
    }

    state.session = stored;
    try {
      await refreshSession();
      setPortalVisible(true);
      await loadPortal();
    } catch {
      handleExpiredSession();
    }
  }

  bootstrap();
})();

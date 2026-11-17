(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MAOrderMessages = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Contract: devir/MESAJLASMA_SOZLESME.md (send_order_message, list_order_messages).
  const MAX_LENGTH = 500;
  const CHAT_STATUSES = new Set(["on_the_way"]);
  const ENDED_STATUSES = new Set(["delivered", "cancelled"]);
  const BLOCK_TEXT = new Map([
    ["link", "Güvenliğin için bağlantı paylaşılamaz."],
    ["email", "Güvenliğin için e-posta paylaşılamaz."],
    ["iban", "Güvenliğin için IBAN paylaşılamaz."],
    ["phone", "Güvenliğin için telefon numarası paylaşılamaz."],
    ["digits", "Güvenliğin için telefon numarası paylaşılamaz."]
  ]);
  const MESSAGES = {
    not_yet: "Bu sohbete şu anda mesaj yazılamıyor.",
    closed: "Sohbet kapandı. Yeni mesaj gönderilemez.",
    muted: "Bu sohbete şu anda mesaj gönderilemiyor.",
    rate_limited: "Çok hızlı mesaj gönderiyorsun, biraz bekle.",
    unauthorized: "Bu sohbete mesaj gönderme yetkin yok. Oturumunu kontrol edip tekrar dene.",
    invalid: "Mesaj boş olamaz ve en fazla 500 karakter olabilir.",
    network: "Mesaj gönderilemedi. Bağlantını kontrol edip tekrar dene.",
    unknown: "Mesaj gönderilemedi. Biraz sonra tekrar dene."
  };
  const ROLE_LABELS = { courier: "Kurye", admin: "Mağazadan AL" };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isChatStatus(status) { return CHAT_STATUSES.has(status); }
  function isEndedStatus(status) { return ENDED_STATUSES.has(status); }
  function normalizeBody(value) { return typeof value === "string" ? value.trim() : ""; }

  // Early warning only; the server filter is authoritative. Returns a reason or null.
  function precheck(value) {
    const text = normalizeBody(value);
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return "email";
    if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) return "link";
    if (/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|io|me|co|tr|ly|app|link|gl|xyz|site|online)\b/i.test(text)) return "link";
    if (/\bTR\s?\d{2}(?:\s?[0-9A-Z]{4}){3,}/i.test(text)) return "iban";
    for (const run of text.match(/\+?\d[\d\s().\-]{6,}\d/g) || []) {
      const digits = run.replace(/\D/g, "");
      if (/^(?:90|0)?5\d{9}$/.test(digits)) return "phone";
      if (digits.length >= 8) return "digits";
    }
    if (/\d{8,}/.test(text)) return "digits";
    return null;
  }

  function blockedText(reason) { return BLOCK_TEXT.get(reason) || "Güvenliğin için bu içerik paylaşılamaz."; }

  // Maps a send_order_message result (or thrown error) to {sent, keepText, text}.
  function sendOutcome(result, error) {
    if (error) {
      const code = Number(error.status);
      if (code === 401 || code === 403) return { sent: false, keepText: true, definitive: true, text: MESSAGES.unauthorized };
      return { sent: false, keepText: true, definitive: false, text: MESSAGES.network };
    }
    const status = result && typeof result === "object" ? result.status : null;
    if (status === "sent") return { sent: true, keepText: false, definitive: true, text: "" };
    if (status === "blocked") return { sent: false, keepText: true, definitive: true, text: blockedText(result.reason) };
    if (MESSAGES[status] && status !== "network" && status !== "unknown") return { sent: false, keepText: true, definitive: true, text: MESSAGES[status] };
    return { sent: false, keepText: true, definitive: false, text: MESSAGES.unknown };
  }

  function normalizeList(result) {
    if (!result || typeof result !== "object" || !["ok", "muted", "unauthorized"].includes(result.status)) return null;
    const messages = Array.isArray(result.messages) ? result.messages.filter((m) => m && typeof m.id === "string" && typeof m.body === "string"
      && ["customer", "courier", "admin"].includes(m.sender_role)) : [];
    return { status: result.status, open: result.open === true, canWriteFrom: typeof result.can_write_from === "string" ? result.can_write_from : null, messages };
  }

  function senderLabel(message) {
    if (message.is_mine === true) return "";
    return ROLE_LABELS[message.sender_role] || "Kurye";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(date);
  }

  // Message bodies are only ever assigned through textContent (never innerHTML).
  function renderMessage(doc, message) {
    const item = doc.createElement("li");
    item.className = `chat-message ${message.is_mine === true ? "is-mine" : "is-theirs"}${message.sender_role === "admin" && message.is_mine !== true ? " is-admin" : ""}`;
    const label = senderLabel(message);
    if (label) { const who = doc.createElement("strong"); who.className = "chat-sender"; who.textContent = label; item.append(who); }
    const body = doc.createElement("p"); body.className = "chat-body"; body.textContent = message.body; item.append(body);
    const time = doc.createElement("time"); time.className = "chat-time"; time.textContent = formatTime(message.created_at); item.append(time);
    return item;
  }

  function createPanel(options) {
    const { document: doc, orderID, rpc, uuid, isCurrent = () => true } = options;
    const node = doc.createElement("section"); node.className = "order-chat"; node.hidden = true;
    node.setAttribute("aria-label", "Kurye mesajı");
    const title = doc.createElement("h3"); title.textContent = "Kurye mesajı";
    const list = doc.createElement("ol"); list.className = "chat-list"; list.setAttribute("aria-live", "polite");
    const closed = doc.createElement("p"); closed.className = "muted chat-closed"; closed.textContent = "Sohbet kapandı. Mesajlar yalnız okunabilir."; closed.hidden = true;
    const form = doc.createElement("form"); form.className = "chat-form";
    const input = doc.createElement("textarea"); input.className = "chat-input"; input.maxLength = MAX_LENGTH; input.rows = 2;
    input.setAttribute("aria-label", "Kuryeye mesajın"); input.setAttribute("placeholder", "Mesajını yaz");
    const count = doc.createElement("span"); count.className = "muted chat-count"; count.textContent = `0/${MAX_LENGTH}`;
    const send = doc.createElement("button"); send.className = "button compact-button chat-send"; send.type = "submit"; send.textContent = "Gönder";
    const row = doc.createElement("div"); row.className = "chat-form-row"; row.append(count, send);
    const feedback = doc.createElement("p"); feedback.className = "chat-feedback"; feedback.setAttribute("role", "status"); feedback.hidden = true;
    form.append(input, row, feedback);
    node.append(title, list, closed, form);

    const known = new Map();
    const CURSOR_OVERLAP_MS = 120000;
    let after = null, open = false, loaded = false, inFlight = false, sending = false, pending = null, orderStatus = null, closedByStatus = false, canWriteFrom = null;

    function say(text) { feedback.textContent = text; feedback.hidden = !text; }
    function sync() {
      const canWrite = open && !closedByStatus;
      // Customer side: the section exists only once the courier or an admin has written (no waiting note).
      form.hidden = !canWrite;
      closed.hidden = canWrite || known.size === 0;
      node.hidden = known.size === 0;
      send.disabled = sending;
    }
    function draw() {
      const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      const ordered = [...known.values()].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
      list.replaceChildren(...ordered.map((message) => renderMessage(doc, message)));
      if (nearEnd) list.scrollTop = list.scrollHeight;
    }
    async function refresh() {
      if (inFlight || !isCurrent()) return;
      inFlight = true;
      try {
        const data = normalizeList(await rpc("list_order_messages", { p_order_id: orderID, p_after: after }));
        if (!data || !isCurrent()) return;
        if (data.status !== "ok") { known.clear(); after = null; open = false; canWriteFrom = null; list.replaceChildren(); sync(); return; }
        let added = false;
        for (const message of data.messages) if (!known.has(message.id)) { known.set(message.id, message); added = true; }
        // Geç kesinleşen bir mesaj atlanmasın: imleç en yeni mesajın 2 dakika gerisinden; tekrarlar kimlikle ayıklanır.
        const newest = Math.max(...[...known.values()].map((m) => Date.parse(m.created_at) || 0));
        if (newest > 0) after = new Date(newest - CURSOR_OVERLAP_MS).toISOString();
        open = data.open; canWriteFrom = data.canWriteFrom; loaded = true;
        if (added) draw();
        sync();
      } catch { /* The next refresh retries; the existing list stays visible. */ }
      finally { inFlight = false; }
    }
    function updateCount() { count.textContent = `${input.value.length}/${MAX_LENGTH}`; }
    input.addEventListener("input", updateCount);
    form.addEventListener("submit", async (event) => {
      if (event && event.preventDefault) event.preventDefault();
      if (sending || !isCurrent()) return;
      const body = normalizeBody(input.value);
      if (!body) { say(MESSAGES.invalid); return; }
      if (body.length > MAX_LENGTH) { say(MESSAGES.invalid); return; }
      const reason = precheck(body);
      if (reason) { say(blockedText(reason)); return; }
      if (!pending || pending.body !== body) pending = { id: uuid(), body };
      sending = true; sync(); say("");
      let outcome;
      try { outcome = sendOutcome(await rpc("send_order_message", { p_order_id: orderID, p_body: body, p_client_request_id: pending.id })); }
      catch (error) { outcome = sendOutcome(null, error); }
      sending = false;
      if (!isCurrent()) return;
      if (outcome.definitive) pending = null;
      if (outcome.sent) { input.value = ""; updateCount(); say(""); } else say(outcome.text);
      if (outcome.text === MESSAGES.closed) open = false;
      sync();
      await refresh();
    });
    return {
      node, refresh, send: () => form.dispatchEvent ? form.dispatchEvent({ type: "submit" }) : undefined,
      setOrderStatus(status) {
        const wasEnded = closedByStatus;
        orderStatus = status; closedByStatus = isEndedStatus(status);
        if (closedByStatus && !wasEnded) { open = false; sync(); void refresh(); } else sync();
      },
      get state() { return { after, open, loaded, size: known.size, orderStatus }; }
    };
  }

  return { MAX_LENGTH, UUID, isChatStatus, isEndedStatus, precheck, blockedText, sendOutcome, normalizeList, senderLabel, renderMessage, createPanel };
});

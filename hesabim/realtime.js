(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MARealtime = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Supabase Realtime Broadcast (private channels, Phoenix protocol vsn 1.0.0).
  // Contract: devir/ANLIK_BAGLANTI_PLANI.md. Signals carry no personal data; only
  // order_id and kind are read, and the caller refetches through existing functions.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const EVENT_KINDS = new Set(["order_changed", "message", "position"]);
  const HEARTBEAT_MS = 25000;
  const BACKOFF_BASE_MS = 1000;
  const BACKOFF_MAX_MS = 30000;
  const MAX_CHANNELS = 10;

  // options: { url, apikey, getToken(), onSignal({orderID, kind}), onStatus(connected),
  //            WebSocket, document, setTimeout, clearTimeout, setInterval, clearInterval, random }
  function create(options) {
    const WS = options.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
    const doc = options.document || (typeof document !== "undefined" ? document : null);
    const setT = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearT = options.clearTimeout || ((id) => clearTimeout(id));
    const setI = options.setInterval || ((fn, ms) => setInterval(fn, ms));
    const clearI = options.clearInterval || ((id) => clearInterval(id));
    const random = options.random || Math.random;
    const onSignal = options.onSignal || (() => {});
    const onStatus = options.onStatus || (() => {});

    const wanted = new Set();
    const joined = new Set();
    let socket = null, heartbeatTimer = null, reconnectTimer = null, attempts = 0;
    let ref = 0, awaitingHeartbeat = false, stopped = false, connected = false;

    function nextRef() { ref += 1; return String(ref); }
    function topicFor(orderID) { return `realtime:order:${orderID}`; }
    function visible() { return !doc || doc.hidden !== true; }
    function setConnected(value) {
      if (connected === value) return;
      connected = value;
      try { onStatus(value); } catch { /* A status listener must not break the socket. */ }
    }
    function updateConnected() {
      setConnected(Boolean(socket && socket.readyState === 1 && wanted.size > 0 && [...wanted].every((id) => joined.has(id))));
    }
    function send(message) {
      if (!socket || socket.readyState !== 1) return false;
      try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
    }
    function join(orderID) {
      const joinRef = nextRef();
      send({
        topic: topicFor(orderID), event: "phx_join", ref: joinRef, join_ref: joinRef,
        payload: { config: { broadcast: { self: false }, private: true }, access_token: options.getToken() || "" }
      });
    }
    function leave(orderID) {
      send({ topic: topicFor(orderID), event: "phx_leave", payload: {}, ref: nextRef() });
    }
    function clearTimers() {
      if (heartbeatTimer !== null) { clearI(heartbeatTimer); heartbeatTimer = null; }
      if (reconnectTimer !== null) { clearT(reconnectTimer); reconnectTimer = null; }
    }
    function closeSocket() {
      const current = socket;
      socket = null;
      joined.clear();
      awaitingHeartbeat = false;
      if (heartbeatTimer !== null) { clearI(heartbeatTimer); heartbeatTimer = null; }
      if (current) {
        current.onopen = current.onclose = current.onerror = current.onmessage = null;
        try { current.close(); } catch { /* Already closed. */ }
      }
      setConnected(false);
    }
    function scheduleReconnect() {
      if (stopped || !visible() || wanted.size === 0 || reconnectTimer !== null) return;
      const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempts);
      const delay = Math.round(ceiling / 2 + random() * ceiling / 2);
      attempts += 1;
      reconnectTimer = setT(() => { reconnectTimer = null; open(); }, delay);
    }
    function lost() {
      closeSocket();
      scheduleReconnect();
    }
    function heartbeat() {
      if (awaitingHeartbeat) { lost(); return; }
      awaitingHeartbeat = true;
      if (!send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() })) lost();
    }
    function onMessage(event) {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== "object") return;
      if (message.topic === "phoenix") { if (message.event === "phx_reply") awaitingHeartbeat = false; return; }
      const topic = typeof message.topic === "string" ? message.topic : "";
      const prefix = "realtime:order:";
      if (!topic.startsWith(prefix)) return;
      const topicOrderID = topic.slice(prefix.length);
      if (!wanted.has(topicOrderID)) return;
      if (message.event === "phx_reply") {
        if (message.payload && message.payload.status === "ok") { attempts = 0; joined.add(topicOrderID); }
        else joined.delete(topicOrderID);
        updateConnected();
        return;
      }
      if (message.event === "phx_error" || message.event === "phx_close") {
        joined.delete(topicOrderID);
        updateConnected();
        if (message.event === "phx_error") lost();
        return;
      }
      if (message.event !== "broadcast") return;
      const body = message.payload;
      if (!body || typeof body !== "object" || !EVENT_KINDS.has(body.event)) return;
      const data = body.payload && typeof body.payload === "object" ? body.payload : {};
      // Only order_id and kind are used; the topic must agree with them.
      const orderID = typeof data.order_id === "string" ? data.order_id : topicOrderID;
      if (orderID !== topicOrderID) return;
      onSignal({ orderID, kind: body.event });
    }
    function open() {
      if (stopped || !WS || socket || !visible() || wanted.size === 0) return;
      const token = options.getToken();
      if (!token) return;
      let instance;
      try { instance = new WS(`${options.url}?apikey=${encodeURIComponent(options.apikey)}&vsn=1.0.0`); } catch { scheduleReconnect(); return; }
      socket = instance;
      instance.onopen = () => {
        if (socket !== instance) return;
        for (const id of wanted) join(id);
        heartbeatTimer = setI(heartbeat, HEARTBEAT_MS);
      };
      instance.onmessage = (event) => { if (socket === instance) onMessage(event); };
      instance.onerror = () => {};
      instance.onclose = () => { if (socket === instance) lost(); };
    }
    function onVisibility() {
      if (stopped) return;
      if (!visible()) { clearTimers(); closeSocket(); return; }
      attempts = 0;
      open();
    }
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);

    return {
      // Replace the set of orders to follow (active orders only; capped).
      setOrders(ids) {
        if (stopped) return;
        const next = new Set((ids || []).filter((id) => typeof id === "string" && UUID.test(id)).slice(0, MAX_CHANNELS));
        for (const id of [...wanted]) if (!next.has(id)) { wanted.delete(id); if (joined.delete(id)) leave(id); }
        const added = [...next].filter((id) => !wanted.has(id));
        for (const id of added) wanted.add(id);
        if (wanted.size === 0) { clearTimers(); closeSocket(); return; }
        if (socket && socket.readyState === 1) for (const id of added) join(id);
        else open();
        updateConnected();
      },
      // Call when the access token was refreshed.
      tokenChanged() {
        if (stopped || !socket || socket.readyState !== 1) return;
        const accessToken = options.getToken();
        if (!accessToken) return;
        for (const id of wanted) send({ topic: topicFor(id), event: "access_token", payload: { access_token: accessToken }, ref: nextRef() });
      },
      // Sign-out: close everything. The instance can be reused through setOrders.
      stop() {
        wanted.clear();
        clearTimers();
        closeSocket();
        attempts = 0;
      },
      destroy() {
        stopped = true;
        wanted.clear();
        clearTimers();
        closeSocket();
        if (doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", onVisibility);
      },
      get connected() { return connected; }
    };
  }

  return { create, HEARTBEAT_MS, BACKOFF_BASE_MS, BACKOFF_MAX_MS, MAX_CHANNELS };
});

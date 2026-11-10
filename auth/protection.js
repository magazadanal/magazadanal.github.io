(function (root) {
  "use strict";
  const project = "zxqqbzggfbxoasyhueqb";
  const actions = new Set(["login", "signup", "recovery"]);
  const validToken = (value) => typeof value === "string" && value === value.trim() && /^[A-Za-z0-9._-]{1,2048}$/.test(value);
  const validID = (value) => typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  function configuration(value) {
    if (!value || value.version !== 1 || value.project !== project || typeof value.enabled !== "boolean") throw Error("Güvenlik ayarı doğrulanamadı.");
    if (value.enabled && (typeof value.site_key !== "string" || value.site_key !== value.site_key.trim() || !/^0x[A-Za-z0-9_-]{10,100}$/.test(value.site_key))) throw Error("Güvenlik ayarı doğrulanamadı.");
    return value;
  }
  async function load(probe = false) {
    const response = await fetch(probe ? "/assets/auth-protection-probe.json" : "/assets/auth-protection.json", { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("Güvenlik ayarı yüklenemedi. Yeniden dene.");
    const bytes = await response.text();
    if (bytes.length > 4096) throw Error("Güvenlik ayarı doğrulanamadı.");
    const config = configuration(JSON.parse(bytes));
    if (probe && (!config.enabled || !(Date.parse(config.expires_at) > Date.now()))) throw Error("Test süresi doldu.");
    return config;
  }
  function accepts(event, frame, id, action) {
    const data = event.data;
    return event.origin === root.location.origin && event.source === frame.contentWindow &&
      data && data.type === "ma-captcha" && data.id === id && data.action === action && validToken(data.token);
  }
  let pending = false;
  async function protect(action, body, probe = false) {
    if (!actions.has(action)) throw Error("Geçersiz güvenlik işlemi.");
    if (pending) throw Error("Güvenlik doğrulaması sürüyor.");
    pending = true;
    try {
      const config = await load(probe);
      if (!config.enabled) return body;
      const proof = await new Promise((resolve, reject) => {
        const id = crypto.randomUUID(), dialog = document.createElement("dialog"), frame = document.createElement("iframe");
        dialog.className = "auth-challenge-dialog"; dialog.setAttribute("aria-label", "Güvenlik doğrulaması");
        const close = document.createElement("button"); close.type = "button"; close.className = "app-close";
        const closeIcon = document.createElement("img"); closeIcon.src = "/assets/icons/close.png"; closeIcon.alt = ""; close.append(closeIcon);
        close.title = "Kapat"; close.setAttribute("aria-label", "Kapat");
        frame.title = "Güvenlik doğrulaması"; frame.referrerPolicy = "no-referrer";
        frame.src = "/auth/challenge/?" + new URLSearchParams({ id, action, client: "web", ...(probe ? {probe: "1"} : {}) });
        let finished = false;
        function finish(value) {
          if (finished) return; finished = true; clearTimeout(timer);
          root.removeEventListener("message", receive); root.removeEventListener("pagehide", cancelled);
          dialog.close(); dialog.remove(); value ? resolve({token: value, id}) : reject(Error("Güvenlik doğrulaması tamamlanmadı. Yeniden dene."));
        }
        const cancelled = () => finish(null);
        function receive(event) {
          if (accepts(event, frame, id, action)) finish(event.data.token);
          else if (event.origin === root.location.origin && event.source === frame.contentWindow && event.data?.type === "ma-captcha-error" && event.data.id === id) finish(null);
        }
        const timer = setTimeout(cancelled, 120000);
        close.addEventListener("click", cancelled); dialog.addEventListener("cancel", cancelled);
        root.addEventListener("message", receive); root.addEventListener("pagehide", cancelled, { once: true });
        dialog.append(close, frame); document.body.append(dialog); dialog.showModal();
      });
      return probe ? {...proof, action} : { ...body, gotrue_meta_security: { captcha_token: proof.token } };
    } finally { pending = false; }
  }
  const api = { protect, configuration, validToken, validID, accepts, actions, load };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MAAuthProtection = api;
})(typeof window === "object" ? window : globalThis);

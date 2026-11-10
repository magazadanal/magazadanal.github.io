(async function () {
  "use strict";
  const status = document.getElementById("challenge-status"), policy = window.MAAuthProtection;
  const params = new URLSearchParams(location.search), id = params.get("id"), action = params.get("action"), client = params.get("client");
  const probe = params.get("probe") === "1";
  let completed = false;
  function post(type, token) {
    if (completed) return;
    completed = true;
    const message = { type, id, action, ...(token ? { token } : {}) };
    if (client === "ios" && window.webkit?.messageHandlers?.maCaptcha) window.webkit.messageHandlers.maCaptcha.postMessage(message);
    else if (client === "android" && window.maCaptcha?.postMessage) window.maCaptcha.postMessage(JSON.stringify(message));
    else if (client === "web" && window.parent !== window) window.parent.postMessage(message, location.origin);
  }
  try {
    if (!policy || !policy.validID(id) || !policy.actions.has(action) || !["web", "ios", "android"].includes(client) ||
      [...params.keys()].length !== (probe ? 4 : 3) || params.getAll("probe").length !== (probe ? 1 : 0) ||
      params.getAll("id").length !== 1 || params.getAll("action").length !== 1 || params.getAll("client").length !== 1) throw Error();
    const config = await policy.load(probe);
    if (!config.enabled) throw Error();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.referrerPolicy = "no-referrer";
    script.addEventListener("error", () => { status.textContent = "Güvenlik doğrulaması yüklenemedi. Yeniden dene."; post("ma-captcha-error"); });
    script.addEventListener("load", () => {
      try {
        window.turnstile.render("#challenge-widget", {
          sitekey: config.site_key, action, cData: id, theme: "auto", size: "flexible", retry: "never", "refresh-expired": "never",
          callback(token) {
            if (!policy.validToken(token)) { post("ma-captcha-error"); return; }
            status.textContent = "Doğrulandı."; post("ma-captcha", token);
          },
          "error-callback"() { status.textContent = "Güvenlik doğrulaması tamamlanamadı."; post("ma-captcha-error"); },
          "expired-callback"() { status.textContent = "Doğrulamanın süresi doldu."; post("ma-captcha-error"); }
        });
      } catch { status.textContent = "Güvenlik doğrulaması yüklenemedi."; post("ma-captcha-error"); }
    });
    document.head.append(script);
  } catch { status.textContent = "Güvenlik doğrulaması kullanılamıyor. Yeniden dene."; post("ma-captcha-error"); }
})();

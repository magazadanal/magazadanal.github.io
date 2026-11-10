(function () {
  "use strict";
  const endpoint = "https://zxqqbzggfbxoasyhueqb.supabase.co/functions/v1/verify-auth-challenge-probe";
  const start = document.getElementById("start"), replay = document.getElementById("replay"), result = document.getElementById("result");
  let previous = null, replayTimer, expiryTimer, busy = false, replayReady = false;
  function session() {
    try {
      const raw = sessionStorage.getItem("magazadanal.web.session.v1");
      if (!raw || raw.length > 32768) return null;
      const value = JSON.parse(raw);
      return typeof value.accessToken === "string" && value.accessToken.length < 4096 && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() + 10000 && value.user?.id ? value : null;
    } catch { return null; }
  }
  function syncSession() {
    clearTimeout(expiryTimer);
    const current = session();
    if (!current) { previous = null; replayReady = false; clearTimeout(replayTimer); }
    document.getElementById("session-status").textContent = current ? "Oturum açık" : "Hesabına dönüp oturumunu yenile.";
    start.disabled = busy || !current;
    replay.disabled = busy || !current || !previous || !replayReady;
    if (current) expiryTimer = setTimeout(syncSession, Math.min(2147483647, Math.max(1, current.expiresAt - Date.now() - 10000)));
  }
  async function verify(proof) {
    const current = session();
    if (!current) throw Error("Hesabına dönüp oturumunu yenile.");
    const response = await fetch(endpoint, {method: "POST", cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + current.accessToken,
        apikey: "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_"}, body: JSON.stringify(proof)});
    if (!response.ok) throw Error(response.status === 401 ? "Hesabına dönüp oturumunu yenile." : "Test doğrulanamadı. Yeniden dene.");
    const value = await response.json();
    if (value.id !== proof.id || value.action !== proof.action || typeof value.verified !== "boolean") throw Error("Test yanıtı doğrulanamadı.");
    return value.verified;
  }
  syncSession();
  start.addEventListener("click", async () => {
    if (!session()) { syncSession(); return; }
    busy = true; previous = null; replayReady = false; clearTimeout(replayTimer); result.textContent = ""; syncSession();
    try {
      const action = document.querySelector('input[name="action"]:checked').value;
      const proof = await window.MAAuthProtection.protect(action, {}, true);
      if (!await verify(proof)) throw Error("Doğrulama reddedildi.");
      previous = proof; result.textContent = "Sunucu doğrulaması başarılı.";
      replayTimer = setTimeout(() => { replayReady = true; syncSession(); }, 6500);
    } catch (error) { result.textContent = error.message || "Doğrulama tamamlanamadı."; }
    finally { busy = false; syncSession(); }
  });
  replay.addEventListener("click", async () => {
    if (!session() || !previous || !replayReady || busy) { syncSession(); return; }
    const proof = previous; previous = null; replayReady = false; busy = true; syncSession();
    try { result.textContent = await verify(proof) ? "Tekrar kullanım henüz reddedilmedi; test tamamlanmadı." : "Tekrar kullanım reddedildi."; }
    catch (error) { result.textContent = error.message || "Test tamamlanamadı."; }
    finally { busy = false; syncSession(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSession(); });
  window.addEventListener("pageshow", syncSession);
  window.addEventListener("pagehide", () => { previous = null; replayReady = false; clearTimeout(replayTimer); clearTimeout(expiryTimer); });
})();

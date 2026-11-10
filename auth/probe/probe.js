(function () {
  "use strict";
  const endpoint = "https://zxqqbzggfbxoasyhueqb.supabase.co/functions/v1/verify-auth-challenge-probe";
  const start = document.getElementById("start"), replay = document.getElementById("replay"), result = document.getElementById("result");
  let previous = null, replayTimer;
  function session() {
    try {
      const raw = sessionStorage.getItem("magazadanal.web.session.v1");
      if (!raw || raw.length > 32768) return null;
      const value = JSON.parse(raw);
      return typeof value.accessToken === "string" && value.accessToken.length < 4096 && value.expiresAt > Date.now() + 10000 && value.user?.id ? value : null;
    } catch { return null; }
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
  document.getElementById("session-status").textContent = session() ? "Oturum açık" : "Test için açık bir oturum gerekiyor.";
  start.disabled = !session();
  start.addEventListener("click", async () => {
    start.disabled = true; replay.disabled = true; previous = null; clearTimeout(replayTimer); result.textContent = "";
    try {
      const action = document.querySelector('input[name="action"]:checked').value;
      const proof = await window.MAAuthProtection.protect(action, {}, true);
      if (!await verify(proof)) throw Error("Doğrulama reddedildi.");
      previous = proof; result.textContent = "Sunucu doğrulaması başarılı.";
      replayTimer = setTimeout(() => { if (previous) replay.disabled = false; }, 6500);
    } catch (error) { result.textContent = error.message || "Doğrulama tamamlanamadı."; }
    finally { start.disabled = !session(); }
  });
  replay.addEventListener("click", async () => {
    if (!previous) return;
    const proof = previous; previous = null; replay.disabled = true; start.disabled = true;
    try { result.textContent = await verify(proof) ? "Tekrar kullanım henüz reddedilmedi; test tamamlanmadı." : "Tekrar kullanım reddedildi."; }
    catch (error) { result.textContent = error.message || "Test tamamlanamadı."; }
    finally { start.disabled = !session(); }
  });
  window.addEventListener("pagehide", () => { previous = null; clearTimeout(replayTimer); });
})();

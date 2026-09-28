(() => {
  "use strict";

  const supabaseURL = "https://zxqqbzggfbxoasyhueqb.supabase.co";
  const publishableKey = "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_";
  const form = document.getElementById("password-reset-form");
  const passwordInput = document.getElementById("new-password");
  const confirmationInput = document.getElementById("confirm-password");
  const submitButton = document.getElementById("submit-button");
  const statusElement = document.getElementById("reset-status");

  const query = new URLSearchParams(window.location.search);
  let tokenHash = query.get("token_hash");
  const recoveryType = query.get("type");
  let recoveryAccessToken = null;

  window.history.replaceState({}, document.title, window.location.pathname);

  function showStatus(message, kind = "info") {
    statusElement.textContent = message;
    statusElement.className = `status status-${kind}`;
    statusElement.hidden = false;
  }

  function setFormEnabled(isEnabled) {
    passwordInput.disabled = !isEnabled;
    confirmationInput.disabled = !isEnabled;
    submitButton.disabled = !isEnabled;
  }

  async function requestJSON(path, options) {
    const response = await fetch(`${supabaseURL}${path}`, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Supabase request failed with status ${response.status}`);
    }
    return data;
  }

  async function verifyRecoveryToken() {
    if (recoveryAccessToken) {
      return recoveryAccessToken;
    }

    const session = await requestJSON("/auth/v1/verify", {
      method: "POST",
      body: JSON.stringify({ token_hash: tokenHash, type: "recovery" })
    });

    if (!session || typeof session.access_token !== "string" || !session.access_token) {
      throw new Error("Recovery session was not returned");
    }

    tokenHash = null;
    recoveryAccessToken = session.access_token;
    return recoveryAccessToken;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = passwordInput.value;
    const confirmation = confirmationInput.value;

    if (password.length < 8 || password.length > 72) {
      showStatus("Parolan 8 ile 72 karakter arasında olmalıdır.", "error");
      passwordInput.focus();
      return;
    }

    if (password !== confirmation) {
      showStatus("Yazdığın parolalar birbiriyle aynı değil.", "error");
      confirmationInput.focus();
      return;
    }

    setFormEnabled(false);
    submitButton.textContent = "Güncelleniyor...";

    try {
      const accessToken = await verifyRecoveryToken();
      await requestJSON("/auth/v1/user", {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ password })
      });

      recoveryAccessToken = null;
      passwordInput.value = "";
      confirmationInput.value = "";
      showStatus("Parolan güncellendi. Mağazadan Al uygulamasına yeni parolanla giriş yapabilirsin.", "success");
      submitButton.textContent = "Parola güncellendi";
    } catch {
      showStatus(
        recoveryAccessToken
          ? "Parola güncellenemedi. İnternet bağlantını kontrol edip tekrar dene."
          : "Bu bağlantı geçersiz, kullanılmış veya süresi dolmuş. Uygulamadan yeni bir bağlantı iste.",
        "error"
      );
      submitButton.textContent = "Parolayı güncelle";
      setFormEnabled(Boolean(recoveryAccessToken));
    }
  });

  if (!tokenHash || recoveryType !== "recovery") {
    tokenHash = null;
    showStatus("Bu bağlantı geçersiz veya eksik. Uygulamadan yeni bir parola yenileme bağlantısı iste.", "error");
    setFormEnabled(false);
  }
})();

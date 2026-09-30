(() => {
  "use strict";

  const supabaseURL = "https://zxqqbzggfbxoasyhueqb.supabase.co";
  const publishableKey = "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_";
  const form = document.getElementById("password-reset-form");
  const passwordInput = document.getElementById("new-password");
  const confirmationInput = document.getElementById("confirm-password");
  const showPasswordsInput = document.getElementById("show-passwords");
  const submitButton = document.getElementById("submit-button");
  const statusElement = document.getElementById("reset-status");
  const recoverySessionKey = "magazadanal.password-recovery";

  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  let tokenHash = query.get("token_hash");
  let recoveryType = query.get("type") || fragment.get("type");
  const linkError = query.get("error_description") || fragment.get("error_description");
  let recoveryAccessToken = fragment.get("access_token");

  function clearStoredRecoverySession() {
    try {
      sessionStorage.removeItem(recoverySessionKey);
    } catch {
      // Private browsing settings may make session storage unavailable.
    }
  }

  function accessTokenExpiry(accessToken) {
    try {
      const payload = accessToken.split(".")[1];
      const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
      const expiration = JSON.parse(atob(padded)).exp;
      return Number.isFinite(expiration) ? expiration * 1000 : null;
    } catch {
      return null;
    }
  }

  function storeRecoverySession(accessToken) {
    const tokenExpiry = accessTokenExpiry(accessToken);
    const expiresAt = Math.min(tokenExpiry || Infinity, Date.now() + 15 * 60 * 1000);

    try {
      sessionStorage.setItem(recoverySessionKey, JSON.stringify({ accessToken, expiresAt }));
    } catch {
      // The current page can still use the in-memory token.
    }
  }

  function readStoredRecoverySession() {
    try {
      const storedSession = JSON.parse(sessionStorage.getItem(recoverySessionKey));
      if (
        typeof storedSession?.accessToken === "string" &&
        storedSession.accessToken &&
        Number.isFinite(storedSession.expiresAt) &&
        storedSession.expiresAt > Date.now()
      ) {
        return storedSession.accessToken;
      }
    } catch {
      // Invalid or unavailable session storage is treated as no recovery session.
    }

    clearStoredRecoverySession();
    return null;
  }

  if (recoveryAccessToken && recoveryType === "recovery") {
    storeRecoverySession(recoveryAccessToken);
  } else {
    const storedAccessToken = readStoredRecoverySession();
    if (storedAccessToken) {
      recoveryAccessToken = storedAccessToken;
      recoveryType = "recovery";
    }
  }

  window.history.replaceState({}, document.title, window.location.pathname);

  function showStatus(message, kind = "info") {
    statusElement.textContent = message;
    statusElement.className = `status status-${kind}`;
    statusElement.hidden = false;
  }

  function setFormEnabled(isEnabled) {
    passwordInput.disabled = !isEnabled;
    confirmationInput.disabled = !isEnabled;
    showPasswordsInput.disabled = !isEnabled;
    submitButton.disabled = !isEnabled;
  }

  showPasswordsInput.addEventListener("change", () => {
    const inputType = showPasswordsInput.checked ? "text" : "password";
    passwordInput.type = inputType;
    confirmationInput.type = inputType;
  });

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
      const error = new Error(`Supabase request failed with status ${response.status}`);
      error.status = response.status;
      throw error;
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
      clearStoredRecoverySession();
      passwordInput.value = "";
      confirmationInput.value = "";
      showPasswordsInput.checked = false;
      passwordInput.type = "password";
      confirmationInput.type = "password";
      showStatus("Parolan güncellendi. Mağazadan Al uygulamasına yeni parolanla giriş yapabilirsin.", "success");
      submitButton.textContent = "Parola güncellendi";
    } catch (error) {
      const sessionWasRejected = error?.status === 401 || error?.status === 403;
      if (sessionWasRejected) {
        recoveryAccessToken = null;
        clearStoredRecoverySession();
      }

      showStatus(sessionWasRejected
        ? "Bu bağlantı geçersiz, kullanılmış veya süresi dolmuş. Uygulamadan yeni bir bağlantı iste."
        : "Parola güncellenemedi. İnternet bağlantını kontrol edip tekrar dene.", "error");
      submitButton.textContent = "Parolayı güncelle";
      setFormEnabled(Boolean(recoveryAccessToken));
    }
  });

  if (linkError && recoveryAccessToken) {
    showStatus("Güvenli parola yenileme oturumun hazır. Yeni parolanı belirleyebilirsin.");
    setFormEnabled(true);
  } else if (linkError) {
    tokenHash = null;
    recoveryAccessToken = null;
    clearStoredRecoverySession();
    showStatus("Bu bağlantı geçersiz, kullanılmış veya süresi dolmuş. Uygulamadan yeni bir bağlantı iste.", "error");
    setFormEnabled(false);
  } else if ((!tokenHash && !recoveryAccessToken) || recoveryType !== "recovery") {
    tokenHash = null;
    recoveryAccessToken = null;
    showStatus("Bu bağlantı geçersiz veya eksik. Uygulamadan yeni bir parola yenileme bağlantısı iste.", "error");
    setFormEnabled(false);
  }
})();

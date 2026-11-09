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

  // Recovery authority belongs only to this link and this page lifetime.
  clearStoredRecoverySession();
  const duplicateCredentials = ["token_hash", "type", "access_token"].some(
    (key) => query.getAll(key).length > 1 || fragment.getAll(key).length > 1
  );
  const invalidLink = Boolean(linkError || duplicateCredentials
    || (query.has("type") && fragment.has("type"))
    || (tokenHash && recoveryAccessToken)
    || (tokenHash && !/^[a-f0-9]{56}$/i.test(tokenHash))
    || (recoveryAccessToken && (recoveryAccessToken.length > 16384
      || !accessTokenExpiry(recoveryAccessToken)
      || accessTokenExpiry(recoveryAccessToken) <= Date.now())));
  let recoveryDeadline = Math.min(
    accessTokenExpiry(recoveryAccessToken || "") || Infinity,
    Date.now() + 15 * 60 * 1000
  );
  let generation = 0;
  let pageClosed = false;

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
      redirect: "error",
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
    if (pageClosed || Date.now() >= recoveryDeadline) throw Object.assign(new Error("Recovery expired"), { status: 401 });
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
    recoveryDeadline = Math.min(recoveryDeadline, accessTokenExpiry(recoveryAccessToken) || recoveryDeadline);
    return recoveryAccessToken;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pageClosed || invalidLink || recoveryType !== "recovery" || (!tokenHash && !recoveryAccessToken)) return;
    const submissionGeneration = generation;

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
      if (pageClosed || generation !== submissionGeneration) return;
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

  window.addEventListener("pagehide", () => {
    pageClosed = true;
    generation++;
    tokenHash = null;
    recoveryAccessToken = null;
    passwordInput.value = "";
    confirmationInput.value = "";
    setFormEnabled(false);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      pageClosed = true;
      showStatus("Parola yenilemeye devam etmek için e-postandaki bağlantıyı yeniden aç.", "error");
      setFormEnabled(false);
    }
  });

  if (invalidLink) {
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

(() => {
  "use strict";

  const supabaseURL = "https://zxqqbzggfbxoasyhueqb.supabase.co";
  const publishableKey = "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_";
  const statusElement = document.getElementById("confirmation-status");
  const confirmButton = document.getElementById("confirm-email");
  const accountLink = document.getElementById("account-link");
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash");
  const validLink = query.getAll("token_hash").length === 1
    && /^[a-f0-9]{56}$/i.test(tokenHash || "")
    && query.getAll("type").length === 1 && query.get("type") === "signup"
    && !query.has("error") && !query.has("error_description");
  let inFlight = false;
  let completed = false;

  window.history.replaceState({}, document.title, window.location.pathname);

  function showStatus(title, detail, kind) {
    statusElement.className = `status status-${kind}`;
    statusElement.replaceChildren();

    const strong = document.createElement("strong");
    strong.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = detail;
    statusElement.append(strong, paragraph);
  }

  async function confirmEmail() {
    if (!validLink || inFlight || completed) return;
    inFlight = true;
    confirmButton.disabled = true;
    confirmButton.textContent = "Doğrulanıyor...";
    showStatus("E-posta adresin doğrulanıyor...", "Lütfen bekle.", "pending");

    try {
      const response = await fetch(`${supabaseURL}/auth/v1/verify`, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token_hash: tokenHash, type: "signup" })
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error("Confirmation temporarily unavailable");
      }
      if (!response.ok) {
        completed = true;
        confirmButton.hidden = true;
        showStatus(
          "Bu doğrulama bağlantısı kullanılamıyor.",
          "Bağlantı geçersiz, daha önce kullanılmış veya süresi dolmuş olabilir. Yeni bir doğrulama e-postası iste veya giriş yapmayı dene.",
          "error"
        );
        return;
      }

      const { user } = await response.json();
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(user?.id || "")
          || typeof user.email_confirmed_at !== "string"
          || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
        throw new Error("Confirmation was not established");
      }
      completed = true;
      confirmButton.hidden = true;
      showStatus(
        "E-posta adresin doğrulandı.",
        "Mağazadan Al uygulamasına veya web müşteri hesabına giriş yapabilirsin.",
        "success"
      );
      accountLink.hidden = false;
    } catch {
      showStatus(
        "Doğrulama sonucu alınamadı.",
        "İnternet bağlantını kontrol edip yeniden dene. Daha önce doğruladıysan hesabına giriş yapabilirsin.",
        "error"
      );
    } finally {
      inFlight = false;
      confirmButton.disabled = false;
      confirmButton.textContent = "E-postamı doğrula";
    }
  }

  // Opening or scanning the email link must never consume its one-time token.
  if (validLink) {
    confirmButton.hidden = false;
    confirmButton.addEventListener("click", confirmEmail);
  } else {
    showStatus("Bu doğrulama bağlantısı kullanılamıyor.",
      "Bağlantı eksik veya geçersiz. E-postandaki bağlantıyı yeniden aç veya yeni bir doğrulama e-postası iste.", "error");
  }
})();

(() => {
  "use strict";

  const supabaseURL = "https://zxqqbzggfbxoasyhueqb.supabase.co";
  const publishableKey = "sb_publishable_WaikEJpLmpvHj8Jv5u5k9g_j3YngnF_";
  const statusElement = document.getElementById("confirmation-status");
  const accountLink = document.getElementById("account-link");
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash");
  const confirmationType = query.get("type");
  const linkError = query.get("error_description");

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
    if (linkError || !tokenHash || confirmationType !== "signup") {
      showStatus(
        "Bu doğrulama bağlantısı kullanılamıyor.",
        "Bağlantı geçersiz, daha önce kullanılmış veya süresi dolmuş olabilir. Uygulamadan yeniden doğrulama e-postası iste.",
        "error"
      );
      return;
    }

    try {
      const response = await fetch(`${supabaseURL}/auth/v1/verify`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token_hash: tokenHash, type: "signup" })
      });

      if (!response.ok) {
        showStatus(
          "Bu doğrulama bağlantısı kullanılamıyor.",
          "Bağlantı geçersiz, daha önce kullanılmış veya süresi dolmuş olabilir. Uygulamadan yeniden doğrulama e-postası iste.",
          "error"
        );
        return;
      }

      showStatus(
        "E-posta adresin doğrulandı.",
        "Mağazadan Al uygulamasına veya web müşteri hesabına giriş yapabilirsin.",
        "success"
      );
      accountLink.hidden = false;
    } catch {
      showStatus(
        "E-posta doğrulanamadı.",
        "İnternet bağlantını kontrol edip aynı bağlantıyı yeniden aç.",
        "error"
      );
    }
  }

  confirmEmail();
})();

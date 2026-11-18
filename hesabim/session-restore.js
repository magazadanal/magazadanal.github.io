(() => {
  "use strict";
  const root = document.documentElement;
  try {
    const session = JSON.parse(sessionStorage.getItem("magazadanal.web.session.v1"));
    if (session?.refreshToken && session?.user?.id) { root.dataset.sessionState = "restoring"; return; }
  } catch { /* The normal login form remains available without storage. */ }
  // Guests can open the order and cart pages; do not flash the login form while the page starts.
  if (["shop", "cart"].includes(new URLSearchParams(location.search).get("view"))) root.dataset.sessionState = "restoring";
})();

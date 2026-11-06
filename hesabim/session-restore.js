(() => {
  "use strict";
  try {
    const session = JSON.parse(sessionStorage.getItem("magazadanal.web.session.v1"));
    if (session?.refreshToken && session?.user?.id) document.documentElement.dataset.sessionState = "restoring";
  } catch { /* The normal login form remains available without storage. */ }
})();

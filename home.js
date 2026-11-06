(() => {
  "use strict";

  const SESSION_KEY = "magazadanal.web.session.v1";
  const accountLink = document.getElementById("home-account-link");
  if (!accountLink) return;

  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (session?.refreshToken && session?.user?.id) {
      accountLink.hidden = true;
      document.getElementById("home-sidebar").hidden = false;
      document.body.classList.add("home-signed-in");
    }
  } catch {
    // Restricted or malformed browser storage is treated as signed out.
  }
})();

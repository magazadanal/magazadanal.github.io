(() => {
  "use strict";

  const THEME_KEY = "magazadanal.web.theme.v1";
  const root = document.documentElement;

  function preferredTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // Storage restrictions should not prevent the system preference fallback.
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  function addToggle() {
    if (document.querySelector(".theme-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.textContent = "💡";

    function updateLabel() {
      const dark = root.dataset.theme === "dark";
      const label = dark ? "Açık modu aç" : "Koyu modu aç";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.setAttribute("aria-pressed", String(dark));
    }

    button.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      try {
        localStorage.setItem(THEME_KEY, nextTheme);
      } catch {
        // The current page still keeps the selected theme in memory.
      }
      updateLabel();
    });

    updateLabel();
    document.body.append(button);
  }

  applyTheme(preferredTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addToggle, { once: true });
  } else {
    addToggle();
  }
})();

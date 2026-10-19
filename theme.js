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

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("theme-toggle-icon");

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "4");
    icon.append(circle);

    for (const [x1, y1, x2, y2] of [
      [12, 2, 12, 4],
      [12, 20, 12, 22],
      [4.93, 4.93, 6.34, 6.34],
      [17.66, 17.66, 19.07, 19.07],
      [2, 12, 4, 12],
      [20, 12, 22, 12],
      [4.93, 19.07, 6.34, 17.66],
      [17.66, 6.34, 19.07, 4.93],
    ]) {
      const ray = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ray.setAttribute("x1", String(x1));
      ray.setAttribute("y1", String(y1));
      ray.setAttribute("x2", String(x2));
      ray.setAttribute("y2", String(y2));
      icon.append(ray);
    }

    button.append(icon);

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
    const headerActions = document.querySelector(".header-actions");
    (headerActions || document.body).append(button);
  }

  applyTheme(preferredTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addToggle, { once: true });
  } else {
    addToggle();
  }
})();

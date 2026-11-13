(() => {
  "use strict";
  const contracts = document.getElementById("public-contracts");
  Promise.all([fetch("/assets/order-catalog.json").then((r) => r.json()), fetch("/assets/legal-v9.json").then((r) => r.json())]).then(([catalog, legal]) => {
    for (const store of catalog.stores) {
      const link = document.createElement("a"); link.className = "store-button"; link.textContent = store; link.href = "/hesabim/";
      document.getElementById("public-stores").append(link);
    }
    for (const doc of legal.order) {
      const detail = document.createElement("details"); detail.className = "app-disclosure";
      const title = document.createElement("summary"); title.textContent = `${doc.title} · Genel örnek`;
      const text = document.createElement("pre"); text.className = "legal-text";
      text.textContent = doc.template.replace(/\{\{([A-Z_]+)\}\}/g, "[Sipariş sırasında doldurulur]");
      detail.append(title, text); contracts.append(detail);
    }
  }).catch(() => { contracts.textContent = "Sözleşmeler yüklenemedi. Yeniden dene veya Bize Ulaşın üzerinden iste."; });
})();

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:8766";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.SITE_SCREENSHOT_DIR || "/private/tmp/ma-web-order-20261105";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const width of [320, 390, 768, 1280]) for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors = [];
      page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.route("**/*", (route) => {
        assert.equal(new URL(route.request().url()).origin, base, "Public conditions need no external requests or login"); return route.continue();
      });
      await page.addInitScript((theme) => localStorage.setItem("magazadanal.web.theme.v1", theme), theme);
      await page.goto(base + "/alisveris-kosullari/");
      await page.locator("#public-contracts details").nth(3).waitFor();
      assert.equal(await page.locator("#public-stores a").count(), 33);
      assert.equal(await page.locator(".fees-table tbody tr").count(), 4);
      assert.ok(await page.getByText("Mağazadan AL Dijital Servisler Lojistik Anonim Şirketi", { exact: true }).isVisible());
      await page.locator("#public-contracts summary").first().click();
      assert.ok(await page.locator("#public-contracts pre").first().isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `conditions-${width}-${theme}.png`), fullPage: true });
      assert.deepEqual(errors, []); await page.close();
    }
    console.log("PASS: 8 public conditions viewport/theme combinations, 33 stores, four contracts, fees, no external requests.");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8766);
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg" };
http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.split("/").some((part) => part.startsWith(".") || part === "node_modules") || /\.(?:cjs|md|sh|yml)$/.test(pathname)) throw Error();
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = await fs.realpath(path.join(root, pathname));
    if (!file.startsWith(root + path.sep)) throw Error();
    const data = await fs.readFile(file);
    const account = pathname.startsWith("/hesabim/");
    const challenge = pathname.startsWith("/auth/challenge/");
    const probe = pathname.startsWith("/auth/probe/");
    const headers = {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": challenge ? "SAMEORIGIN" : "DENY",
      "Permissions-Policy": `camera=(), microphone=(), geolocation=${account ? "(self)" : "()"}, payment=(), usb=()`,
      "Referrer-Policy": "no-referrer"
    };
    if (account) headers["Content-Security-Policy"] = "default-src 'none'; connect-src 'self' https://zxqqbzggfbxoasyhueqb.supabase.co; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'self'; manifest-src 'self'";
    if (challenge) headers["Content-Security-Policy"] = "default-src 'none'; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'self'; frame-src https://challenges.cloudflare.com";
    if (probe) headers["Content-Security-Policy"] = "default-src 'none'; connect-src 'self' https://zxqqbzggfbxoasyhueqb.supabase.co; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'self'";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    // Match the hosting providers' root 404.html fallback without serving the requested file.
    const notFound = await fs.readFile(path.join(root, "404.html")).catch(() => null);
    res.writeHead(404, {
      "Content-Type": notFound ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'"
    });
    res.end(req.method === "HEAD" ? undefined : (notFound || "Not found"));
  }
}).listen(port, "127.0.0.1", () => console.log(`Local preview: http://127.0.0.1:${port}`));

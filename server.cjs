// Lokaler Entwicklungsserver ohne Installation zusätzlicher Pakete.
// Start auf Windows: node server.cjs
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = 4173;
const ROOT = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const allowed = new Set([
  "/", "/index.html", "/app.js", "/styles.css", "/sw.js", "/manifest.webmanifest",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
]);

http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!allowed.has(pathname)) {
    response.writeHead(404); response.end("Nicht gefunden"); return;
  }
  const relative = pathname === "/" ? "/index.html" : pathname;
  try {
    const file = await fs.readFile(path.join(ROOT, relative));
    response.writeHead(200, {
      "Content-Type": types[path.extname(relative)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch {
    response.writeHead(500); response.end("Datei konnte nicht gelesen werden");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Trainingslog bereit: http://localhost:${PORT}`);
  console.log("Mit Strg+C beenden.");
});

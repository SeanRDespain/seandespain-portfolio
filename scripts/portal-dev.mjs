// Local server for the portal and its functions, for development and the
// automated tests. Serves the built site from dist/ and hands /api/* to the
// same function files Netlify runs, with storage in a local folder instead
// of Netlify Blobs.
//
//   MANAGER_PORTAL_PASSWORD_HASH='<bcrypt hash>' node scripts/portal-dev.mjs [port]
//
// Use a throwaway test password locally, never the real one.
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.SD_STORE_DRIVER = "file";
process.env.SD_STORE_DIR ||= ".portal-data";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = Number(process.argv[2]) || 4510;

const load = async (file) => (await import(pathToFileURL(path.join(root, "netlify/functions", file)).href)).default;
const fns = { inquiry: await load("inquiry.mjs"), manager: await load("manager-api.mjs"), jarvis: await load("jarvis-api.mjs") };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf", ".json": "application/json", ".xml": "application/xml", ".docx": "application/octet-stream" };

function pickFunction(pathname) {
  if (pathname === "/api/inquiry") return fns.inquiry;
  if (pathname === "/api/manager" || pathname.startsWith("/api/manager/")) return fns.manager;
  if (pathname === "/api/jarvis/v1" || pathname.startsWith("/api/jarvis/v1/")) return fns.jarvis;
  return null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const fn = pickFunction(url.pathname);
    if (fn) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      // tests can pretend to be different visitors to exercise per-IP limits
      const ip = req.headers["x-test-ip"] || req.socket.remoteAddress;
      const response = await fn(request, { ip });
      const headers = {};
      response.headers.forEach((v, k) => {
        headers[k] = k === "set-cookie" ? response.headers.getSetCookie() : v;
      });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html");
    } catch {
      /* falls through to 404 */
    }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  })
  .listen(port, () => console.log(`portal dev server on http://localhost:${port} (store: ${process.env.SD_STORE_DIR})`));

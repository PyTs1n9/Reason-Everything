// 本地静态服务：仅为 harness 提供 http 源（IndexedDB 需要 http 源，file:// 不可靠）。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = 8317;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "harness.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`harness-server http://127.0.0.1:${PORT}/harness.html`);
});

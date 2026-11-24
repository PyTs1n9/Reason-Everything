// 本地静态服务：根 = sites/，供 /web/index.html 与 /tests/harness/layout-probe.html 同源访问。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handlePaperModel } from "../src/web/paper-model-api.mjs";
import { PAPER_MODEL_PATH } from "../src/web/paper-study.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // sites/
const PORT = Number(process.argv[2] || 8318);
const paperModel = {
  url: process.env.AGENTFLOW_PAPER_MODEL_URL,
  key: process.env.AGENTFLOW_PAPER_MODEL_KEY,
  model: process.env.AGENTFLOW_PAPER_MODEL_ID,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${req.socket.localPort}`);
    if (url.pathname === PAPER_MODEL_PATH) {
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(req.method === "POST" ? { body: Readable.toWeb(req), duplex: "half" } : {}),
      });
      const response = await handlePaperModel(request, paperModel);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    let path = decodeURIComponent(url.pathname);
    // 根路径直接出站内页会让相对资源解析到 /assets/*（404 无样式），重定向到真实入口
    if (path === "/") {
      res.writeHead(302, { location: "/web/index.html" });
      res.end();
      return;
    }
    if (path.endsWith("/")) path += "web/index.html";
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
  console.log(`web-server http://127.0.0.1:${PORT}/web/index.html`);
});

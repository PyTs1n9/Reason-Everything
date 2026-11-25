// 本地静态服务：根 = sites/，模型配置与密钥仅保存在本机服务端。
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createModelConfigService, handleModelConfig, MODEL_CONFIG_PATH } from "../src/web/model-config.ts";
import { handlePaperModel } from "../src/web/paper-model-api.mjs";
import { handlePaperOcr } from "../src/web/paper-ocr-api.mjs";
import { PAPER_MODEL_PATH } from "../src/web/paper-study.ts";
import { PAPER_OCR_PATH } from "../src/web/paper-ocr.ts";
import { createLocalLibraryService, handleLocalLibrary } from "../src/web/local-library.ts";
import { LOCAL_LIBRARY_PATH, LOCAL_LIBRARY_SETTINGS_FILE } from "../src/web/local-library-path.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || 8318);
const paperOcr = {
  localWindows: process.platform === "win32" && process.env.AGENTFLOW_PAPER_OCR_LOCAL !== "0",
  scriptPath: join(root, "scripts", "ocr-windows.ps1"),
};
const localToken = randomBytes(24).toString("hex");
const localLibrary = createLocalLibraryService({ root, settingsPath: join(root, LOCAL_LIBRARY_SETTINGS_FILE) });
let modelService = createModelConfigService({
  filePath: localLibrary.modelKeyFile,
  encryptionKey: readFileSync(localLibrary.encryptionKeyFile, "utf8").trim(),
});
await modelService.list();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  let apiRoute = false;
  try {
    if (!req.headers.host) {
      res.writeHead(400);
      res.end("missing host");
      return;
    }
    const hostname = new URL(`http://${req.headers.host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
      res.writeHead(403);
      res.end("local only");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${req.socket.localPort}`);
    let path = decodeURIComponent(url.pathname);
    if (path === "/__agentflow_local.json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "cross-origin-resource-policy": "same-origin",
      });
      res.end(JSON.stringify({ token: localToken }));
      return;
    }
    if (url.pathname === PAPER_OCR_PATH) {
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(req.method === "POST" ? { body: Readable.toWeb(req), duplex: "half" } : {}),
      });
      const response = await handlePaperOcr(request, paperOcr);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    // 根路径直接出站内页会让相对资源解析到 /assets/*（404 无样式），重定向到真实入口
    if (path === "/") {
      res.writeHead(302, { location: "/web/index.html" });
      res.end();
      return;
    }
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Readable.toWeb(req), duplex: "half" }),
    });
    apiRoute = url.pathname === MODEL_CONFIG_PATH || url.pathname.startsWith(`${MODEL_CONFIG_PATH}/`) ||
      url.pathname === PAPER_MODEL_PATH || url.pathname === LOCAL_LIBRARY_PATH || url.pathname.startsWith(`${LOCAL_LIBRARY_PATH}/`);
    if (apiRoute) {
      let response;
      if (url.pathname === LOCAL_LIBRARY_PATH || url.pathname.startsWith(`${LOCAL_LIBRARY_PATH}/`)) {
        response = await handleLocalLibrary(request, {
          token: localToken,
          validateCredentials: async (paths) => {
            await createModelConfigService({
              filePath: paths.modelKeyFile,
              encryptionKey: readFileSync(paths.encryptionKeyFile, "utf8").trim(),
            }).list();
          },
        }, localLibrary);
        if (response.ok && request.method === "POST" && url.pathname.replace(/\/+$/, "") === LOCAL_LIBRARY_PATH) {
          modelService = createModelConfigService({
            filePath: localLibrary.modelKeyFile,
            encryptionKey: readFileSync(localLibrary.encryptionKeyFile, "utf8").trim(),
          });
        }
      } else {
        response = url.pathname === PAPER_MODEL_PATH
          ? await handlePaperModel(request, { token: localToken }, modelService)
          : await handleModelConfig(request, { token: localToken }, modelService);
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (path.includes("\0")) {
      res.writeHead(400);
      res.end("invalid path");
      return;
    }
    if (path.endsWith("/")) path += "web/index.html";
    const file = normalize(join(root, path));
    const rel = relative(root, file);
    const segments = rel.split(/[\\/]/);
    const secretFile = segments.some((part) =>
      part === ".model-keys.json" || part === ".agentflow-model-keys.key" || part.startsWith(".model-keys.json.") ||
      part === LOCAL_LIBRARY_SETTINGS_FILE || part.startsWith(`${LOCAL_LIBRARY_SETTINGS_FILE}.`));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || secretFile) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch (error) {
    if (apiRoute) {
      console.error("本地接口处理失败", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "本地接口处理失败，请查看服务端日志" }));
      }
      return;
    }
    if (error instanceof URIError) {
      res.writeHead(400);
      res.end("invalid path");
      return;
    }
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    console.error("本地静态服务处理失败", error);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("server error");
    }
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`web-server http://127.0.0.1:${PORT}/web/index.html`);
});

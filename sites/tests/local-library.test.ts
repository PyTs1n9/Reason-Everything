import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLocalLibraryService, handleLocalLibrary } from "../src/web/local-library.ts";
import { createLocalLibraryClient } from "../src/web/local-library-client.ts";
import { LOCAL_LIBRARY_PATH, LOCAL_LIBRARY_SETTINGS_FILE, MODEL_KEY_FILENAME } from "../src/web/local-library-path.ts";
import { createModelConfigService, handleModelConfig, MODEL_CONFIG_PATH } from "../src/web/model-config.ts";

const origin = "http://127.0.0.1:8318";
const token = "local-library-token";
const encryptionKey = "a".repeat(64);
const apiKey = "sk-local-library-1234567890";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const sha256 = createHash("sha256").update(pdf).digest("hex");

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "agentflow-local-library-"));
  const root = join(base, "site");
  const library = join(base, "knowledge");
  mkdirSync(root, { recursive: true });
  return { base, root, library };
}

function request(path: string, method = "GET", body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { origin, ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

function authHeaders(extra: Record<string, string> = {}) {
  return { "x-agentflow-local-token": token, ...extra };
}

test("选择文件夹后持久化路径，PDF 原件与元数据可在重启后列出和取回", async () => {
  const { base, root, library } = fixture();
  try {
    const service = createLocalLibraryService({ root, settingsPath: join(root, LOCAL_LIBRARY_SETTINGS_FILE), now: () => "2026-11-25T00:00:00Z" });
    assert.equal(service.configured, false);
    assert.equal(service.snapshot().paperCount, 0);
    assert.deepEqual(service.snapshot().papers, []);
    const selected = await service.selectPath(library);
    assert.equal(selected.configured, true);
    assert.equal(selected.path, library);
    assert.equal(selected.paperCount, 0);
    const saved = service.savePaper({ filename: "研究论文.pdf", sha256, bytes: pdf });
    assert.deepEqual(saved, { sha256, filename: "研究论文.pdf", size: pdf.byteLength, savedAt: "2026-11-25T00:00:00Z" });
    assert.deepEqual(readFileSync(join(library, "papers", `${sha256}.pdf`)), pdf);
    const reopened = createLocalLibraryService({ root, settingsPath: join(root, LOCAL_LIBRARY_SETTINGS_FILE) });
    assert.equal(reopened.configured, true);
    assert.equal(reopened.snapshot().paperCount, 1);
    assert.deepEqual(reopened.readPaper(sha256).bytes, pdf);
    assert.deepEqual(reopened.snapshot().papers, [saved]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("同指纹 PDF 去重，不覆盖首个文件名；错误指纹、非 PDF 和损坏文件如实失败", async () => {
  const { base, root, library } = fixture();
  try {
    const service = createLocalLibraryService({ root, settingsPath: join(root, LOCAL_LIBRARY_SETTINGS_FILE) });
    await service.selectPath(library);
    service.savePaper({ filename: "first.pdf", sha256, bytes: pdf });
    const duplicate = service.savePaper({ filename: "renamed.pdf", sha256, bytes: pdf });
    assert.equal(duplicate.filename, "first.pdf");
    assert.equal(readdirSync(join(library, "papers")).filter((name) => name.endsWith(".pdf")).length, 1);
    assert.throws(() => service.savePaper({ filename: "bad.pdf", sha256: "0".repeat(64), bytes: pdf }), /指纹不一致/);
    assert.throws(() => service.savePaper({ filename: "bad.pdf", sha256, bytes: Buffer.from("not pdf") }), /不是有效 PDF/);
    writeFileSync(join(library, "papers", `${sha256}.pdf`), "broken");
    assert.throws(() => service.readPaper(sha256), /指纹不一致/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("模型凭据迁移到所选 secrets/，解密密钥随迁，后续保存仍写入同一目录", async () => {
  const { base, root, library } = fixture();
  try {
    const settingsPath = join(root, LOCAL_LIBRARY_SETTINGS_FILE);
    const localLibrary = createLocalLibraryService({ root, settingsPath });
    let modelService = createModelConfigService({ filePath: localLibrary.modelKeyFile, encryptionKey: readFileSync(localLibrary.encryptionKeyFile, "utf8").trim() });
    const before = await modelService.save({ name: "本机模型", baseUrl: "http://127.0.0.1:9999/v1", apiKey, model: "mock-model" });
    await localLibrary.selectPath(library, async (paths) => {
      await createModelConfigService({ filePath: paths.modelKeyFile, encryptionKey: readFileSync(paths.encryptionKeyFile, "utf8").trim() }).list();
    });
    modelService = createModelConfigService({ filePath: localLibrary.modelKeyFile, encryptionKey: readFileSync(localLibrary.encryptionKeyFile, "utf8").trim() });
    assert.deepEqual(await modelService.list(), before);
    const response = await handleModelConfig(request(MODEL_CONFIG_PATH, "POST", JSON.stringify({
      serviceId: before.services[0].id, name: "迁移后模型", baseUrl: "http://127.0.0.1:9999/v1", model: "mock-model",
    }), authHeaders({ "content-type": "application/json" })), { token }, modelService);
    assert.equal(response.status, 200);
    const disk = readFileSync(join(library, "secrets", MODEL_KEY_FILENAME), "utf8");
    assert.doesNotMatch(disk, new RegExp(apiKey));
    assert.match(disk, /v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/);
    assert.equal(existsSync(join(root, MODEL_KEY_FILENAME)), true, "原默认文件保留且不删除");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("候选凭据校验失败时保留当前目录与路径配置", async () => {
  const { base, root, library } = fixture();
  try {
    const settingsPath = join(root, LOCAL_LIBRARY_SETTINGS_FILE);
    const service = createLocalLibraryService({ root, settingsPath });
    await service.selectPath(library);
    const other = join(base, "other-library");
    await assert.rejects(service.selectPath(other, async () => { throw new Error("候选模型凭据损坏"); }), /候选模型凭据损坏/);
    assert.equal(service.snapshot().path, library);
    assert.equal(service.modelKeyFile, join(library, "secrets", MODEL_KEY_FILENAME));
    assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).root, library);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("拒绝相对路径、磁盘根目录、研究工作区内路径和缺密钥的现有凭据", async () => {
  const { base, root, library } = fixture();
  try {
    const settingsPath = join(root, LOCAL_LIBRARY_SETTINGS_FILE);
    const service = createLocalLibraryService({ root, settingsPath });
    await assert.rejects(service.selectPath("relative/path"), /绝对路径/);
    await assert.rejects(service.selectPath(root), /独立文件夹/);
    await assert.rejects(service.selectPath(join(root, "library")), /独立文件夹/);
    mkdirSync(join(library, "secrets"), { recursive: true });
    writeFileSync(join(library, "secrets", MODEL_KEY_FILENAME), "existing");
    await assert.rejects(service.selectPath(library), /缺少密钥文件/);
    assert.equal(existsSync(settingsPath), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("HTTP 接口校验同源与令牌，支持路径、浏览、上传、列表和二进制取回", async () => {
  const { base, root, library } = fixture();
  try {
    const settingsPath = join(root, LOCAL_LIBRARY_SETTINGS_FILE);
    const service = createLocalLibraryService({ root, settingsPath, browse: async () => null });
    const options = { token };
    assert.equal((await handleLocalLibrary(request(LOCAL_LIBRARY_PATH), options, service)).status, 401);
    assert.equal((await handleLocalLibrary(request(LOCAL_LIBRARY_PATH, "GET", undefined, authHeaders({ origin: "https://offsite.invalid" })), options, service)).status, 403);
    const selected = await handleLocalLibrary(request(`${LOCAL_LIBRARY_PATH}/`, "POST", JSON.stringify({ path: library }), authHeaders({ "content-type": "application/json" })), options, service);
    assert.equal(selected.status, 200);
    assert.equal((await selected.json()).configured, true);
    const browse = await handleLocalLibrary(request(`${LOCAL_LIBRARY_PATH}/browse`, "POST", undefined, authHeaders()), options, service);
    assert.deepEqual(await browse.json(), { path: null });
    const upload = await handleLocalLibrary(request(`${LOCAL_LIBRARY_PATH}/papers?filename=${encodeURIComponent("接口论文.pdf")}`, "POST", pdf, authHeaders({
      "content-type": "application/pdf", "x-agentflow-paper-sha256": sha256,
    })), options, service);
    assert.equal(upload.status, 200);
    assert.equal((await upload.json()).filename, "接口论文.pdf");
    const list = await handleLocalLibrary(request(`${LOCAL_LIBRARY_PATH}/papers`, "GET", undefined, authHeaders()), options, service);
    assert.equal((await list.json()).papers.length, 1);
    const download = await handleLocalLibrary(request(`${LOCAL_LIBRARY_PATH}/papers/${sha256}`, "GET", undefined, authHeaders()), options, service);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    const snapshot = await handleLocalLibrary(request(LOCAL_LIBRARY_PATH, "GET", undefined, authHeaders()), options, service);
    const text = await snapshot.text();
    assert.doesNotMatch(text, new RegExp(apiKey));
    assert.match(snapshot.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("浏览结果取消与手动路径都可由客户端处理，上传携带指纹且 401 只刷新一次令牌", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tokenRefreshes: boolean[] = [];
  const client = createLocalLibraryClient({
    getToken: async (refresh = false) => {
      tokenRefreshes.push(refresh);
      return refresh ? "fresh-token" : "stale-token";
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/browse")) return Response.json({ path: null });
      if (String(url).includes("/papers?")) {
        assert.equal(new Headers(init?.headers).get("x-agentflow-local-token"), tokenRefreshes.at(-1) ? "fresh-token" : "stale-token");
        assert.equal(new Headers(init?.headers).get("x-agentflow-paper-sha256"), sha256);
        assert.equal(new Headers(init?.headers).get("content-type"), "application/pdf");
        assert.deepEqual(Buffer.from(init?.body as Uint8Array), pdf);
        return Response.json({ sha256, filename: "客户端论文.pdf", size: pdf.byteLength, savedAt: "2026-11-25T00:00:00Z" }, { status: tokenRefreshes.length === 2 ? 401 : 200 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  assert.equal(await client.browse(), null);
  await assert.rejects(client.select(" "), /请选择本地知识库文件夹/);
  const saved = await client.savePaper({ filename: "客户端论文.pdf", sha256, bytes: pdf });
  assert.equal(saved.filename, "客户端论文.pdf");
  assert.deepEqual(tokenRefreshes, [false, false, true]);
  assert.match(calls[1].url, /filename=/);
});

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { authorizeLocalModelRequest } from "./model-config.ts";
import {
  cleanLocalLibraryPath,
  LOCAL_LIBRARY_PATH,
  LOCAL_LIBRARY_SETTINGS_FILE,
  MODEL_ENCRYPTION_KEY_FILENAME,
  MODEL_KEY_FILENAME,
} from "./local-library-path.ts";

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 128 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const FILE_MODE = 0o600;

export interface LocalLibraryPaper {
  sha256: string;
  filename: string;
  size: number;
  savedAt: string;
}

export interface LocalLibrarySnapshot {
  configured: boolean;
  path: string;
  papersDirectory: string;
  modelKeyFile: string;
  encryptionKeyFile: string;
  paperCount: number;
  papers: LocalLibraryPaper[];
}

interface LibrarySelection {
  root: string;
  modelKeyFile: string;
  encryptionKeyFile: string;
}

export interface LocalLibraryOptions {
  root: string;
  settingsPath?: string;
  now?: () => string;
  browse?: () => Promise<string | null>;
}

interface LocalLibraryRequestOptions {
  token?: string;
  validateCredentials?: (paths: { modelKeyFile: string; encryptionKeyFile: string }) => void | Promise<void>;
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function atomicWrite(filePath: string, value: string | Uint8Array, mode = FILE_MODE): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, value, { mode, flag: "wx" });
  try {
    renameSync(temporary, filePath);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}

function libraryRoot(raw: unknown, serverRoot: string): string {
  const cleaned = cleanLocalLibraryPath(raw);
  if (!isAbsolute(cleaned)) throw new Error("本地知识库必须使用绝对路径");
  if (cleaned.startsWith("\\\\") || cleaned.startsWith("//")) throw new Error("本地知识库不能使用网络共享路径");
  const root = resolve(cleaned);
  if (parse(root).root === root) throw new Error("不能把磁盘根目录作为本地知识库");
  const siteRoot = resolve(serverRoot);
  if (inside(root, siteRoot) || inside(siteRoot, root)) {
    throw new Error("本地知识库必须选择研究工作区之外的独立文件夹");
  }
  return root;
}

function ensureWritable(root: string): void {
  mkdirSync(root, { recursive: true });
  if (!statSync(root).isDirectory()) throw new Error("所选路径不是文件夹");
  const probe = join(root, `.agentflow-write-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(probe, "ok", { mode: FILE_MODE, flag: "wx" });
  unlinkSync(probe);
}

function cleanFilename(value: unknown): string {
  if (typeof value !== "string") throw new Error("PDF 文件名无效");
  const filename = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  if (!filename || filename.length > 255 || !/\.pdf$/i.test(filename)) throw new Error("PDF 文件名无效");
  return filename;
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function readPaperMetadata(filePath: string, sha256: string): LocalLibraryPaper {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`本地知识库文献索引损坏：${sha256.slice(0, 12)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本地知识库文献索引格式无效");
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 || record.sha256 !== sha256 || typeof record.filename !== "string" ||
    !record.filename || record.filename.length > 255 || !Number.isSafeInteger(record.size) ||
    Number(record.size) <= 0 || Number(record.size) > MAX_PDF_BYTES ||
    typeof record.savedAt !== "string" || !Number.isFinite(Date.parse(record.savedAt))
  ) throw new Error("本地知识库文献索引格式无效");
  return {
    sha256,
    filename: record.filename,
    size: Number(record.size),
    savedAt: record.savedAt,
  };
}

function paperBytes(root: string, sha256: string): { bytes: Buffer; filePath: string } {
  const filePath = join(root, "papers", `${sha256}.pdf`);
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PDF_BYTES) throw new Error("本地知识库 PDF 文件大小无效");
  return { bytes: readFileSync(filePath), filePath };
}

function verifiedPaperBytes(root: string, sha256: string): { bytes: Buffer; filePath: string } {
  const { bytes, filePath } = paperBytes(root, sha256);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("本地知识库 PDF 文件指纹不一致");
  return { bytes, filePath };
}

async function readBinaryBody(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES) throw new Error("PDF 超出 128 MB 限制");
  if (!request.body) throw new Error("请求内容为空");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_PDF_BYTES) throw new Error("PDF 超出 128 MB 限制");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new Error("请求内容超出大小限制");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  if (!request.body) throw new Error("请求内容为空");
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > MAX_JSON_BYTES) throw new Error("请求内容超出大小限制");
    text += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export async function pickWindowsDirectory(runner = execFileAsync): Promise<string | null> {
  if (process.platform !== "win32") throw new Error("当前系统请手动输入本地知识库绝对路径");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择研论书屋本地知识库文件夹'",
    "$dialog.ShowNewFolderButton = $true",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath } else { exit 2 }",
  ].join("; ");
  try {
    const { stdout } = await runner("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 32 * 1024,
    });
    return cleanLocalLibraryPath(String(stdout).replace(/^\uFEFF/, "").trim());
  } catch (error) {
    if (error?.code === 2 || error?.code === "2") return null;
    throw error;
  }
}

export function createLocalLibraryService(options: LocalLibraryOptions) {
  const root = resolve(options.root);
  const settingsPath = options.settingsPath ?? join(root, LOCAL_LIBRARY_SETTINGS_FILE);
  const defaultModelKeyFile = join(root, MODEL_KEY_FILENAME);
  const defaultEncryptionKeyFile = join(root, MODEL_ENCRYPTION_KEY_FILENAME);
  const now = options.now ?? (() => new Date().toISOString());
  let selection: LibrarySelection | null = null;

  function activate(candidate: LibrarySelection): void {
    mkdirSync(join(candidate.root, "papers"), { recursive: true });
    mkdirSync(join(candidate.root, "secrets"), { recursive: true });
    if (!existsSync(candidate.encryptionKeyFile)) throw new Error("本地知识库缺少模型密钥文件");
    selection = candidate;
  }

  if (existsSync(settingsPath)) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      throw new Error("本地知识库路径配置格式无效");
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
      throw new Error("本地知识库路径配置格式无效");
    }
    const selectedRoot = libraryRoot(value.root, root);
    if (!existsSync(selectedRoot) || !statSync(selectedRoot).isDirectory()) {
      throw new Error("本地知识库文件夹不存在，请重新选择");
    }
    activate({
      root: selectedRoot,
      modelKeyFile: join(selectedRoot, "secrets", MODEL_KEY_FILENAME),
      encryptionKeyFile: join(selectedRoot, "secrets", MODEL_ENCRYPTION_KEY_FILENAME),
    });
  } else {
    mkdirSync(root, { recursive: true });
    if (existsSync(defaultModelKeyFile) && !existsSync(defaultEncryptionKeyFile)) {
      throw new Error("模型凭据缺少对应密钥文件");
    }
    if (!existsSync(defaultEncryptionKeyFile)) {
      atomicWrite(defaultEncryptionKeyFile, `${randomBytes(32).toString("hex")}\n`);
    }
    selection = {
      root,
      modelKeyFile: defaultModelKeyFile,
      encryptionKeyFile: defaultEncryptionKeyFile,
    };
  }

  function requireLibrary(): LibrarySelection {
    if (!selection) throw new Error("请先选择本地知识库文件夹");
    return selection;
  }

  function listPapers(): LocalLibraryPaper[] {
    if (!selection) return [];
    const directory = join(selection.root, "papers");
    if (!existsSync(directory) && selection.root === root) return [];
    const papers: LocalLibraryPaper[] = [];
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith(".json")) continue;
      const sha256 = entry.slice(0, -5);
      if (!validSha(sha256)) throw new Error("本地知识库包含无效文献索引文件名");
      const paper = readPaperMetadata(join(directory, entry), sha256);
      const filePath = join(directory, `${sha256}.pdf`);
      if (!existsSync(filePath)) throw new Error(`本地知识库缺少 PDF 原件：${paper.filename}`);
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size !== paper.size) throw new Error(`本地知识库 PDF 大小不一致：${paper.filename}`);
      papers.push(paper);
    }
    return papers.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.sha256.localeCompare(b.sha256));
  }

  function snapshot(): LocalLibrarySnapshot {
    const papers = listPapers();
    const configured = Boolean(selection && selection.root !== root);
    return {
      configured,
      path: configured ? selection!.root : "",
      papersDirectory: configured ? join(selection!.root, "papers") : "",
      modelKeyFile: selection!.modelKeyFile,
      encryptionKeyFile: selection!.encryptionKeyFile,
      paperCount: papers.length,
      papers,
    };
  }

  async function selectPath(raw: unknown, validateCredentials?: LocalLibraryRequestOptions["validateCredentials"]): Promise<LocalLibrarySnapshot> {
    const targetRoot = libraryRoot(raw, root);
    ensureWritable(targetRoot);
    mkdirSync(join(targetRoot, "papers"), { recursive: true });
    const source = requireLibrary();
    const secrets = join(targetRoot, "secrets");
    mkdirSync(secrets, { recursive: true });
    const modelKeyFile = join(secrets, MODEL_KEY_FILENAME);
    const encryptionKeyFile = join(secrets, MODEL_ENCRYPTION_KEY_FILENAME);
    if (existsSync(modelKeyFile) && !existsSync(encryptionKeyFile)) {
      throw new Error("所选文件夹已有模型凭据但缺少密钥文件，未覆盖任何文件");
    }
    const hadTargetKey = existsSync(encryptionKeyFile);
    if (!hadTargetKey) {
      if (existsSync(source.modelKeyFile) && !existsSync(source.encryptionKeyFile)) {
        throw new Error("当前模型凭据缺少对应密钥文件，未迁移");
      }
      if (existsSync(source.encryptionKeyFile)) copyFileSync(source.encryptionKeyFile, encryptionKeyFile);
      else atomicWrite(encryptionKeyFile, `${randomBytes(32).toString("hex")}\n`);
    }
    if (!existsSync(modelKeyFile) && !hadTargetKey && existsSync(source.modelKeyFile)) {
      copyFileSync(source.modelKeyFile, modelKeyFile);
    }
    if (validateCredentials) await validateCredentials({ modelKeyFile, encryptionKeyFile });
    atomicWrite(settingsPath, `${JSON.stringify({ version: 1, root: targetRoot }, null, 2)}\n`);
    selection = { root: targetRoot, modelKeyFile, encryptionKeyFile };
    return snapshot();
  }

  function savePaper(input: { filename: unknown; sha256: unknown; bytes: Uint8Array }): LocalLibraryPaper {
    const current = requireLibrary();
    if (!validSha(input.sha256)) throw new Error("PDF 文件 SHA-256 无效");
    if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength) throw new Error("PDF 原文件为空");
    const bytes = Buffer.from(input.bytes);
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("PDF 超出 128 MB 限制");
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("文件内容不是有效 PDF");
    if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new Error("PDF 文件指纹不一致");
    const filename = cleanFilename(input.filename);
    const directory = join(current.root, "papers");
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, `${input.sha256}.pdf`);
    const metadataPath = join(directory, `${input.sha256}.json`);
    const existed = existsSync(filePath);
    if (existed) verifiedPaperBytes(current.root, input.sha256);
    else atomicWrite(filePath, bytes);
    try {
      if (existsSync(metadataPath)) {
        const paper = readPaperMetadata(metadataPath, input.sha256);
        if (paper.size !== bytes.byteLength) throw new Error("本地知识库 PDF 元数据大小不一致");
        return paper;
      }
      const paper = { version: 1, sha256: input.sha256, filename, size: bytes.byteLength, savedAt: now() };
      atomicWrite(metadataPath, `${JSON.stringify(paper, null, 2)}\n`);
      return { sha256: input.sha256, filename, size: bytes.byteLength, savedAt: paper.savedAt };
    } catch (error) {
      if (!existed) unlinkSync(filePath);
      throw error;
    }
  }

  function readPaper(sha256: unknown): { paper: LocalLibraryPaper; bytes: Buffer } {
    const current = requireLibrary();
    if (!validSha(sha256)) throw new Error("PDF 文件 SHA-256 无效");
    const metadataPath = join(current.root, "papers", `${sha256}.json`);
    if (!existsSync(metadataPath)) throw new Error("本地知识库中不存在该 PDF");
    const paper = readPaperMetadata(metadataPath, sha256);
    if (!existsSync(join(current.root, "papers", `${sha256}.pdf`))) throw new Error("本地知识库缺少 PDF 原件");
    const { bytes } = verifiedPaperBytes(current.root, sha256);
    return { paper, bytes };
  }

  return {
    get root() { return selection!.root; },
    get configured() { return Boolean(selection && selection.root !== root); },
    get modelKeyFile() { return selection!.modelKeyFile; },
    get encryptionKeyFile() { return selection!.encryptionKeyFile; },
    snapshot,
    selectPath,
    savePaper,
    readPaper,
    async browse() { return options.browse ? options.browse() : pickWindowsDirectory(); },
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = /请先选择/.test(message) ? 409
    : /不存在|缺少 PDF|索引文件不存在/.test(message) ? 404
      : /路径|文件夹|PDF|SHA-256|文件名|请求内容|超出|格式|索引|指纹|大小|凭据|密钥文件|系统请/.test(message) ? 400
        : 500;
  return json({ error: status === 500 ? "本地知识库操作失败，请检查文件夹权限与服务端日志" : message }, status);
}

export async function handleLocalLibrary(
  request: Request,
  options: LocalLibraryRequestOptions,
  service: ReturnType<typeof createLocalLibraryService>,
): Promise<Response> {
  const authError = authorizeLocalModelRequest(request, options.token);
  if (authError) return authError;
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, "");
  try {
    if (request.method === "GET" && route === LOCAL_LIBRARY_PATH) return json(service.snapshot());
    if (request.method === "POST" && route === LOCAL_LIBRARY_PATH) {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "需要 JSON 路径配置" }, 415);
      const body = await readJsonBody(request) as Record<string, unknown> | null;
      return json(await service.selectPath(body?.path, options.validateCredentials));
    }
    if (request.method === "POST" && route === `${LOCAL_LIBRARY_PATH}/browse`) return json({ path: await service.browse() });
    if (request.method === "GET" && route === `${LOCAL_LIBRARY_PATH}/papers`) return json({ papers: service.snapshot().papers });
    if (request.method === "POST" && route === `${LOCAL_LIBRARY_PATH}/papers`) {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/pdf") return json({ error: "需要 PDF 二进制内容" }, 415);
      const bytes = await readBinaryBody(request);
      return json(service.savePaper({
        filename: url.searchParams.get("filename"),
        sha256: request.headers.get("x-agentflow-paper-sha256"),
        bytes,
      }));
    }
    const prefix = `${LOCAL_LIBRARY_PATH}/papers/`;
    if (request.method === "GET" && route.startsWith(prefix)) {
      const sha256 = decodeURIComponent(route.slice(prefix.length));
      const { paper, bytes } = service.readPaper(sha256);
      const fallback = `paper-${sha256.slice(0, 12)}.pdf`;
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(paper.filename)}`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return json({ error: "本地知识库接口不存在" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

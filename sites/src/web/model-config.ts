import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { MODEL_CONFIG_PATH } from "./model-config-path.ts";
import { MODEL_KEY_FILENAME } from "./local-library-path.ts";

export { MODEL_CONFIG_PATH };
const MODEL_KEY_FILE = MODEL_KEY_FILENAME;
export const KEY_FILE_MODE = 0o600;
const MAX_KEY_BYTES = 256 * 1024;
const MAX_SERVICES = 20;
const MAX_MODELS = 1000;

export interface ModelServiceInput {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export interface StoredModelService {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

interface KeyFile {
  version: 1;
  services: StoredModelService[];
  activeServiceId: string | null;
}

export interface PublicModelService {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfigSnapshot {
  services: PublicModelService[];
  activeServiceId: string | null;
}

export interface ModelConfigDeps {
  filePath?: string;
  encryptionKey?: string;
  now?: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ResolvedConfig {
  baseUrl: URL;
  service: StoredModelService;
}

function keyFileKey(): string {
  const configured = process.env.AGENTFLOW_MODEL_KEYS_KEY?.trim();
  if (configured) return configured;
  return readFileSync(join(process.cwd(), ".agentflow-model-keys.key"), "utf8").trim();
}

function encryptionKey(explicit = ""): Buffer {
  const encryption = explicit || process.env.AGENTFLOW_MODEL_KEYS_KEY || keyFileKey();
  return createHash("sha256").update(`agentflow-model-config:${encryption}`).digest();
}

function readKeyFile(filePath: string): KeyFile {
  let raw: string;
  try {
    if (statSync(filePath).size > MAX_KEY_BYTES) throw new Error("模型凭据文件超出大小限制");
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, services: [], activeServiceId: null };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("模型凭据文件格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型凭据文件格式无效");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.services) || record.services.length > MAX_SERVICES) {
    throw new Error("模型凭据文件格式无效");
  }
  const storedServices = record.services as unknown[];
  const ids = new Set<string>();
  for (const value of storedServices) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型凭据文件包含无效记录");
    const service = value as Record<string, unknown>;
    if (
      typeof service.id !== "string" || !service.id || service.id.length > 100 || ids.has(service.id) ||
      typeof service.name !== "string" || !service.name || Array.from(service.name).length > 80 ||
      typeof service.baseUrl !== "string" || !service.baseUrl || Array.from(service.baseUrl).length > 500 ||
      typeof service.apiKey !== "string" || !service.apiKey || Array.from(service.apiKey).length > 16_000 ||
      typeof service.model !== "string" || Array.from(service.model).length > 200 ||
      typeof service.createdAt !== "string" || typeof service.updatedAt !== "string"
    ) throw new Error("模型凭据文件包含无效记录");
    ids.add(service.id);
  }
  const services = storedServices as StoredModelService[];
  const activeServiceId = typeof record.activeServiceId === "string" &&
    services.some((service) => service.id === record.activeServiceId && service.model)
    ? record.activeServiceId
    : services.find((service) => service.model)?.id ?? null;
  return { version: 1, services, activeServiceId };
}

function writeKeyFile(filePath: string, value: KeyFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: KEY_FILE_MODE, flag: "wx" });
  renameSync(temporary, filePath);
}

function encryptKey(value: string, explicitKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(explicitKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptKey(value: string, explicitKey: string): string {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("模型凭据无法解密");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(explicitKey), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("模型凭据无法解密，请检查本机密钥文件");
  }
}

function checkedBaseUrl(raw: string): URL {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value.replace(/\/+$/, ""));
  } catch {
    throw new Error("Base URL 必须是完整的 HTTP(S) 地址");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Base URL 只支持 HTTP(S)");
  if (url.username || url.password || url.hash || url.search) throw new Error("Base URL 不能包含凭据、查询参数或片段");
  if (url.pathname === "/" && value.endsWith("/")) url.pathname = "";
  if (url.hostname.includes("%")) throw new Error("Base URL 主机名无效");
  return url;
}

export function modelEndpoint(baseUrl: string, kind: "models" | "chat"): string {
  const endpoint = checkedBaseUrl(baseUrl);
  const path = endpoint.pathname.replace(/\/+$/, "");
  if (kind === "models") {
    endpoint.pathname = path
      ? path.endsWith("/models") ? path : `${path}/models`
      : "/v1/models";
  } else {
    endpoint.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  }
  return endpoint.href;
}

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > max) {
    throw new Error(`${label}不能为空且不能超过 ${max} 个字符`);
  }
  return value.trim();
}

export function maskApiKey(value: string): string {
  if (!value) return "";
  const points = Array.from(value);
  if (points.length <= 8) return "••••••••";
  return `${points.slice(0, 3).join("")}••••••••${points.slice(-4).join("")}`;
}

export function publicService(service: StoredModelService): PublicModelService {
  return {
    id: service.id,
    name: service.name,
    baseUrl: service.baseUrl,
    model: service.model,
    hasApiKey: Boolean(service.apiKey),
    apiKeyHint: maskApiKey(service.apiKey),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function decodeModels(payload: unknown): string[] {
  const data = payload?.data;
  if (!Array.isArray(data)) throw new Error("模型列表响应缺少 data 数组");
  if (data.length > MAX_MODELS) throw new Error("模型列表响应数量超出限制");
  const models = [...new Set(data.map((entry) => typeof entry?.id === "string" ? entry.id.trim() : "")
    .filter((id) => id && Array.from(id).length <= 200))];
  if (data.length > 0 && !models.length) throw new Error("模型列表响应没有可用模型");
  return models.sort((a, b) => a.localeCompare(b));
}

function decodeChat(payload: unknown, fallback: string): { text: string; model: string } {
  const choice = payload?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim() || choice.finish_reason === "length") {
    throw new Error("模型 API 没有返回完整的对话内容");
  }
  return { text, model: typeof payload.model === "string" && payload.model ? payload.model : fallback };
}

function httpError(status: number): string {
  if (status === 401 || status === 403) return "模型服务鉴权失败，请检查 API Key 与访问权限";
  if (status === 404) return "模型接口地址不存在，请检查 Base URL";
  if (status === 429) return "模型服务请求过于频繁或额度不足，请稍后重试";
  if (status >= 500) return `模型服务暂时不可用（HTTP ${status}）`;
  return `模型服务返回 HTTP ${status}`;
}

async function requestUpstream(
  config: ResolvedConfig,
  kind: "models" | "chat",
  deps: ModelConfigDeps,
  body?: unknown,
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(modelEndpoint(config.service.baseUrl, kind), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${config.service.apiKey}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? (kind === "chat" ? 65_000 : 15_000)),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error("模型服务请求超时，请稍后重试");
    throw new Error("无法连接模型服务，请检查 Base URL 与网络");
  }
  if (upstream.status >= 300 && upstream.status < 400) throw new Error("模型服务返回重定向，已阻止跨地址请求");
  if (!upstream.ok) throw new Error(httpError(upstream.status));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    throw new Error("模型服务响应不是有效 JSON");
  }
  return payload;
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || !request.body) {
    throw new Error("请求必须使用 application/json");
  }
  const decoder = new TextDecoder();
  let json = "";
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > 64 * 1024) throw new Error("请求内容超出大小限制");
    json += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(json + decoder.decode());
}

function safeSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function blockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function blockedIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const parts = hostname.split(":");
  const first = parseInt(parts[0] || "0", 16);
  const second = parseInt(parts[1] || "0", 16);
  return first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 || (first === 0x100 && second === 0) ||
    (first === 0x2001 && second === 0x0db8);
}

function assertAllowedUpstream(baseUrl: URL): void {
  const hostname = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname)) return;
  if (blockedIpv4(hostname) || blockedIpv6(hostname)) throw new Error("不允许连接私网或保留地址模型服务");
  if (baseUrl.protocol !== "https:") throw new Error("云模型服务必须使用 HTTPS；本机服务可使用 HTTP");
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export function authorizeLocalModelRequest(request: Request, token = ""): Response | null {
  if (!safeSameOrigin(request)) return jsonError("请从同源工作台访问本地模型接口", 403);
  const expected = token.trim();
  if (expected) {
    const received = request.headers.get("x-agentflow-local-token") ?? "";
    const left = Buffer.from(received);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return jsonError("本地服务身份验证失败", 401);
  }
  return null;
}

export function createModelConfigService(options: ModelConfigDeps = {}) {
  const filePath = options.filePath ?? join(process.cwd(), MODEL_KEY_FILE);
  const explicitKey = options.encryptionKey ?? "";
  const now = options.now ?? (() => new Date().toISOString());

  async function load(): Promise<{ file: KeyFile; services: StoredModelService[] }> {
    const file = readKeyFile(filePath);
    return {
      file,
      services: file.services.map((service) => ({ ...service, apiKey: decryptKey(service.apiKey, explicitKey) })),
    };
  }

  function snapshot(file: KeyFile, activeServiceId: string | null): ModelConfigSnapshot {
    return {
      services: file.services.map((service) => publicService({ ...service, apiKey: decryptKey(service.apiKey, explicitKey) })),
      activeServiceId,
    };
  }

  function choose(config: StoredModelService[], activeServiceId: string | null): ResolvedConfig | null {
    const withModel = config.filter((service) => service.model);
    if (!withModel.length) return null;
    const service = withModel.find((item) => item.id === activeServiceId) ?? withModel[0];
    return { baseUrl: checkedBaseUrl(service.baseUrl), service };
  }

  async function list(): Promise<ModelConfigSnapshot> {
    const { file } = await load();
    return snapshot(file, file.activeServiceId);
  }

  async function save(value: unknown, serviceId?: string): Promise<ModelConfigSnapshot> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型服务配置无效");
    const input = value as Record<string, unknown>;
    const name = cleanText(input.name, "服务名称", 80);
    const baseUrl = cleanText(input.baseUrl, "Base URL", 500);
    assertAllowedUpstream(checkedBaseUrl(baseUrl));
    const keyInput = input.apiKey === undefined || input.apiKey === "" || input.apiKey === null
      ? ""
      : input.apiKey;
    const apiKey = keyInput === "" ? "" : cleanText(keyInput, "API Key", 4000);
    if (/[\r\n]/.test(apiKey)) throw new Error("API Key 不能包含换行");
    const model = input.model === undefined || input.model === null || input.model === ""
      ? ""
      : cleanText(input.model, "模型", 200);
    const { file, services } = await load();
    const existing = serviceId ? services.find((service) => service.id === serviceId) : null;
    if (serviceId && !existing) throw new Error("模型服务不存在");
    if (!serviceId && file.services.length >= MAX_SERVICES) throw new Error("最多保存 20 个模型服务");
    const stored: StoredModelService = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      baseUrl,
      apiKey: encryptKey(apiKey || existing?.apiKey || "", explicitKey),
      model: model || existing?.model || "",
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    if (!apiKey && !existing) throw new Error("首次保存必须填写 API Key");
    file.services = existing
      ? file.services.map((service) => service.id === existing.id ? stored : service)
      : [...file.services, stored];
    file.activeServiceId = stored.model
      ? stored.id
      : file.services.find((service) => service.model)?.id ?? null;
    writeKeyFile(filePath, file);
    return snapshot(file, file.activeServiceId);
  }

  async function remove(serviceId: string): Promise<ModelConfigSnapshot> {
    if (!serviceId || serviceId.length > 100) throw new Error("模型服务编号无效");
    const { file } = await load();
    if (!file.services.some((service) => service.id === serviceId)) throw new Error("模型服务不存在");
    file.services = file.services.filter((service) => service.id !== serviceId);
    file.activeServiceId = file.services.find((service) => service.model)?.id ?? null;
    writeKeyFile(filePath, file);
    return snapshot(file, file.activeServiceId);
  }

  async function models(serviceId: string): Promise<{ models: string[] }> {
    const { services } = await load();
    const service = services.find((item) => item.id === serviceId);
    if (!service) throw new Error("模型服务不存在");
    const config = { baseUrl: checkedBaseUrl(service.baseUrl), service };
    assertAllowedUpstream(config.baseUrl);
    return { models: decodeModels(await requestUpstream(config, "models", options)) };
  }

  async function complete(messages: Array<{ role: string; content: string }>, requestedModel: string | undefined): Promise<{ text: string; model: string; provider: string }> {
    if (!Array.isArray(messages) || !messages.length || messages.length > 100) throw new Error("模型消息无效");
    const { file, services } = await load();
    const config = choose(services, file.activeServiceId);
    if (!config) throw new Error("请先添加模型服务并选择模型");
    assertAllowedUpstream(config.baseUrl);
    if (requestedModel && requestedModel !== config.service.model) throw new Error("所选模型已变化，请刷新后重试");
    const payload = await requestUpstream(config, "chat", options, { model: config.service.model, messages });
    const result = decodeChat(payload, config.service.model);
    return { ...result, provider: config.service.name };
  }

  return { list, save, remove, models, complete };
}

export async function handleModelConfig(
  request: Request,
  options: ModelConfigDeps & { token?: string } = {},
  service = createModelConfigService(options),
): Promise<Response> {
  const authError = authorizeLocalModelRequest(request, options.token);
  if (authError) return authError;
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, "");
  try {
    if (request.method === "GET" && route === MODEL_CONFIG_PATH) {
      return Response.json(await service.list(), { headers: { "cache-control": "no-store" } });
    }
    if (request.method !== "POST" && request.method !== "DELETE") return jsonError("请求方法不支持", 405);
    const body = request.method === "POST" ? await readBody(request) : {};
    if (route === MODEL_CONFIG_PATH) {
      if (request.method !== "POST") return jsonError("保存配置请使用 POST", 405);
      const serviceId = body?.serviceId;
      if (serviceId !== undefined && (typeof serviceId !== "string" || !serviceId || serviceId.length > 100)) {
        return jsonError("模型服务编号无效", 400);
      }
      return Response.json(await service.save(body, serviceId), { headers: { "cache-control": "no-store" } });
    }
    if (route === `${MODEL_CONFIG_PATH}/models`) {
      if (request.method !== "POST") return jsonError("搜索模型请使用 POST", 405);
      const id = body?.serviceId;
      if (typeof id !== "string" || !id || id.length > 100) return jsonError("缺少模型服务编号", 400);
      return Response.json(await service.models(id), { headers: { "cache-control": "no-store" } });
    }
    if (route === `${MODEL_CONFIG_PATH}/complete`) {
      if (request.method !== "POST") return jsonError("模型调用请使用 POST", 405);
      const messages = body?.messages;
      if (!Array.isArray(messages) || messages.length > 100) return jsonError("模型消息无效", 400);
      if (body?.model !== undefined && typeof body.model !== "string") return jsonError("模型标识无效", 400);
      let bounded = 0;
      for (const message of messages) {
        if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
          return jsonError("模型消息角色或内容无效", 400);
        }
        bounded += Array.from(message.content).length;
        if (bounded > 128 * 1024) return jsonError("模型消息超出大小限制", 413);
      }
      const result = await service.complete(messages, body?.model);
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    }
    if (route.startsWith(`${MODEL_CONFIG_PATH}/`)) {
      if (request.method !== "DELETE") return jsonError("删除服务请使用 DELETE", 405);
      const id = decodeURIComponent(route.slice(MODEL_CONFIG_PATH.length + 1));
      return Response.json(await service.remove(id), { headers: { "cache-control": "no-store" } });
    }
    return jsonError("接口不存在", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /超时/.test(message)
      ? 504
      : message === "模型服务不存在"
        ? 404
        : /模型凭据|密钥文件/.test(message)
          ? 500
          : /JSON|Unexpected end|Expected property name|Unterminated|请求必须使用|请求内容超出|URI malformed|^(?:Base URL|API Key 不能包含|服务名称|模型不能为空|模型服务配置无效|模型服务编号无效|缺少模型服务编号|模型消息|模型标识|最多保存|首次保存|(?:云模型服务必须使用 HTTPS|不允许连接私网或保留地址))/.test(message)
            ? 400
            : /所选模型已变化/.test(message)
              ? 409
              : 502;
    return jsonError(message, status);
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelConfigService, handleModelConfig, maskApiKey, modelEndpoint, MODEL_CONFIG_PATH } from "../src/web/model-config.ts";
import { handlePaperModel } from "../src/web/paper-model-api.mjs";
import { createSameOriginModelAdapter } from "../src/web/model-adapter.ts";

const key = "a".repeat(64);
const secret = "sk-test-1234567890";
const origin = "http://127.0.0.1:8318";
const input = { name: "本地服务", baseUrl: "http://127.0.0.1/v1/", apiKey: secret };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "agentflow-model-config-"));
  return { dir, filePath: join(dir, ".model-keys.json") };
}

function request(path = MODEL_CONFIG_PATH, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("保存、读取、更新和删除：只回传脱敏状态，密钥以密文落服务端文件", async () => {
  const { dir, filePath } = fixture();
  try {
    const service = createModelConfigService({ filePath, encryptionKey: key, now: () => "2026-11-24T00:00:00Z" });
    const saved = await service.save(input);
    assert.equal(saved.services.length, 1);
    assert.equal(saved.services[0].hasApiKey, true);
    assert.equal(saved.services[0].apiKeyHint, maskApiKey(secret));
    assert.equal(saved.services[0].baseUrl, input.baseUrl);
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(secret));
    const disk = readFileSync(filePath, "utf8");
    assert.doesNotMatch(disk, new RegExp(secret));
    assert.match(disk, /v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/);
    if (process.platform !== "win32") assert.equal(statSync(filePath).mode & 0o777, 0o600);
    const reopened = await createModelConfigService({ filePath, encryptionKey: key }).list();
    assert.deepEqual(reopened, saved);
    const updated = await service.save({ name: "改名服务", baseUrl: input.baseUrl, model: "mock-model" }, saved.services[0].id);
    assert.equal(updated.services[0].name, "改名服务");
    assert.equal(updated.services[0].model, "mock-model");
    assert.equal(updated.activeServiceId, saved.services[0].id);
    let authorization = "";
    const upstream = createModelConfigService({ filePath, encryptionKey: key, fetchImpl: async (_url, init) => {
      authorization = new Headers(init.headers).get("authorization") ?? "";
      return Response.json({ data: [] });
    } });
    assert.deepEqual(await upstream.models(saved.services[0].id), { models: [] });
    assert.equal(authorization, `Bearer ${secret}`);
    await service.remove(saved.services[0].id);
    assert.deepEqual(await service.list(), { services: [], activeServiceId: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("多服务选中状态持久化，更新名称或密钥不会改变当前模型", async () => {
  const { dir, filePath } = fixture();
  try {
    const options = { filePath, encryptionKey: key };
    const service = createModelConfigService(options);
    const first = await service.save({ ...input, model: "first-model" });
    const second = await service.save({
      name: "第二个服务", baseUrl: "http://127.0.0.1:9998/v1", apiKey: "sk-second-1234567890", model: "second-model",
    });
    assert.equal(second.activeServiceId, second.services[1].id);
    const reopened = await createModelConfigService(options).list();
    assert.equal(reopened.activeServiceId, second.services[1].id);
    const updated = await service.save({ name: "第二个服务（改名）", baseUrl: "http://127.0.0.1:9998/v1" }, second.services[1].id);
    assert.equal(updated.activeServiceId, second.services[1].id);
    assert.equal(updated.services[1].model, "second-model");
    assert.equal(updated.services[1].hasApiKey, true);
    const switched = await service.save({ name: "第一个服务", baseUrl: input.baseUrl, model: "first-model" }, first.services[0].id);
    assert.equal(switched.activeServiceId, first.services[0].id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("URL 尾斜杠规范为 /v1/models 与 /v1/chat/completions", () => {
  assert.equal(modelEndpoint("https://api.example.com/v1///", "models"), "https://api.example.com/v1/models");
  assert.equal(modelEndpoint("https://api.example.com", "models"), "https://api.example.com/v1/models");
  assert.equal(modelEndpoint("https://api.example.com/v1/", "chat"), "https://api.example.com/v1/chat/completions");
  assert.equal(modelEndpoint("https://api.example.com/v1/chat/completions", "chat"), "https://api.example.com/v1/chat/completions");
  assert.equal(modelEndpoint("https://api.example.com/v1/models", "models"), "https://api.example.com/v1/models");
  assert.equal(modelEndpoint("http://127.0.0.1:9999//evil.invalid", "models"), "http://127.0.0.1:9999//evil.invalid/models");
  assert.equal(modelEndpoint("http://127.0.0.1:9999//evil.invalid", "chat"), "http://127.0.0.1:9999//evil.invalid/chat/completions");
  assert.throws(() => modelEndpoint("file:///tmp/models", "models"), /HTTP\(S\)/);
  assert.throws(() => modelEndpoint("https://user:pass@example.com/v1", "models"), /凭据/);
  assert.throws(() => modelEndpoint("https://example.com/v1?key=x", "models"), /查询参数/);
});

test("模型列表携带 Bearer 鉴权，异常响应、401、网络错误与超时分别可理解", async () => {
  const { dir, filePath } = fixture();
  try {
    const service = createModelConfigService({ filePath, encryptionKey: key });
    const saved = await service.save(input);
    const id = saved.services[0].id;
    const baseOptions = { filePath, encryptionKey: key };
    const success = createModelConfigService({ ...baseOptions, fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1/v1/models");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${secret}`);
      return Response.json({ data: [{ id: "mock-b" }, { id: "mock-a" }, { id: "mock-a" }] });
    } });
    assert.deepEqual(await success.models(id), { models: ["mock-a", "mock-b"] });
    const empty = createModelConfigService({ ...baseOptions, fetchImpl: async () => Response.json({ data: [] }) });
    assert.deepEqual(await empty.models(id), { models: [] });
    const noIds = createModelConfigService({ ...baseOptions, fetchImpl: async () => Response.json({ data: [{ id: "" }] }) });
    await assert.rejects(noIds.models(id), /没有可用模型/);
    const bad = createModelConfigService({ ...baseOptions, fetchImpl: async () => Response.json({ models: [] }) });
    await assert.rejects(bad.models(id), /data 数组/);
    const auth = createModelConfigService({ ...baseOptions, fetchImpl: async () => new Response(null, { status: 401 }) });
    await assert.rejects(auth.models(id), /鉴权失败/);
    const network = createModelConfigService({ ...baseOptions, fetchImpl: async () => { throw new TypeError("offline"); } });
    await assert.rejects(network.models(id), /无法连接/);
    const timeout = createModelConfigService({ ...baseOptions, timeoutMs: 5, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
    }) });
    await assert.rejects(timeout.models(id), /超时/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP 配置接口校验同源与本地令牌，读取响应不回传明文密钥", async () => {
  const { dir, filePath } = fixture();
  try {
    const options = { filePath, encryptionKey: key, token: "local-test-token" };
    const denied = await handleModelConfig(request(MODEL_CONFIG_PATH, "POST", input), options);
    assert.equal(denied.status, 401);
    const crossOrigin = await handleModelConfig(request(MODEL_CONFIG_PATH, "GET", undefined, { origin: "https://offsite.invalid" }), options);
    assert.equal(crossOrigin.status, 403);
    const headers = { "x-agentflow-local-token": "local-test-token" };
    const saved = await handleModelConfig(request(MODEL_CONFIG_PATH, "POST", input, headers), options);
    assert.equal(saved.status, 200);
    const text = await saved.text();
    assert.doesNotMatch(text, new RegExp(secret));
    const read = await handleModelConfig(request(MODEL_CONFIG_PATH, "GET", undefined, headers), options);
    assert.equal(read.status, 200);
    assert.match(read.headers.get("cache-control") ?? "", /no-store/);
    const snapshot = await read.json();
    assert.equal(snapshot.services[0].hasApiKey, true);
    assert.equal(snapshot.services[0].apiKey, undefined);
    const updated = await handleModelConfig(request(MODEL_CONFIG_PATH, "POST", {
      serviceId: snapshot.services[0].id, name: "更新服务", baseUrl: input.baseUrl, model: "mock-model",
    }, headers), options);
    assert.equal(updated.status, 200);
    const updatedSnapshot = await updated.json();
    assert.equal(updatedSnapshot.services.length, 1);
    assert.equal(updatedSnapshot.services[0].id, snapshot.services[0].id);
    assert.equal(updatedSnapshot.services[0].name, "更新服务");
    assert.equal(updatedSnapshot.activeServiceId, snapshot.services[0].id);
    const badJson = new Request(`${origin}${MODEL_CONFIG_PATH}`, { method: "POST", headers: { origin, ...headers, "content-type": "application/json" }, body: "{" });
    assert.equal((await handleModelConfig(badJson, options)).status, 400);
    const badModel = await handleModelConfig(request(`${MODEL_CONFIG_PATH}/complete`, "POST", {
      messages: [{ role: "user", content: "hello" }], model: 42,
    }, headers), options);
    assert.equal(badModel.status, 400);
    const badServiceId = await handleModelConfig(request(`${MODEL_CONFIG_PATH}/models`, "POST", {
      serviceId: "x".repeat(101),
    }, headers), options);
    assert.equal(badServiceId.status, 400);
    const blankName = await handleModelConfig(request(MODEL_CONFIG_PATH, "POST", { ...input, name: " " }, headers), options);
    assert.equal(blankName.status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("云 API 与本机服务边界：公网 HTTPS 可用，私网、保留地址和公网 HTTP 被阻止", async () => {
  const { dir, filePath } = fixture();
  try {
    const calls: string[] = [];
    const options = { filePath, encryptionKey: key, fetchImpl: async (url: string | URL | Request) => {
      calls.push(String(url));
      return String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "cloud-model" }] })
        : Response.json({ model: "mock-model", choices: [{ message: { content: "ok" } }] });
    } };
    const service = createModelConfigService(options);
    const saved = await service.save({ ...input, model: "mock-model" });
    const id = saved.services[0].id;
    const result = await service.complete([{ role: "user", content: "hello" }], "mock-model");
    assert.deepEqual(result, { text: "ok", model: "mock-model", provider: "本地服务" });
    assert.equal(calls[0], "http://127.0.0.1/v1/chat/completions");
    await assert.rejects(service.complete([{ role: "user", content: "hello" }], "other"), /已变化/);

    await service.save({ name: "云服务", baseUrl: "https://api.example.com/v1", apiKey: secret, model: "mock-model" }, id);
    assert.deepEqual(await service.models(id), { models: ["cloud-model"] });
    assert.equal(calls[1], "https://api.example.com/v1/models");
    assert.deepEqual(await service.complete([{ role: "user", content: "hello" }], "mock-model"), {
      text: "ok", model: "mock-model", provider: "云服务",
    });
    assert.equal(calls[2], "https://api.example.com/v1/chat/completions");

    await assert.rejects(service.save({ name: "公网 HTTP", baseUrl: "http://api.example.com/v1" }, id), /必须使用 HTTPS/);
    for (const baseUrl of [
      "https://10.0.0.1/v1", "https://192.168.1.2/v1", "https://169.254.169.254/v1",
      "https://0.0.0.0/v1", "https://[fd00::1]/v1", "https://[fe80::1]/v1", "https://[::ffff:127.0.0.1]/v1",
    ]) {
      await assert.rejects(service.save({ name: "私网", baseUrl }, id), /私网或保留地址/);
    }

    await service.save({ name: "本机自定义端口", baseUrl: "http://127.0.0.1:9999/v1", apiKey: secret, model: "mock-model" }, id);
    await service.complete([{ role: "user", content: "hello" }], "mock-model");
    assert.equal(calls[3], "http://127.0.0.1:9999/v1/chat/completions");
    assert.equal(calls.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("论文模型与浏览器适配器复用同一配置服务，不重复实现模型调用", async () => {
  const { dir, filePath } = fixture();
  try {
    let calls = 0;
    const service = createModelConfigService({ filePath, encryptionKey: key, fetchImpl: async () => {
      calls++;
      return Response.json({ model: "mock-model", choices: [{ message: { content: "candidate" } }] });
    } });
    await service.save({ ...input, model: "mock-model" });
    const paperBody = {
      title: "本地论文", previous: [], passages: [{ page: 1, text: "This is a sufficiently long paper sentence." }],
    };
    const paperOptions = { filePath, encryptionKey: key, token: "paper-local-token" };
    const denied = await handlePaperModel(request("/functions/v1/app/paper-questions", "POST", paperBody), paperOptions, service);
    assert.equal(denied.status, 401);
    const paperResponse = await handlePaperModel(request("/functions/v1/app/paper-questions", "POST", paperBody, {
      "x-agentflow-local-token": "paper-local-token",
    }), paperOptions, service);
    assert.equal(paperResponse.status, 200);
    assert.deepEqual(await paperResponse.json(), { text: "candidate", model: "mock-model" });
    const adapter = createSameOriginModelAdapter(async (url, init) => {
      if (String(url) === "/__agentflow_local.json") return Response.json({ token: "local" });
      assert.equal(String(url), `${MODEL_CONFIG_PATH}/complete`);
      assert.equal(new Headers(init.headers).get("x-agentflow-local-token"), "local");
      return Response.json({ text: "ok", model: "mock-model", provider: "本地服务" });
    });
    const parsed = await adapter.parse({ systemPrompt: "system", promptVersion: "v1", rawClaim: "提高 2 个百分点", fieldDict: { factors: ["augmentation"], metrics: ["accuracy"], scopes: ["target_lr"] } });
    assert.equal(parsed.provider, "本地服务");
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏的凭据文件与错误密钥如实失败，不以空配置伪装", async () => {
  const { dir, filePath } = fixture();
  try {
    writeFileSync(filePath, "not json");
    await assert.rejects(createModelConfigService({ filePath, encryptionKey: key }).list());
    rmSync(filePath);
    const service = createModelConfigService({ filePath, encryptionKey: key });
    await service.save(input);
    await assert.rejects(createModelConfigService({ filePath, encryptionKey: "b".repeat(64) }).list(), /无法解密/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

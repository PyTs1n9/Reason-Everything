import assert from "node:assert/strict";
import test from "node:test";
import { createDataService, MemoryBackend } from "../src/experiment/storage.ts";
import { handlePaperModel } from "../src/web/paper-model-api.mjs";
import { createModelConfigService } from "../src/web/model-config.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPaperPages, generatePaperCandidates, PAPER_MODEL_PATH, type PaperSource } from "../src/web/paper-study.ts";

const intro = "The study used a single supervised corpus.";
const limitation = "The results were observed only on short documents.";
const paper: PaperSource = {
  title: "A synthetic study",
  filename: "paper.pdf",
  sha256: "a".repeat(64),
  pages: [intro, "", `Limitations\n${limitation}`],
};
const candidate = {
  question: "方法能推广到长文档吗？",
  claim: "篇幅增加可能降低方法的表现。",
  rationale: "现有评估只覆盖短文档。",
  verification: "固定训练语料，按文档长度分组比较。",
  citations: [{ page: 3, quote: limitation }],
};
const model = "mock-paper";
const keyDir = mkdtempSync(join(tmpdir(), "agentflow-paper-model-"));
const keyFile = join(keyDir, ".model-keys.json");
process.on("exit", () => rmSync(keyDir, { recursive: true, force: true }));
const reply = (candidates: unknown[]) => ({ model, text: JSON.stringify({ candidates }) });

test("PDF 提取读至末页，保留空页和原文行间断行", async () => {
  const pages = await extractPaperPages({
    numPages: 3,
    async getPage(page) {
      const items = page === 1 ? [{ str: intro }] : page === 2 ? [{}] : [{ str: "Limitations", hasEOL: true }, { str: limitation }];
      return { getTextContent: async () => ({ items }) };
    },
  });
  assert.deepEqual(pages, paper.pages);
});

test("模型读取全文并保留 PDF 物理页码，候选引文回存该页原文", async () => {
  const source = { ...paper, pages: [intro, "", limitation.replace("only on", "only\non")] };
  const generated = await generatePaperCandidates(source, async ({ passages, previous }) => {
    assert.deepEqual(passages, [{ page: 1, text: intro }, { page: 3, text: source.pages[2] }]);
    assert.deepEqual(previous, []);
    return reply([candidate, { ...candidate, question: "方法能推广到长文档吗?" }]);
  });
  assert.deepEqual(generated, {
    model,
    candidates: [{ ...candidate, citations: [{ page: 3, quote: source.pages[2] }] }],
  });
});

test("长论文分批覆盖末尾内容，后续批次可保留此前核验过的引文", async () => {
  const early = { ...candidate, citations: [{ page: 1, quote: intro }] };
  const page = "段落🙂".repeat(3500) + limitation;
  const long = { ...paper, pages: [intro, "", page] };
  const calls: Array<{ page: number; text: string }> = [];
  const progress: number[] = [];
  const result = await generatePaperCandidates(long, async ({ passages, previous }) => {
    assert.deepEqual(previous, calls.length ? [early] : []);
    calls.push(...passages);
    if (passages.at(-1)?.text.endsWith(limitation)) {
      return reply([{ ...candidate, citations: [...early.citations, ...candidate.citations] }]);
    }
    return reply([early]);
  }, (batch) => progress.push(batch));
  assert.ok(progress.length > 1);
  assert.ok(calls.every(({ text }) => text.isWellFormed()));
  assert.ok(calls.at(-1)?.text.endsWith(limitation));
  assert.deepEqual(result.candidates[0]?.citations, [...early.citations, ...candidate.citations]);
});

test("拒绝模型编造的页码、跨页和拼接引文，空列表可重试", async () => {
  for (const citation of [
    { page: 1, quote: limitation },
    { page: 3, quote: `${intro} ${limitation}` },
    { page: 4, quote: limitation },
    { page: 3, quote: "Source quote fabricated by the model." },
  ]) {
    await assert.rejects(generatePaperCandidates(paper, async () => reply([{ ...candidate, citations: [citation] }])), /无法回查原文/);
  }
  await assert.rejects(generatePaperCandidates(paper, async () => reply([{ ...candidate, citations: [] }])), /需要 1 到 3 条引文/);
  assert.deepEqual(await generatePaperCandidates(paper, async () => reply([])), { model, candidates: [] });
});

test("入库后正文可重读，候选经人工编辑确认才创建问题，重复确认幂等", async () => {
  const backend = new MemoryBackend();
  const data = createDataService(backend);
  const alice = { userId: "alice" };
  const bob = { userId: "bob" };
  const now = "2026-11-24T00:00:00Z";
  await assert.rejects(data.importPaper(alice, { name: "空页", paper: { ...paper, pages: [""] }, now }), /没有可入库的文字/);
  assert.deepEqual(await data.listProjects(alice), []);
  const { projectId } = await data.importPaper(alice, { name: "论文项目", paper, now });
  const reopened = createDataService(backend);
  const before = await reopened.getPaperStudy(alice, projectId);
  assert.deepEqual(before?.pages, paper.pages);
  assert.equal(before?.generation, null);
  await assert.rejects(reopened.getPaperStudy(bob, projectId), /项目不存在/);
  await data.savePaperCandidates(alice, projectId, { model, candidates: [] });
  const saved = await data.savePaperCandidates(alice, projectId, { model, candidates: [candidate] });
  const draft = saved.generation?.candidates[0];
  assert.ok(draft);
  assert.deepEqual(await reopened.listQuestions(alice, projectId), []);
  const input = { projectId, candidateId: draft.id, question: "这套方法对长篇文档的准确率如何？", now };
  const [accepted, repeated] = await Promise.all([data.acceptPaperCandidate(alice, input), reopened.acceptPaperCandidate(alice, input)]);
  assert.deepEqual(accepted, repeated);
  assert.equal(accepted.rawClaim, input.question);
  assert.equal(accepted.confirmedClaim, null);
  assert.equal((await reopened.listQuestions(alice, projectId)).length, 1);
  const late = await data.savePaperCandidates(alice, projectId, { model, candidates: [] });
  assert.equal(late.generation?.candidates[0]?.questionId, accepted.questionId);
  assert.deepEqual(late.generation?.candidates[0]?.citations, candidate.citations);
  await data.deleteProject(alice, projectId);
  assert.deepEqual((await backend.read(alice)).paperStudies, []);
});

test("旧项目补录全文时保留项目和已有问题，同一份 PDF 重试可复用", async () => {
  const data = createDataService(new MemoryBackend());
  const actor = { userId: "local" };
  const now = "2026-11-24T00:00:00Z";
  const { projectId } = await data.createProject(actor, "已有项目", now);
  const question = await data.createQuestion(actor, { projectId, questionId: "old", now, rawClaim: "旧主张", confirmedClaim: null });
  assert.equal(await data.getPaperStudy(actor, projectId), null);
  const input = { projectId, name: paper.title, paper, now };
  const updated = await data.importPaper(actor, input);
  assert.equal(updated.name, "已有项目");
  assert.deepEqual(await data.importPaper(actor, input), updated);
  const second = { ...paper, title: "第二篇论文", filename: "second.pdf", sha256: "b".repeat(64) };
  await data.importPaper(actor, { ...input, paper: second });
  assert.equal((await data.listPaperStudies(actor, projectId)).length, 2);
  assert.equal((await data.getPaperStudy(actor, projectId))?.sha256, paper.sha256);
  assert.deepEqual(await data.listQuestions(actor, projectId), [question]);
});

const local = `http://127.0.0.1:8318${PAPER_MODEL_PATH}`;
function makeRequest(origin = "http://127.0.0.1:8318", body: unknown = { title: paper.title, previous: [], passages: [{ page: 3, text: limitation }] }) {
  return new Request(local, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("服务端调用兼容模型 API，提示词与密钥由服务端提供", async () => {
  const service = createModelConfigService({ filePath: keyFile, encryptionKey: "test-key", fetchImpl: async (url: string, init: RequestInit) => {
    assert.equal(url, "http://127.0.0.1/v1/chat/completions");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer mock-secret");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.model, model);
    assert.match(payload.messages[0].content, /物理 PDF 页码/);
    assert.match(payload.messages[1].content, /short documents/);
    return Response.json({ model, choices: [{ message: { content: reply([candidate]).text } }] });
  } });
  await service.save({ name: "mock", baseUrl: "http://127.0.0.1/v1", apiKey: "mock-secret", model });
  const response = await handlePaperModel(makeRequest(), { filePath: keyFile, encryptionKey: "test-key" }, service);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), reply([candidate]));
});

test("模型接口如实区分未配置、坏输入、同源拒绝和服务失败", async () => {
  const missingFile = join(keyDir, "missing-model-config.json");
  assert.equal((await handlePaperModel(makeRequest(), {}, createModelConfigService({ filePath: missingFile, encryptionKey: "test" }))).status, 503);
  assert.equal((await handlePaperModel(makeRequest("https://offsite.invalid"), {}, createModelConfigService({ filePath: missingFile, encryptionKey: "test" }))).status, 403);
  assert.equal((await handlePaperModel(makeRequest(undefined, { title: "x", passages: [] }), {}, createModelConfigService({ filePath: keyFile, encryptionKey: "test-key" }))).status, 400);
  const unavailable = await handlePaperModel(makeRequest(), { filePath: missingFile, encryptionKey: "test" }, {
    list: async () => ({ services: [], activeServiceId: "configured" }),
    complete: async () => { throw new Error("模型服务返回 HTTP 429"); },
  });
  assert.equal(unavailable.status, 502);
  assert.match((await unavailable.json()).error, /HTTP 429/);
});

test("论文模型使用所选服务的同源调用，未配置时不发请求", async () => {
  const configured = {
    list: async () => ({ services: [{ id: "s1", model: "mock-paper" }], activeServiceId: "s1" }),
    complete: async (messages: unknown[], model: string) => {
      assert.equal(model, "mock-paper");
      assert.match(JSON.stringify(messages), /short documents/);
      return { text: reply([candidate]).text, model };
    },
  };
  const response = await handlePaperModel(makeRequest(), {}, configured);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), reply([candidate]));
  const missing = await handlePaperModel(makeRequest(), {}, { list: async () => ({ services: [], activeServiceId: null }) });
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /请先在模型服务中添加服务/);
});

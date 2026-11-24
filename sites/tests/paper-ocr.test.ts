import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

import { locateAll } from "../src/core/grounding.ts";
import { createDataService, MemoryBackend } from "../src/experiment/storage.ts";
import { locateInRegions, locateInTextItems, paperTextFromItems } from "../src/web/paper-locate.ts";
import { handlePaperOcr, runWindowsOcr } from "../src/web/paper-ocr-api.mjs";
import {
  ocrPageText,
  pagesNeedingOcr,
  paperPageSource,
  PAPER_OCR_PATH,
  readOcrRequest,
  readOcrResult,
  requestPaperOcr,
  toPaperRegions,
} from "../src/web/paper-ocr.ts";
import { generatePaperCandidates, type PaperSource } from "../src/web/paper-study.ts";

const image = "data:image/png;base64,iVBORw0KGgo=";
const input = { page: 2, image, width: 1000, height: 800, rotation: 0 };
const ocrResult = {
  text: "Recognized words from the scanned page.",
  width: 1000,
  height: 800,
  regions: [
    { text: "Recognized", box: { left: 100, top: 120, width: 180, height: 40 } },
    { text: "words", box: { left: 300, top: 120, width: 90, height: 40 } },
    { text: "page.", box: { left: 100, top: 180, width: 80, height: 40 } },
  ],
};

function makeRequest(body: unknown = input, origin = "http://127.0.0.1:8318") {
  return new Request(`http://127.0.0.1:8318${PAPER_OCR_PATH}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("OCR 请求与响应校验图片、尺寸、旋转和区域边界", () => {
  assert.deepEqual(readOcrRequest(input), input);
  assert.throws(() => readOcrRequest({ ...input, page: 0 }), /页码/);
  assert.throws(() => readOcrRequest({ ...input, image: "https://example.invalid/page.png" }), /PNG 或 JPEG/);
  assert.throws(() => readOcrRequest({ ...input, width: 12_001 }), /尺寸/);
  assert.throws(() => readOcrRequest({ ...input, rotation: 361 }), /旋转/);
  assert.throws(() => readOcrResult({ ...ocrResult, regions: [{ text: "x", box: { left: -1, top: 0, width: 1, height: 1 } }] }), /坐标/);
  assert.throws(() => readOcrResult({ ...ocrResult, regions: Array.from({ length: 20_001 }, () => ocrResult.regions[0]) }), /区域列表/);
});

test("OCR 文字由区域顺序重建，坐标归一化并裁剪到页面", () => {
  const result = readOcrResult(ocrResult);
  assert.equal(ocrPageText(result), "Recognized words page.");
  assert.deepEqual(toPaperRegions(result), [
    { text: "Recognized", x: 0.1, y: 0.15, width: 0.18, height: 0.05 },
    { text: "words", x: 0.3, y: 0.15, width: 0.09, height: 0.05 },
    { text: "page.", x: 0.1, y: 0.225, width: 0.08, height: 0.05 },
  ]);
  const clipped = toPaperRegions(readOcrResult({
    ...ocrResult,
    regions: [{ text: "edge", box: { left: 990, top: 790, width: 100, height: 100 } }],
  }));
  assert.deepEqual(clipped, [{ text: "edge", x: 0.99, y: 0.9875, width: 0.01, height: 0.0125 }]);
});

test("逐页来源保留物理页序，仅待识别或失败页进入 OCR 队列", () => {
  const paper: PaperSource = {
    title: "Mixed paper",
    filename: "mixed.pdf",
    sha256: "a".repeat(64),
    pages: ["text layer", "", "old OCR text", ""],
    pageSources: ["text", "pending", "ocr", "failed"],
  };
  assert.deepEqual(paper.pages.map((_, index) => paperPageSource(paper, index)), ["text", "pending", "ocr", "failed"]);
  assert.deepEqual(pagesNeedingOcr(paper), [2, 4]);
  assert.deepEqual(pagesNeedingOcr({ ...paper, pageSources: undefined }), [2, 4]);
});

test("浏览器只调用同源 OCR 接口，并区分未接通、超时与空结果", async () => {
  const calls: string[] = [];
  const result = await requestPaperOcr(input, async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(ocrResult);
  });
  assert.deepEqual(calls, [PAPER_OCR_PATH]);
  assert.equal(result.text, "Recognized words page.");
  await assert.rejects(requestPaperOcr(input, async () => new Response("missing", { status: 404 })), /接口未接通/);
  await assert.rejects(requestPaperOcr(input, async () => Response.json({ error: "OCR 请求超时，可单页重试" }, { status: 504 })), /超时/);
  await assert.rejects(requestPaperOcr(input, async () => Response.json({ ...ocrResult, text: "", regions: [] })), /未识别到文字/);
});

test("OCR 服务端拒绝跨源与错误方法，未配置时返回 503", async () => {
  const config = { localWindows: false };
  assert.equal((await handlePaperOcr(new Request(`http://127.0.0.1:8318${PAPER_OCR_PATH}`), config)).status, 405);
  assert.equal((await handlePaperOcr(makeRequest(input, "https://offsite.invalid"), config)).status, 403);
  const missing = await handlePaperOcr(makeRequest(), config);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /原版页面仍可查看/);
  const badType = await handlePaperOcr(new Request(`http://127.0.0.1:8318${PAPER_OCR_PATH}`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8318" }, body: "{}",
  }), { localWindows: true });
  assert.equal(badType.status, 415);
});

test("OCR 仅调用本机适配器，忽略外部地址与密钥配置", async () => {
  let localInput: unknown = null;
  const response = await handlePaperOcr(makeRequest(), {
    url: "https://ocr.example.invalid/recognize",
    key: "server-only-secret",
    localWindows: true,
    scriptPath: "ocr-windows.ps1",
  }, async (value) => {
    localInput = value;
    return readOcrResult(ocrResult);
  });
  assert.deepEqual(localInput, input);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.regions.length, 3);
  assert.equal(JSON.stringify(body).includes("server-only-secret"), false);
});

test("本机 OCR 失败与超时返回可重试状态，不泄露执行详情", async () => {
  const config = { localWindows: true, scriptPath: "ocr-windows.ps1" };
  const failed = await handlePaperOcr(makeRequest(), config, async () => {
    throw new Error("local secret");
  });
  assert.equal(failed.status, 502);
  const failedBody = await failed.json();
  assert.match(failedBody.error, /本机 OCR 识别失败/);
  assert.doesNotMatch(JSON.stringify(failedBody), /local secret/);
  const timeout = await handlePaperOcr(makeRequest(), config, async () => {
    throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  });
  assert.equal(timeout.status, 504);
  assert.match((await timeout.json()).error, /单页重试/);
});

test("本机 OCR 适配器可注入，Windows 脚本读取临时图片后清理", async () => {
  let localInput: unknown = null;
  const local = await handlePaperOcr(makeRequest(), { localWindows: true, scriptPath: "ocr-windows.ps1" }, async (value) => {
    localInput = value;
    return readOcrResult(ocrResult);
  });
  assert.equal(local.status, 200);
  assert.deepEqual(localInput, input);

  let scriptPath = "";
  let commandPath = "";
  const windowsResult = await runWindowsOcr(input, { scriptPath: "C:\\AgentFlow\\ocr-windows.ps1" }, async (command, args) => {
    assert.equal(command, "powershell.exe");
    assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
    scriptPath = args[4];
    commandPath = args[6];
    assert.equal(existsSync(commandPath), true);
    return { stdout: JSON.stringify(ocrResult), stderr: "" };
  });
  assert.equal(scriptPath, "C:\\AgentFlow\\ocr-windows.ps1");
  assert.equal(existsSync(commandPath), false);
  assert.equal(windowsResult.regions.length, 3);
});

test("引文定位返回所有匹配，包含重叠位置并按码点偏移", () => {
  assert.deepEqual(locateAll("aaaa", "aa"), [[0, 2], [1, 3], [2, 4]]);
  assert.deepEqual(locateAll("a\nb a b", "a b"), [[0, 3], [4, 7]]);
  assert.deepEqual(locateAll("🙂 alpha", "🙂 alpha"), [[0, 7]]);
  assert.deepEqual(locateAll("   ", "x"), []);
});

test("文字层跨行引文映射为多个矩形，提取文本与定位文本一致", () => {
  const items = [
    { str: "Alpha beta", transform: [1, 0, 0, 1, 10, 80], width: 20, height: 10 },
    { str: "gamma delta", hasEOL: true, transform: [1, 0, 0, 1, 10, 50], width: 30, height: 10 },
  ];
  assert.equal(paperTextFromItems(items), "Alpha beta gamma delta");
  const located = locateInTextItems(items, "beta\ngamma", { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(located.precision, "exact");
  assert.equal(located.rects.length, 2);
  close(located.rects[0].x, 0.05);
  close(located.rects[0].y, 0.8);
  close(located.rects[1].x, 0.05);
  close(located.rects[1].y, 0.5);
});

test("旋转与缩放视口使用仿射变换，归一化高亮位置保持稳定", () => {
  const items = [{ str: "rotated quote", transform: [1, 0, 0, 1, 10, 80], width: 20, height: 5 }];
  const located = locateInTextItems(items, "rotated quote", { width: 200, height: 100, transform: [0, 1, -1, 0, 100, 0] });
  assert.equal(located.precision, "exact");
  close(located.rects[0].x, 0.075);
  close(located.rects[0].y, 0.1);
  close(located.rects[0].width, 0.025);
  close(located.rects[0].height, 0.2);
  const base = locateInTextItems(items, "rotated quote", { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] });
  const scaled = locateInTextItems(items, "rotated quote", { width: 400, height: 200, transform: [2, 0, 0, 2, 0, 0] });
  close(scaled.rects[0].x, base.rects[0].x);
  close(scaled.rects[0].y, base.rects[0].y);
  close(scaled.rects[0].width, base.rects[0].width);
  close(scaled.rects[0].height, base.rects[0].height);
});

test("PDF.js 字号不重复缩放，文本项宽高按页面单位映射", () => {
  const items = [{ str: "PDF.js text item", transform: [16, 0, 0, 16, 72, 720], width: 240.08, height: 16 }];
  const located = locateInTextItems(items, "PDF.js text item", { width: 612, height: 792, transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(located.precision, "exact");
  close(located.rects[0].x, 72 / 612);
  close(located.rects[0].y, 720 / 792);
  close(located.rects[0].width, 240.08 / 612);
  close(located.rects[0].height, 16 / 792);
});

test("高亮覆盖字形上升区域，匹配 PDF.js 正向与旋转视口", () => {
  const item = { str: "baseline text", transform: [16, 0, 0, 16, 72, 720], width: 240.08, height: 16 };
  const upright = locateInTextItems([item], item.str, { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] });
  close(upright.rects[0].y, 56 / 792);
  close(upright.rects[0].height, 16 / 792);
  const rotated = locateInTextItems([{ ...item, transform: [16, 0, 0, 16, 72, 690] }], item.str, { width: 792, height: 612, transform: [0, 1, 1, 0, 0, 0] });
  close(rotated.rects[0].x, 690 / 792);
  close(rotated.rects[0].y, 72 / 612);
  close(rotated.rects[0].width, 16 / 792);
  close(rotated.rects[0].height, 240.08 / 612);
});

test("重复摘录或缺少坐标时退回页级精度，不伪造高亮", () => {
  const duplicate = [
    { str: "same quote", transform: [1, 0, 0, 1, 10, 80], width: 20, height: 5 },
    { str: "same quote", transform: [1, 0, 0, 1, 10, 50], width: 20, height: 5 },
  ];
  const repeated = locateInTextItems(duplicate, "same quote", { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(repeated.precision, "page");
  assert.equal(repeated.matchCount, 2);
  assert.deepEqual(repeated.rects, []);
  assert.match(repeated.reason, /2 处/);
  const missing = locateInTextItems([{ str: "same quote" }], "same quote", { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(missing.precision, "page");
  assert.match(missing.reason, /没有可用坐标/);
});

test("OCR 区域支持跨词与跨行摘录，并返回对应区域矩形", () => {
  const regions = toPaperRegions(readOcrResult(ocrResult));
  const located = locateInRegions(regions, "Recognized words");
  assert.equal(located.precision, "exact");
  assert.deepEqual(located.rects, regions.slice(0, 2).map(({ x, y, width, height }) => ({ x, y, width, height })));
  const acrossLine = locateInRegions(regions, "words page.");
  assert.equal(acrossLine.precision, "exact");
  assert.deepEqual(acrossLine.rects, regions.slice(1).map(({ x, y, width, height }) => ({ x, y, width, height })));
});

test("扫描 PDF 字节与逐页 OCR 结果可跨服务实例读取，失败重试保留其他页", async () => {
  const backend = new MemoryBackend();
  const actor = { userId: "ocr-user" };
  const now = "2026-11-24T00:00:00Z";
  const bytes = new Uint8Array([37, 80, 68, 70, 45]);
  const paper: PaperSource = {
    title: "Scanned paper",
    filename: "scanned.pdf",
    sha256: "b".repeat(64),
    pages: ["", "Text layer page", ""],
    pageSources: ["pending", "text", "pending"],
  };
  const data = createDataService(backend);
  const { projectId } = await data.importPaper(actor, { name: "扫描项目", paper, now, file: { filename: paper.filename, sha256: paper.sha256, bytes } });
  const reopened = createDataService(backend);
  assert.deepEqual((await reopened.getPaperFile(actor, projectId, paper.sha256))?.bytes, bytes);
  const first = await reopened.updatePaperPageOcr(actor, {
    projectId, sha256: paper.sha256, now,
    update: { page: 1, ok: true, text: "第一页识别文字", regions: [{ text: "第一页识别文字", x: 0.1, y: 0.2, width: 0.3, height: 0.1 }] },
  });
  assert.equal(first.pageSources?.[0], "ocr");
  await reopened.updatePaperPageOcr(actor, {
    projectId, sha256: paper.sha256, now,
    update: { page: 3, ok: false, error: "OCR 请求超时" },
  });
  const failed = await reopened.getPaperStudy(actor, projectId, paper.sha256);
  assert.equal(failed?.pageSources?.[2], "failed");
  assert.equal(failed?.pageErrors?.[2], "OCR 请求超时");
  assert.equal(failed?.pages[1], "Text layer page");
  const retried = await reopened.updatePaperPageOcr(actor, {
    projectId, sha256: paper.sha256, now,
    update: { page: 3, ok: true, text: "第三页识别文字", regions: [] },
  });
  assert.equal(retried.pageSources?.[2], "ocr");
  assert.equal(retried.pageErrors?.[2], "");
  assert.equal(retried.pages[0], "第一页识别文字");
  await assert.rejects(reopened.updatePaperPageOcr(actor, {
    projectId, sha256: paper.sha256, now, update: { page: 4, ok: false, error: "越界" },
  }), /页数/);
  await reopened.deleteProject(actor, projectId);
  assert.deepEqual((await backend.read(actor)).paperFiles, []);
});

test("旧文字项目补传原 PDF 不丢失问题、候选引文或已确认关系", async () => {
  const data = createDataService(new MemoryBackend());
  const actor = { userId: "legacy-user" };
  const now = "2026-11-24T00:00:00Z";
  const paper: PaperSource = {
    title: "Legacy paper", filename: "legacy.pdf", sha256: "c".repeat(64), pages: ["A verified source sentence."],
  };
  const { projectId } = await data.importPaper(actor, { name: "旧项目", paper, now });
  const candidate = {
    question: "这个结论在什么条件下成立？",
    claim: "结论可能依赖特定条件。",
    rationale: "需要检查适用范围。",
    verification: "更换条件重复实验。",
    citations: [{ page: 1, quote: "A verified source sentence." }],
  };
  const saved = await data.savePaperCandidates(actor, projectId, { model: "mock", candidates: [candidate] });
  const draft = saved.generation?.candidates[0];
  assert.ok(draft);
  const question = await data.acceptPaperCandidate(actor, { projectId, candidateId: draft.id, question: candidate.question, now });
  await data.importPaper(actor, {
    projectId, name: "旧项目", paper, now,
    file: { filename: paper.filename, sha256: paper.sha256, bytes: new Uint8Array([1, 2, 3]) },
  });
  const restored = await data.getPaperStudy(actor, projectId, paper.sha256);
  assert.equal(restored?.generation?.candidates[0]?.questionId, question.questionId);
  assert.deepEqual(restored?.generation?.candidates[0]?.citations, candidate.citations);
  assert.deepEqual((await data.listQuestions(actor, projectId)).map((item) => item.questionId), [question.questionId]);
  assert.deepEqual((await data.getPaperFile(actor, projectId, paper.sha256))?.bytes, new Uint8Array([1, 2, 3]));
});

test("候选生成排除失败或待识别页，只读取文字层与成功 OCR 页", async () => {
  const paper: PaperSource = {
    title: "Mixed recognition", filename: "mixed.pdf", sha256: "d".repeat(64),
    pages: ["stale failed text", "Recognized OCR sentence.", "Usable text layer."],
    pageSources: ["failed", "ocr", "text"],
  };
  const seen: number[] = [];
  const result = await generatePaperCandidates(paper, async ({ passages }) => {
    seen.push(...passages.map((passage) => passage.page));
    return {
      model: "mock",
      text: JSON.stringify({ candidates: [{
        question: "识别结果是否一致？", claim: "两页结论可能一致。", rationale: "比较两页证据。", verification: "逐句核对。",
        citations: [{ page: 2, quote: "Recognized OCR sentence." }],
      }] }),
    };
  });
  assert.deepEqual(seen, [2, 3]);
  assert.equal(result.candidates[0]?.citations[0]?.page, 2);
  await assert.rejects(generatePaperCandidates({ ...paper, pages: ["stale"], pageSources: ["failed"] }, async () => {
    throw new Error("不应调用模型");
  }), /没有可读的论文文字/);
});

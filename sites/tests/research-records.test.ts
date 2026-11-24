import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MemoryBackend,
  NotFoundError,
  StorageError,
  createDataService,
  type Actor,
  type DataService,
  type VerificationConclusion,
  type VerificationItemStatus,
} from "../src/experiment/storage.ts";
import { conclusionsFromPackage } from "../src/experiment/evidence.ts";
import { previewImport } from "../src/experiment/import.ts";
import type { AnalysisRevision, TrainingRun } from "../src/experiment/types.ts";
import { buildQuestionMatrix } from "../src/web/model.ts";
import { demoQuestion } from "./fixtures/experiment-demo.ts";

const ALICE: Actor = { userId: "alice" };
const BOB: Actor = { userId: "bob" };
const T0 = "2026-11-24T08:00:00.000Z";
const T1 = "2026-11-24T08:05:00.000Z";
const T2 = "2026-11-24T08:10:00.000Z";
const T3 = "2026-11-24T08:15:00.000Z";

const paper = {
  title: "验证记录合成论文",
  filename: "verification.pdf",
  sha256: "b".repeat(64),
  pages: ["第一页方法说明。", "第二页观察：样本只覆盖短文档。", "第三页局限：尚未在独立数据上复核。"],
};
const candidate = {
  question: "该结论能否推广到独立数据？",
  claim: "现有观察可能只适用于短文档。",
  rationale: "需要核对评估范围与复核条件。",
  verification: "固定模型与数据划分，在独立数据上重复测量。",
  citations: [
    { page: 2, quote: "第二页观察：样本只覆盖短文档。" },
    { page: 3, quote: "第三页局限：尚未在独立数据上复核。" },
  ],
};

function service(backend: MemoryBackend): DataService {
  return createDataService(backend);
}

async function manualQuestion(
  data: DataService,
  projectId: string,
  questionId: string,
  now = T0,
  confirmedClaim: typeof demoQuestion.confirmedClaim = null,
) {
  return data.createQuestion(ALICE, {
    projectId,
    questionId,
    rawClaim: `手动旧问题 ${questionId}`,
    confirmedClaim,
    now,
  });
}

async function paperQuestion(data: DataService, projectId: string) {
  await data.importPaper(ALICE, { name: `论文项目 ${projectId}`, paper, projectId, now: T0 });
  const saved = await data.savePaperCandidates(ALICE, projectId, { model: "mock-paper", candidates: [candidate] });
  const draft = saved.generation!.candidates[0]!;
  const accepted = await data.acceptPaperCandidate(ALICE, {
    projectId,
    candidateId: draft.id,
    question: candidate.question,
    now: T0,
  });
  const research = await data.getQuestionResearch(ALICE, accepted.questionId);
  return { question: accepted, draft, research };
}

async function noteAndItem(data: DataService, questionId: string, sourceIds: string[] = []) {
  const note = await data.saveResearchNote(ALICE, {
    questionId,
    body: "先记录观察，再核对原文条件。",
    sourceIds,
    now: T0,
  });
  const item = await data.saveVerificationItem(ALICE, {
    questionId,
    noteId: note.noteId,
    question: "固定条件后，独立数据上的结果是否仍然成立？",
    method: "复用同一模型与划分，在独立数据上测量准确率。",
    criteria: "同条件配对差为正且达到预设幅度。",
    status: "in_progress",
    now: T1,
  });
  return { note, item };
}

test("旧问题与旧分区可直接添加笔记；创建/更新时间与克隆隔离正确", async () => {
  const backend = new MemoryBackend();
  let data = service(backend);
  await data.createProject(ALICE, "旧项目", T0, "p_old");
  const question = await manualQuestion(data, "p_old", "q_old");
  await backend.transact(ALICE, (draft) => {
    delete draft.researchRecords;
  });

  assert.deepEqual(await data.getQuestionResearch(ALICE, question.questionId), {
    sources: [], notes: [], items: [], results: [],
  });
  const note = await data.saveResearchNote(ALICE, {
    questionId: question.questionId,
    body: "暂时没有引用的个人思考。",
    now: T0,
  });
  assert.equal(note.createdAt, T0);
  assert.equal(note.updatedAt, T0);
  assert.deepEqual(note.sourceIds, []);
  assert.deepEqual(Object.keys(question).sort(), [
    "confirmedClaim", "currentRevisionId", "projectId", "questionId", "rawClaim", "status",
  ]);

  const updated = await data.saveResearchNote(ALICE, {
    noteId: note.noteId,
    questionId: question.questionId,
    body: "补充后的个人思考。",
    now: T1,
  });
  assert.equal(updated.createdAt, T0);
  assert.equal(updated.updatedAt, T1);
  updated.body = "外部修改";
  data = service(backend);
  const reopened = await data.getQuestionResearch(ALICE, question.questionId);
  assert.equal(reopened.notes[0]?.body, "补充后的个人思考。");
});

test("正式问题的单篇/多篇引文可关联并跳转；跨项目来源明确拒绝", async () => {
  const data = service(new MemoryBackend());
  await data.createProject(ALICE, "项目甲", T0, "p_a");
  await data.createProject(ALICE, "项目乙", T0, "p_b");
  const a = await paperQuestion(data, "p_a");
  const b = await paperQuestion(data, "p_b");
  assert.equal(a.research.sources.length, 2);
  assert.deepEqual(a.research.sources.map(({ page, quote }) => ({ page, quote })), candidate.citations);
  assert.equal(a.research.sources[0]?.title, paper.title);
  assert.equal(a.research.sources[0]?.filename, paper.filename);

  const note = await data.saveResearchNote(ALICE, {
    questionId: a.question.questionId,
    body: "两处原文都限制了结论范围。",
    sourceIds: [a.research.sources[0]!.sourceId, a.research.sources[1]!.sourceId, a.research.sources[0]!.sourceId],
    now: T1,
  });
  assert.equal(note.sourceIds.length, 2, "重复来源只保存一次");
  const edited = await data.saveResearchNote(ALICE, {
    noteId: note.noteId,
    questionId: a.question.questionId,
    body: "复核后只保留第三页出处。",
    sourceIds: [a.research.sources[1]!.sourceId],
    now: T2,
  });
  assert.deepEqual(edited.sourceIds, [a.research.sources[1]!.sourceId]);

  await assert.rejects(
    data.saveResearchNote(ALICE, {
      questionId: a.question.questionId,
      body: "不应串用乙项目来源。",
      sourceIds: [b.research.sources[0]!.sourceId],
      now: T3,
    }),
    (error: unknown) => error instanceof StorageError
      && error.code === "invalid_source"
      && error.message.includes("不属于当前问题或项目"),
  );
  assert.equal((await data.getQuestionResearch(ALICE, a.question.questionId)).notes.length, 1);
});

test("笔记转事项保留链接和来源；多次验证只追加且早先结果可追溯", async () => {
  const data = service(new MemoryBackend());
  await data.createProject(ALICE, "项目", T0, "p_a");
  const { question, research } = await paperQuestion(data, "p_a");
  const { note, item } = await noteAndItem(data, question.questionId, research.sources.map((source) => source.sourceId));
  assert.equal(item.noteId, note.noteId);
  assert.deepEqual(item.sourceIds, note.sourceIds);
  assert.equal(item.status, "in_progress");

  const edited = await data.saveVerificationItem(ALICE, {
    itemId: item.itemId,
    questionId: question.questionId,
    question: "更改后的待验证问句？",
    method: item.method,
    criteria: item.criteria,
    status: "pending",
    now: T2,
  });
  assert.equal(edited.question, "更改后的待验证问句？");
  assert.equal(edited.noteId, note.noteId);
  assert.deepEqual(edited.sourceIds, note.sourceIds);

  const first = await data.appendVerificationResult(ALICE, {
    questionId: question.questionId,
    itemId: item.itemId,
    observation: "独立数据只有一组，无法完整复核。",
    basis: "原始材料未提供独立划分。",
    verifiedOn: "2026-11-20",
    conclusion: "insufficient",
    now: T2,
  });
  const second = await data.appendVerificationResult(ALICE, {
    questionId: question.questionId,
    itemId: item.itemId,
    observation: "同条件复核差为 +0.10 个百分点。",
    basis: "独立数据上的同条件配对记录。",
    verifiedOn: "2026-11-24",
    conclusion: "not_supported",
    now: T3,
  });
  const result = await data.getQuestionResearch(ALICE, question.questionId);
  assert.deepEqual(result.results.map((entry) => entry.resultId), [first.resultId, second.resultId]);
  assert.deepEqual(result.results.map(({ verifiedOn, conclusion }) => ({ verifiedOn, conclusion })), [
    { verifiedOn: "2026-11-20", conclusion: "insufficient" },
    { verifiedOn: "2026-11-24", conclusion: "not_supported" },
  ]);
  assert.equal(result.results[0]?.observation, "独立数据只有一组，无法完整复核。");
  assert.equal(result.results[1]?.basis, "独立数据上的同条件配对记录。");
  assert.equal(result.items[0]?.status, "recorded");
});

test("不同问题与访问者相互隔离；错误问题/事项关联不落半条记录", async () => {
  const backend = new MemoryBackend();
  const data = service(backend);
  await data.createProject(ALICE, "项目", T0, "p_a");
  await manualQuestion(data, "p_a", "q_a");
  await manualQuestion(data, "p_a", "q_b");
  const a = await noteAndItem(data, "q_a");
  const b = await noteAndItem(data, "q_b");
  await data.appendVerificationResult(ALICE, {
    questionId: "q_a", itemId: a.item.itemId, observation: "A 观察", basis: "A 依据",
    verifiedOn: "2026-11-21", conclusion: "supported", now: T2,
  });
  await data.appendVerificationResult(ALICE, {
    questionId: "q_b", itemId: b.item.itemId, observation: "B 观察", basis: "B 依据",
    verifiedOn: "2026-11-22", conclusion: "insufficient", now: T2,
  });
  assert.equal((await data.getQuestionResearch(ALICE, "q_a")).notes[0]?.noteId, a.note.noteId);
  assert.equal((await data.getQuestionResearch(ALICE, "q_b")).notes[0]?.noteId, b.note.noteId);
  assert.equal((await data.getQuestionResearch(ALICE, "q_a")).results.length, 1);
  assert.equal((await data.getQuestionResearch(ALICE, "q_b")).results.length, 1);
  await assert.rejects(data.getQuestionResearch(BOB, "q_a"), NotFoundError);
  await assert.rejects(data.appendVerificationResult(ALICE, {
    questionId: "q_b", itemId: a.item.itemId, observation: "错挂", basis: "错挂",
    verifiedOn: "2026-11-23", conclusion: "supported", now: T3,
  }), NotFoundError);
  assert.equal((await data.getQuestionResearch(ALICE, "q_b")).results.length, 1);
  assert.equal((await backend.read(ALICE)).researchRecords?.results.length, 2);
});

test("删除项目级联清理笔记、事项、验证结果和文献，保留其他项目", async () => {
  const backend = new MemoryBackend();
  const data = service(backend);
  await data.createProject(ALICE, "待删项目", T0, "p_del");
  await data.createProject(ALICE, "保留项目", T0, "p_keep");
  const deleted = await paperQuestion(data, "p_del");
  const kept = await paperQuestion(data, "p_keep");
  const a = await noteAndItem(data, deleted.question.questionId, deleted.research.sources.map((source) => source.sourceId));
  const b = await noteAndItem(data, kept.question.questionId, kept.research.sources.map((source) => source.sourceId));
  await data.appendVerificationResult(ALICE, {
    questionId: deleted.question.questionId, itemId: a.item.itemId,
    observation: "待删观察", basis: "待删依据", verifiedOn: "2026-11-24", conclusion: "supported", now: T2,
  });
  await data.appendVerificationResult(ALICE, {
    questionId: kept.question.questionId, itemId: b.item.itemId,
    observation: "保留观察", basis: "保留依据", verifiedOn: "2026-11-24", conclusion: "supported", now: T2,
  });

  await data.deleteProject(ALICE, "p_del");
  const state = await backend.read(ALICE);
  assert.deepEqual(state.researchRecords?.notes.map((note) => note.noteId), [b.note.noteId]);
  assert.deepEqual(state.researchRecords?.items.map((item) => item.itemId), [b.item.itemId]);
  assert.equal(state.researchRecords?.results.length, 1);
  assert.equal(state.researchRecords?.results[0]?.itemId, b.item.itemId);
  assert.deepEqual(state.paperStudies?.map((study) => study.projectId), ["p_keep"]);
  await assert.rejects(data.getQuestionResearch(ALICE, deleted.question.questionId), NotFoundError);
  assert.equal((await data.getQuestionResearch(ALICE, kept.question.questionId)).results.length, 1);
});

test("研究记录不改变原实验导入、矩阵与历史版本", async () => {
  const backend = new MemoryBackend();
  const data = service(backend);
  await data.createProject(ALICE, "归因项目", T0, "p_demo");
  const header = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
  const csv = [header, "R01,M1,S1:v1,7,0.001,off,adam,20,80", "R02,M1,S1:v1,7,0.01,on,adam,20,82"].join("\n");
  const initial = previewImport(csv, { projectId: "p_demo", source: "demo", importedAt: T0, existingRuns: [] });
  await data.confirmImport(ALICE, { projectId: "p_demo", runs: initial.added, now: T0 });
  const question = await manualQuestion(data, "p_demo", "q_flow", T0, demoQuestion.confirmedClaim);
  const { item } = await noteAndItem(data, question.questionId);
  await data.appendVerificationResult(ALICE, {
    questionId: question.questionId, itemId: item.itemId,
    observation: "先记录待核对观察。", basis: "实验导入记录。", verifiedOn: "2026-11-24", conclusion: "insufficient", now: T1,
  });
  const pkg = await data.verifyQuestion(ALICE, question.questionId);
  const makeRevision = (revisionId: string, parentId: string | null, runs: TrainingRun[], createdAt: string): AnalysisRevision => ({
    revisionId,
    questionId: question.questionId,
    parentId,
    createdAt,
    inputSnapshot: { claim: demoQuestion.confirmedClaim!, runs },
    conclusions: conclusionsFromPackage(pkg),
    evidenceRefs: pkg.pairs.flatMap((pair) => [
      { runId: pair.treatedRunId, projectId: "p_demo" },
      { runId: pair.controlRunId, projectId: "p_demo" },
    ]),
    suggestions: pkg.suggestions.map((suggestion) => suggestion.text),
    modelOutput: "pending",
  });
  const v1 = makeRevision("rev_1", null, initial.added, T1);
  await data.createRevision(ALICE, { revision: v1, idempotencyKey: "flow-1", expectedParentId: null, now: T1 });
  const matrix = buildQuestionMatrix(v1.inputSnapshot.claim, v1.inputSnapshot.runs, pkg);
  assert.equal(matrix.cells.find((cell) => cell.runId === "R01")?.accuracy, 80);
  assert.equal(matrix.cells.find((cell) => cell.runId === "R02")?.accuracy, 82);
  assert.deepEqual(await data.getRevision(ALICE, question.questionId, "rev_1"), v1);
  assert.equal((await data.getQuestionResearch(ALICE, question.questionId)).results.length, 1);
});

test("输入边界：空正文、无效状态/日期/结论与跨问题来源均拒绝且不写入", async () => {
  const data = service(new MemoryBackend());
  await data.createProject(ALICE, "项目", T0, "p_a");
  await manualQuestion(data, "p_a", "q_a");
  await manualQuestion(data, "p_a", "q_b");
  await assert.rejects(data.saveResearchNote(ALICE, { questionId: "q_a", body: "  ", now: T0 }), /正文不能为空/);
  await assert.rejects(data.saveVerificationItem(ALICE, {
    questionId: "q_a", question: "问句", method: "方法", criteria: "依据", status: "bad" as VerificationItemStatus, now: T0,
  }), /状态无效/);
  await assert.rejects(data.saveVerificationItem(ALICE, {
    questionId: "q_a", noteId: "missing", question: "问句", method: "方法", criteria: "依据", now: T0,
  }), NotFoundError);
  const item = await data.saveVerificationItem(ALICE, {
    questionId: "q_a", question: "问句", method: "方法", criteria: "依据", now: T0,
  });
  for (const input of [
    { verifiedOn: "2026-02-30", conclusion: "supported" as VerificationConclusion },
    { verifiedOn: "2026-11-24", conclusion: "bad" as VerificationConclusion },
  ]) {
    await assert.rejects(data.appendVerificationResult(ALICE, {
      questionId: "q_a", itemId: item.itemId, observation: "观察", basis: "依据", now: T1, ...input,
    }), /验证日期|验证结论/);
  }
  const research = await data.getQuestionResearch(ALICE, "q_a");
  assert.equal(research.notes.length, 0);
  assert.equal(research.items.length, 1);
  assert.equal(research.results.length, 0);
});

test("页面接线覆盖正式问题与旧问题，并提供结果到事项/笔记/原文的追溯", () => {
  const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
  assert.ok(js.includes("async function renderResearchWorkspace(question, research)"));
  assert.ok(js.includes("data.getQuestionResearch(ACTOR, questionId)"));
  assert.ok(js.includes("await renderResearchWorkspace(question, research)"));
  assert.ok((js.match(/main\.append\([^;]*researchPanel/g) ?? []).length >= 3, "未明确、未分析与已分析分支均挂载研究记录");
  assert.ok(js.includes('text: "转为事项"'));
  assert.ok(js.includes('text: "记录验证结果"'));
  assert.ok(js.includes('text: "查看事项"'));
  assert.ok(js.includes('text: "来源笔记"'));
  assert.ok(js.includes("`#/project/${question.projectId}/paper/${source.paperSha256}/${source.page}`"));
  assert.ok(js.includes("data.appendVerificationResult(ACTOR"));
  assert.ok(js.includes("const sourceIds = selectedSourceIds(sourcePicker);"));
  assert.ok(js.includes("sourceIds,"), "笔记保存提交已选引文");
  assert.match(css, /\.research-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*\{\s*\.research-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.research-card\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

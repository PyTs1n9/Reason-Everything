import assert from "node:assert/strict";
import { test } from "node:test";

import { MockAdapter } from "../src/agent/adapter.ts";
import { createAgentService } from "../src/agent/service.ts";
import {
  buildEvidencePackage,
  conclusionsFromPackage,
  type EvidencePackage,
} from "../src/experiment/evidence.ts";
import { ConflictError, MemoryBackend, createDataService } from "../src/experiment/storage.ts";
import type { ClaimSpec, TrainingRun } from "../src/experiment/types.ts";
import {
  REQUEST_EXAMPLES,
  createWorkflowService,
} from "../src/workflow/service.ts";

const ALICE = { userId: "alice" };
const BOB = { userId: "bob" };
const CTX = { projectId: "p_demo", questionId: "q_0001" };
const SENTENCE = "数据增强使准确率提高了 2 个百分点";

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const CSV12 = [
  HEADER,
  "R01,M1,S1:v1,7,0.001,off,adam,20,80",
  "R02,M1,S1:v1,7,0.01,on,adam,20,82",
].join("\n");
const CSV_R03 = [HEADER, "R03,M1,S1:v1,7,0.01,off,adam,20,81.8"].join("\n");
const CSV_R03_NO_SEED = [HEADER, "R03,M1,S1:v1,,0.01,off,adam,20,81.8"].join("\n");

const CLAIM: ClaimSpec = {
  factor: "augmentation",
  metric: "accuracy",
  targetRunId: "R02",
  baselineRunId: "R01",
  scope: "both_lrs",
  learningRates: [0.001, 0.01],
  expectedDeltaPp: 2,
};

const GOOD_PARSE = JSON.stringify({
  factor: "augmentation",
  metric: "accuracy",
  scope: null,
  expectedDeltaPp: 2,
  clarifyingQuestion: "目标学习率是哪一档，还是两档都要验证？",
});

let clockTick = 0;
function clock(): string {
  clockTick += 1;
  return `2026-11-21T13:00:00.${String(clockTick).padStart(3, "0")}Z`;
}

function validAnalysisText(pkg: EvidencePackage, claim: ClaimSpec): string {
  const missing = pkg.cells.filter((c) => c.status !== "measured").map((c) => c.cellId);
  const observationIds = ["fact:obs-delta"];
  if (missing.length > 0) observationIds.push(missing[0]!);
  else if (pkg.pairs.length > 0) observationIds.push(pkg.pairs[0]!.pairId);
  const action = pkg.suggestions[0]?.suggestionId;
  const nextActionIds = action ? [action] : [pkg.cells[0]!.cellId];
  const revisedClaim =
    claim.expectedDeltaPp === null
      ? {
          text: "在两档学习率下分别验证数据增强是否让准确率提高。",
          evidenceIds: missing.length > 0 ? [missing[0]!] : ["fact:obs-delta"],
        }
      : {
          text: "在两档学习率下分别验证数据增强是否让准确率提高 2 个百分点。",
          evidenceIds: ["fact:claim-delta"],
        };
  return JSON.stringify({
    observation: {
      text: "原始比较来自 R02 与 R01：两次运行同时差 lr 与增强开关，+2.00 个百分点只是观测，算不出增强贡献。",
      evidenceIds: observationIds,
    },
    interpretation: {
      text: "R02 的准确率 82 高于 R01 的 80，但配置同时变化，不能归为单一因素。",
      evidenceIds: ["fact:run:R02", "fact:run:R01"],
    },
    nextAction: {
      text: "先补跑缺失的那格：复用现有配置只改增强开关。",
      evidenceIds: nextActionIds,
    },
    revisedClaim,
  });
}

function makeWorkflow(withAgent: boolean) {
  const backend = new MemoryBackend();
  const data = createDataService(backend);
  const mock = new MockAdapter([{ text: GOOD_PARSE }], [{ text: "" }]);
  const agent = withAgent ? createAgentService(mock, { timeoutMs: 1000 }) : null;
  const wf = createWorkflowService({ storage: data, agent, now: clock });
  const wf2 = createWorkflowService({ storage: data, agent: null, now: clock });
  return { wf, wf2, data, mock };
}

async function seedClaimAndRuns(
  wf: ReturnType<typeof createWorkflowService>,
  mock: MockAdapter,
  extraCsv: string[] = [],
): Promise<{ questionId: string; claim: ClaimSpec }> {
  await wf.createProject(ALICE, "演示", "p_demo");
  const question = await wf.createQuestion(ALICE, {
    projectId: "p_demo",
    questionId: "q_0001",
    rawClaim: SENTENCE,
  });
  assert.equal(question.status, "needs_input", "草稿先落库为 needs_input");

  const parsed = await wf.parseClaim("req-parse", SENTENCE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse failed");

  const confirmed = await wf.confirmScope(ALICE, {
    questionId: "q_0001",
    proposal: parsed.output,
    source: "model",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.equal("question" in confirmed, true, JSON.stringify(confirmed));

  const preview = await wf.previewImport(ALICE, { projectId: "p_demo", text: CSV12 });
  assert.equal(preview.blocking, false);
  await wf.commitImport(ALICE, { projectId: "p_demo", runs: preview.added });
  const committed: TrainingRun[] = [...preview.added];
  for (const csv of extraCsv) {
    const p = await wf.previewImport(ALICE, { projectId: "p_demo", text: csv });
    const runs = [...p.added, ...p.incomplete];
    if (runs.length > 0) {
      await wf.commitImport(ALICE, { projectId: "p_demo", runs });
      committed.push(...runs);
    }
  }

  const pkg = buildEvidencePackage(CLAIM, committed, CTX);
  mock.analyzeSteps = [{ text: validAnalysisText(pkg, CLAIM) }];
  return { questionId: "q_0001", claim: CLAIM };
}

// ---------- A → B ----------

test("A→B：初始两行等待补跑 → 补入 R03 → 同 question 第二版本、幅度 +0.20", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);

  // A：分析初始两行
  const a = await wf.analyze(ALICE, { requestId: "req-a", questionId });
  assert.equal(a.gated, false);
  if (a.gated) return;
  assert.equal(a.status, "waiting_for_run", "A：初始两行 → 等待补跑");
  assert.equal(a.revisionId.startsWith("rev_"), true);
  assert.equal(a.evidence.cells.length, 4, "两档各查增强开/关两格");
  assert.equal(a.evidence.cells.filter((c) => c.status !== "measured").length, 2);
  assert.equal(a.modelOutput, "ready");
  assert.equal(a.job.status, "succeeded");
  assert.equal(a.duplicate, false);
  assert.ok(a.analysis && a.analysis.citations.length > 0, "引用已关联到格子/运行");
  for (const event of a.events) {
    assert.equal(event.jobId, "req-a");
    assert.ok(event.node && event.at && event.summary, "事件含节点/时间/摘要");
    assert.ok(["started", "completed", "failed"].includes(event.status));
  }
  assert.ok(a.events.some((e) => e.node === "archive" && e.revisionId === a.revisionId));
  assert.ok(a.events.some((e) => e.status === "started"));
  assert.ok(a.events.some((e) => e.status === "completed"));

  // B：补入 R03 → 下一版本
  const r03Runs = await previewRuns(wf, CSV_R03);
  const b = await wf.appendRunsAndReanalyze(ALICE, {
    requestId: "req-b",
    questionId,
    runs: r03Runs,
  });
  assert.equal(b.gated, false);
  if (b.gated) return;
  assert.equal(b.questionId, questionId, "B：同一个 questionId");
  assert.notEqual(b.revisionId, a.revisionId);
  assert.equal(b.evidence.pairs.length, 1, "0.01 档配对成立");
  const pair = b.evidence.pairs[0]!;
  assert.equal(pair.lr, 0.01);
  assert.equal(pair.deltaPp, "+0.20", "结论幅度变为 0.20");
  assert.ok(
    conclusionsFromPackage(b.evidence).some((c) => c.detail.includes("+0.20")),
    "结论含 +0.20",
  );

  const versions = await wf.listRevisions(ALICE, questionId);
  assert.equal(versions.length, 2);
  assert.deepEqual(
    versions.map((v) => [v.revisionId, v.parentId]),
    [[a.revisionId, null], [b.revisionId, a.revisionId]],
  );
  const v1 = await wf.getRevision(ALICE, questionId, a.revisionId);
  assert.equal(v1?.inputSnapshot.runs.length, 2, "V1 仍是当时两行");
  assert.ok(
    v1!.conclusions.some((c) => c.result === "insufficient_data"),
    "V1 保留当时缺对照",
  );

  console.log(
    `[07-A→B] questionId=${questionId} | V1=${a.revisionId.slice(0, 12)}… status=${a.status} model=${a.modelOutput} cells=4 missing=2 | ` +
      `V2=${b.revisionId.slice(0, 12)}… parent=V1 pairs=1(lr=0.01, delta=+0.20) missing=1 status=${b.status} | ` +
      `变化=补入 R03 后 0.01 档由缺测变为已配对（+0.20），0.001/开 仍缺`,
  );
});

async function previewRuns(wf: ReturnType<typeof createWorkflowService>, csv: string) {
  const preview = await wf.previewImport(ALICE, { projectId: "p_demo", text: csv });
  assert.equal(preview.blocking, false, JSON.stringify(preview.errors));
  return [...preview.added, ...preview.incomplete];
}

// ---------- C ----------

test("C：历史已有 R03 → 直接复用，不再为该格出补跑单", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock, [CSV_R03]);

  const result = await wf.analyze(ALICE, { requestId: "req-c", questionId });
  assert.equal(result.gated, false);
  if (result.gated) return;
  assert.equal(result.evidence.pairs.length, 1, "复用历史 R03 完成配对");
  assert.equal(result.evidence.pairs[0]?.deltaPp, "+0.20");
  const suggestedCells = result.evidence.suggestions.map((s) => s.cellId);
  assert.equal(
    suggestedCells.some((id) => id.endsWith(":0.01:off")),
    false,
    "0.01/关 已有历史运行，不出补跑单",
  );
  assert.equal(suggestedCells.length, 1, "只剩 0.001/开 待补");
  assert.equal(result.status, "waiting_for_run");
});

// ---------- D ----------

test("D：输入「两个学习率下都提高了吗」→ 检查两档格子", async () => {
  const { wf, mock } = makeWorkflow(true);
  await wf.createProject(ALICE, "演示", "p_demo");
  const question = await wf.createQuestion(ALICE, {
    projectId: "p_demo",
    questionId: "q_0001",
    rawClaim: "两个学习率下都提高了吗",
  });
  assert.equal(question.status, "needs_input");

  const sentence = "两个学习率下都提高了吗";
  mock.parseSteps = [
    {
      text: JSON.stringify({
        factor: "augmentation",
        metric: "accuracy",
        scope: null,
        expectedDeltaPp: null,
        clarifyingQuestion: "要检查哪两档学习率？",
      }),
    },
  ];
  const parsed = await wf.parseClaim("req-parse-d", sentence);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const confirmed = await wf.confirmScope(ALICE, {
    questionId: "q_0001",
    proposal: parsed.output,
    source: "model",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.equal("question" in confirmed, true, JSON.stringify(confirmed));

  const runs = await previewRuns(wf, CSV12);
  await wf.commitImport(ALICE, { projectId: "p_demo", runs });

  const claimD: ClaimSpec = { ...CLAIM, expectedDeltaPp: null };
  const pkgD = buildEvidencePackage(claimD, runs, CTX);
  mock.analyzeSteps = [{ text: validAnalysisText(pkgD, claimD) }];

  const result = await wf.analyze(ALICE, { requestId: "req-d", questionId: "q_0001" });
  assert.equal(result.gated, false);
  if (result.gated) return;
  const lrs = [...new Set(result.evidence.cells.map((c) => c.lr))].sort();
  assert.deepEqual(lrs, [0.001, 0.01], "两档学习率都被检查");
  assert.equal(result.evidence.cells.length, 4, "两档 × 增强开/关 = 四格");
  assert.equal(result.evidence.coverage.requiredLrs.length, 2);
});

// ---------- E ----------

test("E：无模型服务 → 规则报告可用，AI 区明确未完成", async () => {
  const { wf } = makeWorkflow(false);

  const parsed = await wf.parseClaim("req-parse-e", SENTENCE);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error.code, "model_unavailable");

  await wf.createProject(ALICE, "演示", "p_demo");
  await wf.createQuestion(ALICE, { projectId: "p_demo", questionId: "q_0001", rawClaim: SENTENCE });
  const manual = JSON.parse(GOOD_PARSE) as Record<string, unknown>;
  const confirmed = await wf.confirmScope(ALICE, {
    questionId: "q_0001",
    proposal: manual as never,
    source: "manual",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.equal("question" in confirmed, true);
  const runs = await previewRuns(wf, CSV12);
  await wf.commitImport(ALICE, { projectId: "p_demo", runs });

  const result = await wf.analyze(ALICE, { requestId: "req-e", questionId: "q_0001" });
  assert.equal(result.gated, false);
  if (result.gated) return;
  assert.equal(result.status, "waiting_for_run", "规则图表数据可用");
  assert.ok(conclusionsFromPackage(result.evidence).length > 0, "规则结论已产出");
  assert.equal(result.modelOutput, "unavailable", "AI 区明确未完成");
  assert.equal(result.analysis, null);
  assert.equal(result.job.status, "failed");
  const modelEvent = result.events.find((e) => e.node === "model");
  assert.equal(modelEvent?.status, "failed");
  assert.match(modelEvent!.summary, /模型服务不可用/);
});

// ---------- F ----------

test("F：一条缺字段的数据行 → 只问缺项，不调用模型", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);

  const preview = await wf.previewImport(ALICE, {
    projectId: "p_demo",
    text: CSV_R03_NO_SEED,
  });
  assert.equal(preview.incomplete.length, 1, "缺 seed 存为不完整记录");
  assert.equal(preview.errors.length, 0);
  await wf.commitImport(ALICE, {
    projectId: "p_demo",
    runs: [...preview.added, ...preview.incomplete],
  });

  const callsBefore = mock.analyzeCalls;
  const result = await wf.analyze(ALICE, { requestId: "req-f", questionId });
  assert.equal(result.gated, false);
  if (result.gated) return;
  assert.equal(result.status, "needs_input");
  assert.equal(result.evidence.missingConfigs.length, 1, "只问缺项");
  assert.equal(result.evidence.missingConfigs[0]?.runId, "R03");
  assert.deepEqual(result.evidence.missingConfigs[0]?.unknownFields, ["seed"]);
  assert.equal(result.modelOutput, "pending", "未调用模型");
  assert.equal(mock.analyzeCalls, callsBefore, "模型零调用");
  assert.equal(result.job.status, "failed");
  const modelEvent = result.events.find((e) => e.node === "model");
  assert.match(modelEvent!.summary, /只向用户询问缺项/);
});

// ---------- G ----------

test("G：重复请求与过期父版本 → 版本数正确", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);

  const first = await wf.analyze(ALICE, { requestId: "req-g", questionId });
  assert.equal(first.gated, false);
  if (first.gated) return;
  const callsAfterFirst = mock.analyzeCalls;

  // 相同请求重复发送（含断线重连后的重放）
  const dup = await wf.analyze(ALICE, { requestId: "req-g", questionId });
  assert.equal(dup.gated, false);
  if (dup.gated) return;
  assert.equal(dup.duplicate, true);
  assert.equal(dup.revisionId, first.revisionId);
  assert.equal(mock.analyzeCalls, callsAfterFirst, "重复请求不再打模型");
  assert.equal((await wf.listRevisions(ALICE, questionId)).length, 1);

  // 第二个浏览器拿着旧父版本提交
  await assert.rejects(
    wf.analyze(ALICE, { requestId: "req-g2", questionId, expectedParentId: null }),
    (error: unknown) => error instanceof ConflictError && error.code === "stale_parent",
  );
  assert.equal(mock.analyzeCalls, callsAfterFirst, "过期冲突发生在模型调用之前");
  assert.equal((await wf.listRevisions(ALICE, questionId)).length, 1, "冲突不产生版本");

  // 刷新后重试成功
  const refreshed = await wf.analyze(ALICE, { requestId: "req-g2", questionId });
  assert.equal(refreshed.gated, false);
  if (refreshed.gated) return;
  assert.equal(refreshed.duplicate, false);
  const versions = await wf.listRevisions(ALICE, questionId);
  assert.equal(versions.length, 2, "版本数正确");
  assert.equal(versions[1]?.parentId, first.revisionId);
});

// ---------- 权限 / 恢复 / 重试 ----------

test("权限：不能凭任意 projectId/questionId 读取他人记录", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);

  assert.deepEqual(await wf.listProjects(BOB), []);
  await assert.rejects(wf.previewImport(BOB, { projectId: "p_demo", text: CSV12 }));
  await assert.rejects(wf.commitImport(BOB, { projectId: "p_demo", runs: [] }));
  await assert.rejects(wf.confirmScope(BOB, { questionId, proposal: null as never, source: "manual" }));
  await assert.rejects(wf.analyze(BOB, { requestId: "req-bob", questionId }));
  await assert.rejects(wf.listRevisions(BOB, questionId));
  assert.equal(await wf.getRevision(BOB, questionId, "rev_x"), null);
  await assert.rejects(wf.getJob(BOB, "req-a"));
  // A 自己的数据不受影响
  assert.equal((await wf.listProjects(ALICE)).length, 1);
});

test("刷新/断线恢复：新服务实例找回版本与作业事件", async () => {
  const { wf, wf2, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);
  const first = await wf.analyze(ALICE, { requestId: "req-r", questionId });
  assert.equal(first.gated, false);
  if (first.gated) return;

  const { job, events } = await wf2.getJob(ALICE, "req-r");
  assert.equal(job.status, "succeeded");
  assert.equal(job.revisionId, first.revisionId);
  assert.equal(events.length >= 5, true, "节点事件完整可回放");
  assert.ok(events.some((e) => e.node === "model" && e.status === "completed"));
  assert.ok(events.some((e) => e.node === "archive" && e.revisionId === first.revisionId));

  const versions = await wf2.listRevisions(ALICE, questionId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.revisionId, first.revisionId);
  const analysis = await wf2.getRevision(ALICE, questionId, first.revisionId);
  assert.equal(analysis?.modelOutput, "ready");
});

test("模型失败后再分析：沿用原证据，迟到的旧结果不覆盖新版本", async () => {
  const { wf, mock } = makeWorkflow(true);
  const { questionId } = await seedClaimAndRuns(wf, mock);
  const pkg2row = buildEvidencePackage(
    CLAIM,
    [
      {
        runId: "R01",
        projectId: "p_demo",
        config: { model: "M1", evalSplit: "S1:v1", seed: 7, lr: 0.001, augmentation: "off", optimizer: "adam", epochs: 20 },
        source: "real",
        metrics: { accuracy: 80 },
        metadata: { importedAt: clock() },
      },
      {
        runId: "R02",
        projectId: "p_demo",
        config: { model: "M1", evalSplit: "S1:v1", seed: 7, lr: 0.01, augmentation: "on", optimizer: "adam", epochs: 20 },
        source: "real",
        metrics: { accuracy: 82 },
        metadata: { importedAt: clock() },
      },
    ],
    CTX,
  );
  mock.analyzeSteps = [
    { text: "not json" },
    { text: "not json" },
    { text: validAnalysisText(pkg2row, CLAIM) },
  ];

  const failed = await wf.analyze(ALICE, { requestId: "req-fail", questionId });
  assert.equal(failed.gated, false);
  if (failed.gated) return;
  assert.equal(failed.modelOutput, "failed");
  assert.equal(failed.job.status, "failed");
  assert.ok(conclusionsFromPackage(failed.evidence).length > 0, "规则报告保留");

  // 用户此时才补入 R03（数据变了，但重试仍用原证据）
  const r03 = await previewRuns(wf, CSV_R03);
  await wf.commitImport(ALICE, { projectId: "p_demo", runs: r03 });

  const retry = await wf.analyze(ALICE, { requestId: "req-retry", questionId });
  assert.equal(retry.gated, false);
  if (retry.gated) return;
  assert.equal(retry.reusedSnapshot, true, "重试沿用原证据");
  const retryRevision = await wf.getRevision(ALICE, questionId, retry.revisionId);
  assert.equal(retryRevision?.inputSnapshot.runs.length, 2, "原证据仍是最初两行");
  assert.equal(retry.modelOutput, "ready");
  assert.equal(retry.job.status, "succeeded");
  assert.equal(mock.analyzeCalls, 3, "失败两次 + 重试一次");

  const versions = await wf.listRevisions(ALICE, questionId);
  assert.equal(versions.length, 2);
  const v1 = await wf.getRevision(ALICE, questionId, versions[0]!.revisionId);
  assert.equal(v1?.modelOutput, "failed", "旧失败版本保留，不被覆盖");
  assert.ok(v1!.conclusions.length > 0);
});

test("动作清单：12 个动作齐备且请求样例指向真实方法", () => {
  const { wf } = makeWorkflow(false);
  const actions = [
    "listProjects",
    "createProject",
    "createQuestion",
    "parseClaim",
    "confirmScope",
    "previewImport",
    "commitImport",
    "analyze",
    "getJob",
    "getRevision",
    "listRevisions",
    "appendRunsAndReanalyze",
  ];
  for (const action of actions) {
    assert.equal(typeof (wf as unknown as Record<string, unknown>)[action], "function", action);
  }
  assert.equal(REQUEST_EXAMPLES.length, 12);
  for (const example of REQUEST_EXAMPLES) {
    assert.ok(actions.includes(example.action as string), example.action);
    assert.ok(example.example.length > 0);
  }
});

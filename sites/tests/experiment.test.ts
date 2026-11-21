import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseClaimSentence,
  proposeClaim,
  validateClaimSpecShape,
} from "../src/experiment/claim.ts";
import { evaluateClaim } from "../src/experiment/evaluate.ts";
import {
  compareAccuracy,
  configsMatch,
  formatDeltaPp,
  isStrictlyPairable,
  toHundredths,
  validateAccuracy,
  validateRun,
} from "../src/experiment/runs.ts";
import {
  createNextRevision,
  validateJobStatus,
  validateQuestionStatus,
  validateRevision,
} from "../src/experiment/revision.ts";
import type {
  AnalysisJob,
  AnalysisRevision,
  Project,
  Question,
  TrainingRun,
} from "../src/experiment/types.ts";
import {
  demoAllRuns,
  demoBackfillRuns,
  demoInitialRuns,
  demoJob,
  demoProject,
  demoQuestion,
  demoRevision,
} from "./fixtures/experiment-demo.ts";

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertExactKeys(obj: object, expected: string[], label: string) {
  assert.deepEqual(
    Object.keys(obj).sort(),
    [...expected].sort(),
    `${label} 字段集合与契约不一致`,
  );
}

// ---------- 编码读回 ----------

test("固定样例经 JSON 编码后可读回并通过结构校验", () => {
  const project = roundTrip<Project>(demoProject);
  const question = roundTrip<Question>(demoQuestion);
  const runs = roundTrip<TrainingRun[]>(demoInitialRuns);
  const revision = roundTrip<AnalysisRevision>(demoRevision);
  const job = roundTrip<AnalysisJob>(demoJob);

  assertExactKeys(project, ["projectId", "name", "updatedAt"], "Project");
  assertExactKeys(
    question,
    ["questionId", "projectId", "rawClaim", "confirmedClaim", "currentRevisionId", "status"],
    "Question",
  );
  assertExactKeys(
    runs[0]!,
    ["runId", "projectId", "config", "source", "metrics", "metadata"],
    "TrainingRun",
  );
  assertExactKeys(
    revision,
    [
      "revisionId",
      "questionId",
      "parentId",
      "createdAt",
      "inputSnapshot",
      "conclusions",
      "evidenceRefs",
      "suggestions",
      "modelOutput",
    ],
    "AnalysisRevision",
  );
  assertExactKeys(job, ["jobId", "questionId", "revisionId", "status"], "AnalysisJob");

  for (const r of runs) assert.deepEqual(validateRun(r), [], `validateRun(${r.runId})`);
  assert.deepEqual(validateClaimSpecShape(question.confirmedClaim!), []);
  assert.deepEqual(
    validateRevision(revision, {
      question,
      knownRunIds: demoAllRuns.map((r) => r.runId),
      knownRevisionIds: [],
    }),
    [],
  );
  assert.deepEqual(validateQuestionStatus(question.status), []);
  assert.deepEqual(validateJobStatus(job.status), []);
});

test("状态三张表各自封闭：非法值被拒绝且互不串用", () => {
  assert.deepEqual(validateQuestionStatus("done"), ["问题状态非法: done"]);
  assert.deepEqual(validateJobStatus("pending"), ["分析作业状态非法: pending"]);
  assert.deepEqual(validateQuestionStatus("queued"), ["问题状态非法: queued"]);
  assert.deepEqual(validateJobStatus("reviewable"), ["分析作业状态非法: reviewable"]);
});

// ---------- 演示数据集 ----------

test("初始导入恰好两行：R01、R02", () => {
  assert.equal(demoInitialRuns.length, 2);
  assert.deepEqual(
    demoInitialRuns.map((r) => r.runId),
    ["R01", "R02"],
  );
});

test("R03、R04 只在回填集合，不藏进初始运行", () => {
  assert.deepEqual(
    demoBackfillRuns.map((r) => r.runId),
    ["R03", "R04"],
  );
  const initialIds = new Set(demoInitialRuns.map((r) => r.runId));
  for (const r of demoBackfillRuns) assert.equal(initialIds.has(r.runId), false);
  assert.equal(demoAllRuns.length, 4);
  assert.equal(new Set(demoAllRuns.map((r) => r.runId)).size, 4);
});

test("演示运行的固定条件一致且全部标记为 demo 来源", () => {
  for (const r of demoAllRuns) {
    assert.equal(r.source, "demo");
    assert.equal(r.config.model, "M1");
    assert.equal(r.config.evalSplit, "S1:v1");
    assert.equal(r.config.seed, 7);
    assert.equal(r.config.optimizer, "adam");
    assert.equal(r.config.epochs, 20);
    assert.deepEqual(validateRun(r), []);
  }
});

test("同一项目只有一个项目身份，分析版本不产生新项目", () => {
  const projects: Project[] = [demoProject];
  const result = createNextRevision(
    demoRevision,
    {
      revisionId: "rev_demo_0002",
      createdAt: "2026-11-21T01:00:00.000Z",
      inputSnapshot: demoRevision.inputSnapshot,
      conclusions: [],
      evidenceRefs: [],
      suggestions: [],
      modelOutput: "pending",
    },
    {
      question: demoQuestion,
      knownRunIds: demoAllRuns.map((r) => r.runId),
      knownRevisionIds: ["rev_demo_0001"],
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.revision.questionId, demoQuestion.questionId);
  assert.equal(result.revision.parentId, "rev_demo_0001");
  assert.equal("projectId" in result.revision, false, "revision 不得携带项目身份");
  assert.equal(projects.length, 1);
});

// ---------- 主张解析 ----------

test("演示原句解析为「提高 + 2 个百分点」并构建出与契约一致的 ClaimSpec", () => {
  const parsed = parseClaimSentence(demoQuestion.rawClaim);
  assert.deepEqual(parsed, { direction: "increase", deltaPp: 2, deltaUnit: "pp" });

  const built = proposeClaim(demoQuestion.rawClaim, {
    factor: "augmentation",
    metric: "accuracy",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.deepEqual(built, { ok: true, spec: demoQuestion.confirmedClaim });
});

test("下降、未变、百分数增幅、无法识别一律待澄清，不改方向", () => {
  const params = {
    factor: "augmentation" as const,
    metric: "accuracy" as const,
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs" as const,
    learningRates: [0.001, 0.01],
  };
  const decrease = proposeClaim("数据增强使准确率下降了 2 个百分点", params);
  assert.equal(decrease.ok, false);
  const unchanged = proposeClaim("数据增强对准确率未变", params);
  assert.equal(unchanged.ok, false);
  const percent = proposeClaim("数据增强使准确率提高了 2%", params);
  assert.equal(percent.ok, false);
  if (!percent.ok) assert.equal(percent.reason, "needs_clarification");
  const unknown = proposeClaim("这个模型更稳", params);
  assert.equal(unknown.ok, false);
  const negative = proposeClaim("数据增强使准确率提高了 -1 个百分点", params);
  assert.equal(negative.ok, false);
});

test("不写增幅的「提高」主张构建为仅检查方向（expectedDeltaPp 为 null）", () => {
  const built = proposeClaim("数据增强提高了准确率", {
    factor: "augmentation",
    metric: "accuracy",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "target_lr",
    learningRates: [0.01, 0.001],
  });
  assert.equal(built.ok, true);
  if (built.ok) assert.equal(built.spec.expectedDeltaPp, null);
});

// ---------- 配置匹配与单位 ----------

test("配置匹配：unknown 绝不同值，可选列参与匹配", () => {
  const base: TrainingRun = demoInitialRuns[0]!;
  const same: TrainingRun = roundTrip<TrainingRun>(base);
  assert.equal(configsMatch(base.config, same.config), true);

  const otherLr: TrainingRun = demoInitialRuns[1]!;
  assert.equal(configsMatch(base.config, otherLr.config), false, "lr 不同不算同配置");

  const unknownA = { ...base.config, seed: "unknown" as const };
  const unknownB = { ...same.config, seed: "unknown" as const };
  assert.equal(configsMatch(unknownA, unknownB), false, "缺对缺不得默认同值");
  assert.equal(configsMatch(unknownA, same.config), false);

  const noOptimizer = { ...same.config };
  delete noOptimizer.optimizer;
  assert.equal(configsMatch(same.config, noOptimizer), false, "可选列缺失不视为一致");
});

test("必要配置齐全才可严格配对", () => {
  assert.equal(isStrictlyPairable(demoInitialRuns[0]!.config), true);
  assert.equal(isStrictlyPairable({ ...demoInitialRuns[0]!.config, lr: "unknown" }), false);
});

test("准确率校验：0–100、最多两位小数，越界与非数拒绝", () => {
  assert.equal(validateAccuracy(80), null);
  assert.equal(validateAccuracy(81.8), null);
  assert.equal(validateAccuracy(80.0), null);
  assert.match(String(validateAccuracy(80.123)), /两位小数/);
  assert.match(String(validateAccuracy(101)), /0–100/);
  assert.match(String(validateAccuracy(-1)), /0–100/);
  assert.match(String(validateAccuracy(Number.NaN)), /有限数字/);
  assert.match(String(validateAccuracy(Number.POSITIVE_INFINITY)), /有限数字/);
  assert.match(String(validateAccuracy("80")), /有限数字/);
});

test("整数百分之一百分点比较与格式化，不用浮点相等", () => {
  assert.equal(toHundredths(81.8), 8180);
  assert.equal(toHundredths(80.0), 8000);
  assert.equal(compareAccuracy(82.0, 80.0), "提高");
  assert.equal(compareAccuracy(80.0, 80.0), "未变");
  assert.equal(compareAccuracy(80.5, 81.8), "下降");
  assert.equal(formatDeltaPp(200), "+2.00");
  assert.equal(formatDeltaPp(-150), "-1.50");
  assert.equal(formatDeltaPp(0), "0.00");
  assert.equal(formatDeltaPp(20), "+0.20");
  assert.equal(compareAccuracy(81.8, 81.8), "未变");
});

// ---------- 规则评估 ----------

test("初始两行评估：两档都缺对照 → waiting_for_run 与具体补跑建议", () => {
  const outcome = evaluateClaim(demoQuestion.confirmedClaim!, demoInitialRuns);
  assert.equal(outcome.questionStatus, "waiting_for_run");
  assert.deepEqual(outcome.conclusions, demoRevision.conclusions);
  assert.deepEqual(outcome.suggestions, demoRevision.suggestions);
  assert.deepEqual(outcome.evidenceRunIds, []);
  assert.equal(outcome.suggestions.length, 2);
  assert.match(outcome.suggestions[0]!, /lr=0\.001, augmentation=on/);
  assert.match(outcome.suggestions[1]!, /lr=0\.01, augmentation=off/);
});

test("回填 R03、R04 后逐档验证：方向提高但未达 2 个百分点", () => {
  const outcome = evaluateClaim(demoQuestion.confirmedClaim!, demoAllRuns);
  assert.equal(outcome.questionStatus, "reviewable");
  assert.equal(outcome.conclusions.length, 4);

  const byId = new Map(outcome.conclusions.map((c) => [c.ruleId, c]));
  assert.equal(byId.get("direction@0.001")?.result, "pass");
  assert.match(String(byId.get("direction@0.001")?.detail), /\+0\.50 个百分点/);
  assert.equal(byId.get("delta@0.001")?.result, "fail");
  assert.match(String(byId.get("delta@0.001")?.detail), /要求至少 \+2\.00 个百分点，实测 \+0\.50/);
  assert.equal(byId.get("direction@0.01")?.result, "pass");
  assert.match(String(byId.get("direction@0.01")?.detail), /\+0\.20 个百分点/);
  assert.equal(byId.get("delta@0.01")?.result, "fail");
  assert.match(String(byId.get("delta@0.01")?.detail), /实测 \+0\.20/);
  assert.deepEqual([...outcome.evidenceRunIds].sort(), ["R01", "R02", "R03", "R04"]);
});

test("target_lr 范围只验证目标学习率一档", () => {
  const spec = {
    ...demoQuestion.confirmedClaim!,
    scope: "target_lr" as const,
    learningRates: [0.01, 0.001] as [number, number],
  };
  const initial = evaluateClaim(spec, demoInitialRuns);
  assert.equal(initial.questionStatus, "waiting_for_run");
  assert.equal(initial.conclusions.length, 1);
  assert.equal(initial.conclusions[0]?.ruleId, "direction@0.01");

  const full = evaluateClaim(spec, demoAllRuns);
  assert.equal(full.questionStatus, "reviewable");
  assert.equal(full.conclusions.length, 2);
  assert.equal(full.conclusions[0]?.result, "pass");
  assert.match(String(full.conclusions[0]?.detail), /\+0\.20 个百分点/);
});

// ---------- 版本与身份边界 ----------

test("runId 不能冒充 revisionId", () => {
  const bad: AnalysisRevision = { ...demoRevision, revisionId: "R01" };
  const errors = validateRevision(bad, {
    question: demoQuestion,
    knownRunIds: demoAllRuns.map((r) => r.runId),
    knownRevisionIds: [],
  });
  assert.ok(errors.some((e) => e.includes("runId 不能冒充 revisionId")));

  const next = createNextRevision(
    demoRevision,
    {
      revisionId: "R02",
      createdAt: "2026-11-21T02:00:00.000Z",
      inputSnapshot: demoRevision.inputSnapshot,
      conclusions: [],
      evidenceRefs: [],
      suggestions: [],
      modelOutput: "pending",
    },
    {
      question: demoQuestion,
      knownRunIds: demoAllRuns.map((r) => r.runId),
      knownRevisionIds: ["rev_demo_0001"],
    },
  );
  assert.equal(next.ok, false);
});

test("跨项目引用被拒绝", () => {
  const foreignRun: TrainingRun = { ...demoInitialRuns[0]!, projectId: "p_other" };
  const badRevision: AnalysisRevision = {
    ...demoRevision,
    inputSnapshot: { ...demoRevision.inputSnapshot, runs: [foreignRun] },
    evidenceRefs: [{ runId: "R01", projectId: "p_other" }],
  };
  const errors = validateRevision(badRevision, {
    question: demoQuestion,
    knownRunIds: demoAllRuns.map((r) => r.runId),
    knownRevisionIds: [],
  });
  assert.ok(errors.some((e) => e.includes("跨项目引用被拒绝")));
  assert.ok(errors.some((e) => e.includes("跨项目证据引用被拒绝")));
});

test("模型输出状态与作业状态分开：failed 模型不抹掉已算结论", () => {
  const failedModel: AnalysisRevision = { ...demoRevision, modelOutput: "failed" };
  const errors = validateRevision(failedModel, {
    question: demoQuestion,
    knownRunIds: demoAllRuns.map((r) => r.runId),
    knownRevisionIds: [],
  });
  assert.deepEqual(errors, [], "modelOutput=failed 的版本仍是合法版本");
  assert.equal(failedModel.conclusions.length, 2, "已算出的结论保留");

  assert.deepEqual(validateJobStatus("failed"), []);
  assert.deepEqual(validateQuestionStatus("waiting_for_run"), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSummary } from "../src/experiment/storage.ts";
import type { TrainingRun } from "../src/experiment/types.ts";
import {
  buildSideTree,
  deriveLrOptions,
  evaluateEntryMissing,
  filterProjects,
  formatUpdatedAt,
  modelGlyph,
  normalizeProjectType,
  parseProjectTypes,
  statusGlyph,
} from "../src/web/model.ts";

function project(projectId: string, name: string, updatedAt: string): ProjectSummary {
  return { projectId, name, questionCount: 0, pendingCount: 0, updatedAt };
}

function run(lr: number | "unknown"): TrainingRun {
  return {
    runId: `r-${String(lr)}`,
    projectId: "p1",
    config: {
      model: "M1",
      evalSplit: "S1:v1",
      seed: 7,
      lr,
      augmentation: "off",
      optimizer: "adam",
      epochs: 20,
    },
    source: "demo",
    metrics: { accuracy: 80 },
    metadata: { importedAt: "2026-11-21T00:00:00.000Z" },
  };
}

test("项目搜索按名称过滤，空查询保持原列表", () => {
  const list = [
    project("p1", "增强开关研究", "2026-11-21T10:00:00.000Z"),
    project("p2", "学习率对比", "2026-11-21T09:00:00.000Z"),
  ];
  assert.equal(filterProjects(list, "").length, 2);
  assert.deepEqual(filterProjects(list, "学习率").map((p) => p.projectId), ["p2"]);
  assert.deepEqual(filterProjects(list, "  增强 ").map((p) => p.projectId), ["p1"]);
  assert.equal(filterProjects(list, "不存在").length, 0);
});

test("更新时间格式化为 MM-DD HH:mm", () => {
  assert.equal(formatUpdatedAt("2026-11-21T09:05:00.000Z").length, 11);
  assert.match(formatUpdatedAt("2026-11-21T09:05:00.000Z"), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatUpdatedAt("not-a-date"), "not-a-date");
});

test("学习率选项去重升序，unknown 跳过", () => {
  assert.deepEqual(deriveLrOptions([run(0.01), run(0.001), run(0.01), run("unknown")]), [
    0.001, 0.01,
  ]);
  assert.deepEqual(deriveLrOptions([run("unknown")]), []);
});

test("录入表单缺项只列缺失项", () => {
  const full = {
    rawClaim: "数据增强使准确率提高了 2 个百分点",
    dataText: "runId,model,...",
    baselineRunId: "R01",
    targetRunId: "R02",
    scope: "both_lrs" as const,
    targetLr: null,
  };
  assert.deepEqual(evaluateEntryMissing(full), []);

  assert.deepEqual(evaluateEntryMissing({ ...full, rawClaim: "  " }), ["主张原句"]);
  assert.deepEqual(evaluateEntryMissing({ ...full, dataText: "" }), ["训练数据（CSV/TSV）"]);
  assert.deepEqual(evaluateEntryMissing({ ...full, targetRunId: "" }), ["目标运行"]);
  assert.deepEqual(evaluateEntryMissing({ ...full, baselineRunId: "" }), ["基线运行"]);
  assert.deepEqual(evaluateEntryMissing({ ...full, scope: "" }), ["问题范围"]);
  assert.deepEqual(
    evaluateEntryMissing({ ...full, scope: "target_lr", targetLr: null }),
    ["目标学习率"],
  );
  assert.deepEqual(evaluateEntryMissing({ ...full, rawClaim: "", dataText: "" }), [
    "主张原句",
    "训练数据（CSV/TSV）",
  ]);
});

test("状态与模型输出用文字+形状表达", () => {
  assert.deepEqual(statusGlyph("needs_input"), { glyph: "◇", text: "待补充" });
  assert.deepEqual(statusGlyph("waiting_for_run"), { glyph: "◆", text: "待补跑" });
  assert.deepEqual(statusGlyph("reviewable"), { glyph: "●", text: "可分析" });
  assert.equal(modelGlyph("failed").glyph, "▲");
  assert.equal(modelGlyph("unavailable").text, "AI 未接通");
  assert.equal(modelGlyph("ready").glyph, "●");
});

// ---------- 问题详情矩阵（卡 10） ----------

import { buildEvidencePackage } from "../src/experiment/evidence.ts";
import type { ClaimSpec } from "../src/experiment/types.ts";
import { demoInitialRuns, demoQuestion } from "./fixtures/experiment-demo.ts";
import { buildQuestionMatrix, formatAccuracy } from "../src/web/model.ts";

const CTX = { projectId: "p_demo", questionId: "q_demo_0001" };

const TARGET_CLAIM: ClaimSpec = {
  factor: "augmentation",
  metric: "accuracy",
  targetRunId: "R02",
  baselineRunId: "R01",
  scope: "target_lr",
  learningRates: [0.001, 0.01],
  expectedDeltaPp: 2,
};

function cellOf(cells: ReturnType<typeof buildQuestionMatrix>["cells"], lr: number, aug: string) {
  const hit = cells.find((c) => c.lr === lr && c.augmentation === aug);
  assert.ok(hit, `缺少格子 ${lr}/${aug}`);
  return hit!;
}

test("V1 矩阵四格逐格核对：R01 实测、0.001/开未跑、0.01/关建议补跑、R02 实测", () => {
  const pkg = buildEvidencePackage(TARGET_CLAIM, demoInitialRuns, CTX);
  const matrix = buildQuestionMatrix(TARGET_CLAIM, demoInitialRuns, pkg);

  assert.deepEqual(matrix.lrs, [0.001, 0.01], "学习率升序");
  assert.deepEqual(matrix.fixedConditions, { model: "M1", evalSplit: "S1:v1", seed: "7" });

  const a = cellOf(matrix.cells, 0.001, "off");
  assert.equal(a.state, "measured");
  assert.equal(a.runId, "R01");
  assert.equal(formatAccuracy(a.accuracy!), "80.0%");

  const b = cellOf(matrix.cells, 0.001, "on");
  assert.equal(b.state, "empty");
  assert.equal(b.runId, null);

  const c = cellOf(matrix.cells, 0.01, "off");
  assert.equal(c.state, "suggested");
  assert.equal(c.accuracy, null, "待补格不得显示数值");
  assert.ok(c.cellId && c.cellId.includes("0.01:off"), "建议格应带 cellId");

  const d = cellOf(matrix.cells, 0.01, "on");
  assert.equal(d.state, "measured");
  assert.equal(d.runId, "R02");
  assert.equal(formatAccuracy(d.accuracy!), "82.0%");
});

test("两档范围后 0.001/开 也变为建议补跑", () => {
  const claimBoth = demoQuestion.confirmedClaim!;
  const pkg = buildEvidencePackage(claimBoth, demoInitialRuns, CTX);
  const matrix = buildQuestionMatrix(claimBoth, demoInitialRuns, pkg);
  assert.equal(cellOf(matrix.cells, 0.001, "on").state, "suggested");
  assert.equal(cellOf(matrix.cells, 0.01, "off").state, "suggested");
  assert.equal(cellOf(matrix.cells, 0.001, "off").state, "measured");
  assert.equal(cellOf(matrix.cells, 0.01, "on").state, "measured");
});

test("学习率输入乱序也按升序输出；空数据全为未跑且固定条件为占位", () => {
  const shuffled: ClaimSpec = { ...TARGET_CLAIM, learningRates: [0.01, 0.001] };
  const pkg = buildEvidencePackage(shuffled, demoInitialRuns, CTX);
  const matrix = buildQuestionMatrix(shuffled, demoInitialRuns, pkg);
  assert.deepEqual(matrix.lrs, [0.001, 0.01]);

  const emptyPkg = buildEvidencePackage(TARGET_CLAIM, [], CTX);
  const emptyMatrix = buildQuestionMatrix(TARGET_CLAIM, [], emptyPkg);
  assert.equal(emptyMatrix.cells.every((c) => c.state === "empty"), true);
  assert.deepEqual(emptyMatrix.fixedConditions, { model: "—", evalSplit: "—", seed: "—" });
});

test("长运行名与格式化：accuracy 始终一位小数百分数", () => {
  assert.equal(formatAccuracy(82), "82.0%");
  assert.equal(formatAccuracy(81.8), "81.8%");
  assert.equal(formatAccuracy(80), "80.0%");
});

// ---------- 卡 13：项目类型标签 + 侧栏树 ----------

test("项目类型只认字典内取值，其余归「其他」", () => {
  assert.equal(normalizeProjectType("计算机科学"), "计算机科学");
  assert.equal(normalizeProjectType("  数学  "), "数学");
  assert.equal(normalizeProjectType("天文学"), "其他");
  assert.equal(normalizeProjectType(""), "其他");
  assert.equal(normalizeProjectType("   "), "其他");
});

test("本机类型映射解析：损坏 JSON、数组、非字符串值一律剔除", () => {
  assert.deepEqual(parseProjectTypes(null), {});
  assert.deepEqual(parseProjectTypes(""), {});
  assert.deepEqual(parseProjectTypes("{broken"), {});
  assert.deepEqual(parseProjectTypes("[1,2]"), {});
  assert.deepEqual(parseProjectTypes('"text"'), {});
  assert.deepEqual(parseProjectTypes("null"), {});
  assert.deepEqual(parseProjectTypes('{"p1":"计算机科学","p2":42,"p3":"","p4":"  数学 "}'), {
    p1: "计算机科学",
    p4: "数学",
  });
});

test("侧栏树保持项目与问题顺序，空问题项目保留为空文件夹", () => {
  const projects = [
    project("p1", "增强开关", "2026-11-22T10:00:00.000Z"),
    project("p2", "空项目", "2026-11-22T09:00:00.000Z"),
    project("p3", "学习率", "2026-11-22T08:00:00.000Z"),
  ];
  const tree = buildSideTree(projects, {
    p1: [
      { questionId: "q1", rawClaim: "数据增强使准确率提高了 2 个百分点" },
      { questionId: "q2", rawClaim: "   " },
    ],
    p3: [{ questionId: "q3", rawClaim: "学习率 0.01 更好" }],
  });
  assert.deepEqual(tree.map((n) => n.projectId), ["p1", "p2", "p3"]);
  assert.equal(tree[0]!.name, "增强开关");
  assert.deepEqual(tree[0]!.questions.map((q) => q.questionId), ["q1", "q2"]);
  assert.equal(tree[0]!.questions[0]!.label, "数据增强使准确率提高了 2 个百分点");
  assert.equal(tree[0]!.questions[1]!.label, "(未填主张)");
  assert.deepEqual(tree[1]!.questions, []);
  assert.deepEqual(tree[2]!.questions.map((q) => q.label), ["学习率 0.01 更好"]);
});

test("侧栏树：无项目返回空数组，缺项目键视为空文件夹", () => {
  assert.deepEqual(buildSideTree([], { p1: [{ questionId: "q", rawClaim: "x" }] }), []);
  const tree = buildSideTree([project("p9", "孤岛", "2026-11-22T00:00:00.000Z")], {});
  assert.deepEqual(tree, [{ projectId: "p9", name: "孤岛", questions: [] }]);
});

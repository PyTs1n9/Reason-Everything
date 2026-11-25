import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSummary } from "../src/experiment/storage.ts";
import type { TrainingRun } from "../src/experiment/types.ts";
import {
  buildSideTree,
  cardFeatherVariant,
  computeDashboardStats,
  deriveLrOptions,
  evaluateEntryMissing,
  extractPaperTitle,
  filterProjects,
  formatUpdatedAt,
  highlightMatches,
  modelGlyph,
  normalizeProjectType,
  parseProjectTypes,
  sortProjects,
  statusGlyph,
  typeColorClass,
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

// ---------- 卡 15：工作台统计 / 搜索高亮 / 置顶排序 / 类型配色 / PDF 题名 ----------

test("工作台统计：项目数/问题总数/近 7 天更新，边界与坏时间戳不计入", () => {
  const now = "2026-11-23T12:00:00.000Z";
  const list = [
    { ...project("p1", "甲", "2026-11-22T10:00:00.000Z"), questionCount: 3 },
    { ...project("p2", "乙", "2026-11-20T10:00:00.000Z"), questionCount: 1 },
    { ...project("p3", "丙", "2026-11-01T10:00:00.000Z"), questionCount: 2 },
  ];
  assert.deepEqual(computeDashboardStats(list, now), {
    projectCount: 3,
    questionCount: 6,
    weekUpdated: 2,
  });
  assert.deepEqual(computeDashboardStats([], now), { projectCount: 0, questionCount: 0, weekUpdated: 0 });

  const edge = [
    project("p1", "恰在边界", "2026-11-16T12:00:00.000Z"),
    project("p2", "未来时间", "2026-11-24T12:00:00.000Z"),
    project("p3", "坏值", "not-a-date"),
  ];
  assert.deepEqual(computeDashboardStats(edge, now), { projectCount: 3, questionCount: 0, weekUpdated: 0 });
  assert.equal(computeDashboardStats([project("p1", "边界内", "2026-11-16T12:00:00.001Z")], now).weekUpdated, 1);
});

test("搜索高亮：大小写不敏感多段切分，空查询/无匹配/空名返回单段", () => {
  assert.deepEqual(highlightMatches("增强开关研究", ""), [{ text: "增强开关研究", hit: false }]);
  assert.deepEqual(highlightMatches("增强开关研究", "不存在"), [{ text: "增强开关研究", hit: false }]);
  assert.deepEqual(highlightMatches("增强开关研究", "  增强 "), [
    { text: "增强", hit: true },
    { text: "开关研究", hit: false },
  ]);
  assert.deepEqual(highlightMatches("abcABC", "bc"), [
    { text: "a", hit: false },
    { text: "bc", hit: true },
    { text: "A", hit: false },
    { text: "BC", hit: true },
  ]);
  assert.deepEqual(highlightMatches("DataFlow", "data"), [
    { text: "Data", hit: true },
    { text: "Flow", hit: false },
  ]);
  assert.deepEqual(highlightMatches("", "x"), [{ text: "", hit: false }]);
});

test("置顶排序：置顶优先且两组按更新时间倒序，坏时间戳排最后，不改输入", () => {
  const list = [
    project("p1", "甲", "2026-11-23T10:00:00.000Z"),
    project("p2", "乙", "2026-11-22T10:00:00.000Z"),
    project("p3", "丙", "2026-11-21T10:00:00.000Z"),
    project("p4", "丁", "not-a-date"),
  ];
  assert.deepEqual(sortProjects(list, new Set(["p3", "p4"])).map((p) => p.projectId), ["p3", "p4", "p1", "p2"]);
  assert.deepEqual(sortProjects(list, new Set()).map((p) => p.projectId), ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(list.map((p) => p.projectId), ["p1", "p2", "p3", "p4"]);
});

test("类型配色：六类型固定色，字典外归「其他」灰", () => {
  assert.equal(typeColorClass("计算机科学"), "type-cs");
  assert.equal(typeColorClass("数学"), "type-math");
  assert.equal(typeColorClass("生物学"), "type-bio");
  assert.equal(typeColorClass("医学"), "type-med");
  assert.equal(typeColorClass("经济学"), "type-econ");
  assert.equal(typeColorClass("其他"), "type-other");
  assert.equal(typeColorClass("天文学"), "type-other");
  assert.equal(typeColorClass(""), "type-other");
});

test("PDF 题名：元数据优先，退回首页非空行，均无返回空串且截断 120 字", () => {
  assert.equal(extractPaperTitle({ metaTitle: "  论文标题  ", firstPageText: "首行" }), "论文标题");
  assert.equal(extractPaperTitle({ metaTitle: "", firstPageText: "\n  \n  Real Title\nRest" }), "Real Title");
  assert.equal(extractPaperTitle({}), "");
  assert.equal(extractPaperTitle({ metaTitle: "", firstPageText: "   \n\n" }), "");
  assert.equal(extractPaperTitle({ metaTitle: "x".repeat(200) }).length, 120);
});

test("卡片羽毛：同一项目稳定复现，不同项目产生随机配色与轻微几何变化", () => {
  const first = cardFeatherVariant("p_demo");
  assert.deepEqual(cardFeatherVariant("p_demo"), first);
  const variants = Array.from({ length: 12 }, (_, index) => cardFeatherVariant(`project-${index}`));
  assert.ok(new Set(variants.map((item) => item.colors.join(","))).size > 1);
  assert.ok(new Set(variants.map((item) => item.rotate)).size > 1);
  assert.ok(new Set(variants.map((item) => item.scale)).size > 1);
  assert.ok(new Set(variants.map((item) => `${item.x},${item.y}`)).size > 1);
  assert.equal(new Set(variants.map((item) => item.id)).size, variants.length);
  for (const item of variants) {
    assert.match(item.id, /^[0-9a-z]+$/);
    assert.equal(item.colors.length, 3);
    for (const color of item.colors) assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.ok(item.x >= 12 && item.x <= 23);
    assert.ok(item.y >= 10 && item.y <= 21);
    assert.ok(item.scale >= 0.9 && item.scale <= 1.04);
    assert.ok(item.rotate >= -4 && item.rotate <= 4);
    assert.ok(item.angle >= 112 && item.angle <= 128);
    assert.ok(item.glowX >= 22 && item.glowX <= 87);
    assert.ok(item.glowY >= 12 && item.glowY <= 49);
  }
  assert.deepEqual(cardFeatherVariant(""), cardFeatherVariant(""));
});

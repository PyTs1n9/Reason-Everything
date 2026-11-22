import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSummary } from "../src/experiment/storage.ts";
import type { TrainingRun } from "../src/experiment/types.ts";
import {
  deriveLrOptions,
  evaluateEntryMissing,
  filterProjects,
  formatUpdatedAt,
  modelGlyph,
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

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRuns,
  diffRunConfigs,
  mapHeaders,
  observeAccuracyDelta,
  parseTable,
  previewImport,
} from "../src/experiment/import.ts";
import { configsMatch, isStrictlyPairable, validateRun } from "../src/experiment/runs.ts";
import type { TrainingRun } from "../src/experiment/types.ts";
import { demoInitialRuns } from "./fixtures/experiment-demo.ts";

const OPT = {
  projectId: "p_demo",
  source: "demo" as const,
  importedAt: "2026-11-21T00:00:00.000Z",
};

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const ROW_R01 = "R01,M1,S1:v1,7,0.001,off,adam,20,80";
const ROW_R02 = "R02,M1,S1:v1,7,1e-2,on,adam,20,82";

function csv(...rows: string[]): string {
  return rows.join("\r\n") + "\r\n\r\n";
}

// ---------- 整条导入链 ----------

test("样例行整链：CRLF、尾部空行、科学计数，R01/R02 正确入库", () => {
  const text = csv(HEADER, ROW_R01, ROW_R02);
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, false);
  assert.equal(preview.mapping.status, "ok");
  assert.equal(preview.added.length, 2);

  const r01 = preview.added[0]!;
  const r02 = preview.added[1]!;
  assert.equal(r01.runId, "R01");
  assert.equal(r01.config.lr, 0.001);
  assert.equal(r01.config.augmentation, "off");
  assert.equal(r01.metrics.accuracy, 80);
  assert.equal(r02.config.lr, 0.01, "1e-2 归一为 0.01");
  assert.equal(r02.config.lr, 1e-2, "0.01 与 1e-2 数值相同");
  assert.equal(r02.metrics.accuracy, 82);
  assert.equal(r01.source, "demo");
  assert.deepEqual(validateRun(r01), []);
  assert.deepEqual(validateRun(r02), []);
});

test("UTF-8 BOM 与 LF 也能正确识别表头", () => {
  const text = "﻿" + [HEADER, ROW_R01].join("\n") + "\n";
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.mapping.status, "ok");
  assert.equal(preview.added.length, 1);
  assert.equal(preview.mapping.columns[0]?.header, "runId");
});

test("引号内逗号与双引号转义原样保留", () => {
  const header = HEADER + ",note";
  const row = ROW_R01 + ',"great, better than ""baseline"""';
  const preview = previewImport(csv(header, row), { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, false);
  assert.equal(preview.added[0]?.metadata.note, 'great, better than "baseline"');
});

test("Excel 粘贴的 TSV 按制表符解析", () => {
  const tsv = [
    "runId\tmodel\tevalSplit\tseed\tlr\taugmentation\toptimizer\tepochs\taccuracy",
    "R01\tM1\tS1:v1\t7\t0.001\toff\tadam\t20\t80",
  ].join("\r\n");
  const preview = previewImport(tsv, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, false);
  assert.equal(preview.added.length, 1);
  assert.equal(preview.added[0]?.config.lr, 0.001);
});

test("中英文别名都能自动识别", () => {
  const text = [
    "运行编号,模型,评测集,种子,学习率,增强,优化器,轮数,准确率",
    ROW_R01,
  ].join("\n");
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.mapping.status, "ok");
  assert.equal(preview.added[0]?.runId, "R01");
  assert.equal(preview.added[0]?.config.model, "M1");
  assert.equal(preview.added[0]?.config.lr, 0.001);
});

// ---------- 单位 ----------

test("百分数列：80%、80、80.00 都读作 80；不猜比例", () => {
  const text = [
    HEADER,
    "R01,M1,S1:v1,7,0.001,off,adam,20,80%",
    "R02,M1,S1:v1,7,0.01,on,adam,20,80",
    "R03,M1,S1:v1,7,0.01,off,adam,20,80.00",
    "R04,M1,S1:v1,7,0.001,on,adam,20,0.8",
  ].join("\n");
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, false);
  const values = preview.added.map((r) => r.metrics.accuracy);
  assert.deepEqual(values, [80, 80, 80, 0.8], "percent 模式不把 0.8 猜成 80");
});

test("比例 0–1 模式显式换算：0.8 → 80、0.818 → 81.8；80 越界拒绝", () => {
  const text = [
    HEADER,
    "R01,M1,S1:v1,7,0.001,off,adam,20,0.8",
    "R02,M1,S1:v1,7,0.01,on,adam,20,0.818",
  ].join("\n");
  const preview = previewImport(text, { ...OPT, existingRuns: [], accuracyUnit: "ratio" });
  assert.equal(preview.blocking, false);
  assert.deepEqual(
    preview.added.map((r) => r.metrics.accuracy),
    [80, 81.8],
  );

  const bad = previewImport(
    [HEADER, "R01,M1,S1:v1,7,0.001,off,adam,20,80"].join("\n"),
    { ...OPT, existingRuns: [], accuracyUnit: "ratio" },
  );
  assert.equal(bad.blocking, true);
  assert.equal(bad.added.length, 0);
  assert.equal(bad.errors[0]?.row, 1);
  assert.equal(bad.errors[0]?.column, "accuracy");
  assert.match(bad.errors[0]?.message ?? "", /0–1/);
});

// ---------- 表头歧义 ----------

test("同一语义两个候选列 → needs_mapping，不静默取第一列", () => {
  const header = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,acc,准确率";
  const result = mapHeaders(header.split(","));
  assert.equal(result.status, "needs_mapping");
  assert.ok(
    result.conflicts.some(
      (c) => c.field === "accuracy" && c.headers.includes("acc") && c.headers.includes("准确率"),
    ),
  );

  const blocked = previewImport([header, ROW_R01].join("\n"), { ...OPT, existingRuns: [] });
  assert.equal(blocked.blocking, true);
  assert.equal(blocked.added.length, 0);

  const resolved = previewImport([header, ROW_R01 + ",80"].join("\n"), {
    ...OPT,
    existingRuns: [],
    overrides: { acc: "ignored" },
  });
  assert.equal(resolved.mapping.status, "ok");
  assert.equal(resolved.blocking, false);
  assert.equal(resolved.added[0]?.metrics.accuracy, 80);
});

// ---------- 重复 / 冲突 / 缺配置 ----------

test("同项目重复导入相同 runId、相同内容 → 去重", () => {
  const text = csv(HEADER, ROW_R01, ROW_R02);
  const first = previewImport(text, { ...OPT, existingRuns: [] });
  const second = previewImport(text, { ...OPT, existingRuns: first.added });
  assert.equal(second.blocking, false);
  assert.equal(second.added.length, 0);
  assert.equal(second.duplicates.length, 2);
  assert.equal(second.conflicts.length, 0);

  const inBatch = previewImport(csv(HEADER, ROW_R01, ROW_R01), { ...OPT, existingRuns: [] });
  assert.equal(inBatch.added.length, 1);
  assert.equal(inBatch.duplicates.length, 1);
});

test("同 ID 不同内容 → 冲突并阻止整批提交，不覆盖旧实验", () => {
  const changed = csv(HEADER, "R01,M1,S1:v1,7,0.001,off,adam,20,85");
  const preview = previewImport(changed, { ...OPT, existingRuns: demoInitialRuns });
  assert.equal(preview.blocking, true);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0]?.runId, "R01");
  assert.equal(preview.conflicts[0]?.existing.metrics.accuracy, 80, "旧实验原样保留");
  assert.equal(preview.conflicts[0]?.incoming.metrics.accuracy, 85);
  assert.equal(preview.added.length, 0);
});

test("不同项目可独立拥有 R01", () => {
  const text = csv(HEADER, ROW_R01);
  const other = previewImport(text, { ...OPT, projectId: "p_other", existingRuns: demoInitialRuns });
  assert.equal(other.blocking, false);
  assert.equal(other.added.length, 1);
  assert.equal(other.added[0]?.projectId, "p_other");

  const same = previewImport(text, { ...OPT, existingRuns: demoInitialRuns });
  assert.equal(same.duplicates.length, 1, "同项目同内容仍去重");
});

test("缺配置保存为不完整记录，不能严格配对；缺整列同理", () => {
  const missingSeed = [
    "runId,model,evalSplit,lr,augmentation,optimizer,epochs,accuracy",
    "R01,M1,S1:v1,0.001,off,adam,20,80",
  ].join("\n");
  const preview = previewImport(missingSeed, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, false, "缺配置不阻止保存");
  assert.equal(preview.added.length, 0);
  assert.equal(preview.incomplete.length, 1);
  assert.equal(preview.incomplete[0]?.config.seed, "unknown");
  assert.equal(isStrictlyPairable(preview.incomplete[0]!.config), false);

  const emptySeed = [
    HEADER,
    "R01,M1,S1:v1,,0.001,off,adam,20,80",
  ].join("\n");
  const p2 = previewImport(emptySeed, { ...OPT, existingRuns: [] });
  assert.equal(p2.incomplete.length, 1);
  assert.equal(p2.incomplete[0]?.config.seed, "unknown");
});

test("空值、NaN、Infinity、越界指标拒绝并报行、列", () => {
  const text = [
    HEADER,
    "R01,M1,S1:v1,7,0.001,off,adam,20,",
    "R02,M1,S1:v1,7,0.01,on,adam,20,abc",
    "R03,M1,S1:v1,7,0.01,off,adam,20,Infinity",
    "R04,M1,S1:v1,7,0.001,on,adam,20,101",
    "R05,M1,S1:v1,7,0.001,on,adam,20,80.123",
  ].join("\n");
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, true);
  assert.equal(preview.added.length, 0);
  assert.equal(preview.errors.length, 5);
  assert.deepEqual(
    preview.errors.map((e) => e.row),
    [1, 2, 3, 4, 5],
  );
  for (const e of preview.errors) assert.equal(e.column, "accuracy");
  assert.match(preview.errors[0]?.message ?? "", /为空/);
  assert.match(preview.errors[1]?.message ?? "", /不是数字/);
  assert.match(preview.errors[2]?.message ?? "", /有限数/);
  assert.match(preview.errors[3]?.message ?? "", /0–100/);
  assert.match(preview.errors[4]?.message ?? "", /两位小数/);
});

test("runId 为空报行、列", () => {
  const text = [HEADER, ",M1,S1:v1,7,0.001,off,adam,20,80"].join("\n");
  const preview = previewImport(text, { ...OPT, existingRuns: [] });
  assert.equal(preview.blocking, true);
  assert.equal(preview.errors[0]?.row, 1);
  assert.equal(preview.errors[0]?.column, "runId");
});

test("乱序列：列顺序打乱仍映射出相同的规范配置", () => {
  const ordered = previewImport(csv(HEADER, ROW_R01), { ...OPT, existingRuns: [] });
  const shuffledHeader = "accuracy,runId,lr,model,augmentation,seed,evalSplit,epochs,optimizer";
  const shuffledRow = "80,R01,0.001,M1,off,7,S1:v1,20,adam";
  const shuffled = previewImport(csv(shuffledHeader, shuffledRow), { ...OPT, existingRuns: [] });
  assert.equal(shuffled.blocking, false);
  assert.deepEqual(shuffled.added[0]?.config, ordered.added[0]?.config);
  assert.equal(shuffled.added[0]?.metrics.accuracy, ordered.added[0]?.metrics.accuracy);
});

// ---------- 未知列 ----------

test("未知列原样保留，确认角色后才参与核验与匹配", () => {
  const header = HEADER + ",gradClip";
  const rowA = ROW_R01 + ",0.5";
  const rowB = ROW_R01.replace("R01", "R09") + ",0.9";

  const pending = previewImport(csv(header, rowA, rowB), { ...OPT, existingRuns: [] });
  assert.equal(pending.blocking, false, "未确认的未知列不阻止导入");
  assert.deepEqual(pending.unmapped, [
    { header: "gradClip", values: ["0.5", "0.9"] },
  ]);
  assert.equal(pending.added[0]?.config.extras, undefined, "未确认前不写入配置");

  const confirmedA = previewImport(csv(header, rowA), {
    ...OPT,
    existingRuns: [],
    unknownRoles: { gradClip: "config" },
  });
  assert.equal(confirmedA.added[0]?.config.extras?.gradClip, 0.5);
  const confirmedB = previewImport(csv(header, rowB), {
    ...OPT,
    existingRuns: [],
    unknownRoles: { gradClip: "config" },
  });
  assert.equal(
    configsMatch(confirmedA.added[0]!.config, confirmedB.added[0]!.config),
    false,
    "未知项不能被写成一致",
  );
  const confirmedA2 = previewImport(
    csv(header, ROW_R01 + ",0.5"),
    { ...OPT, existingRuns: [], unknownRoles: { gradClip: "config" } },
  );
  assert.equal(
    configsMatch(confirmedA.added[0]!.config, confirmedA2.added[0]!.config),
    true,
    "同值才一致",
  );
});

// ---------- 配置差异 ----------

test("R01→R02 配置差异仅为增强与学习率，观测差 +2.00 个百分点", () => {
  const r01 = demoInitialRuns[0]!;
  const r02 = demoInitialRuns[1]!;

  const diff = diffRunConfigs(r01, r02);
  assert.equal(diff.length, 2, `实际差异: ${JSON.stringify(diff)}`);
  const byField = new Map(diff.map((d) => [d.field, d]));
  assert.deepEqual(byField.get("augmentation"), {
    field: "augmentation",
    oldValue: "off",
    newValue: "on",
  });
  assert.deepEqual(byField.get("lr"), { field: "lr", oldValue: 0.001, newValue: 0.01 });
  assert.equal(
    diff.some((d) => d.field === "accuracy" || d.field === "runId"),
    false,
    "准确率与运行名不算训练配置差异",
  );

  const observation = observeAccuracyDelta(r02, r01);
  assert.equal(observation.direction, "提高");
  assert.equal(observation.deltaPp, "+2.00");
  assert.match(observation.detail, /R02=82 vs R01=80 → 提高 \+2\.00 个百分点/);
});

test("配置差异包含未知项，未知不写成一致", () => {
  const withUnknown: TrainingRun = {
    ...demoInitialRuns[0]!,
    config: { ...demoInitialRuns[0]!.config, seed: "unknown" },
  };
  const diff = diffRunConfigs(withUnknown, demoInitialRuns[0]!);
  assert.deepEqual(diff, [
    { field: "seed", oldValue: "unknown", newValue: 7 },
  ]);

  const bothUnknown: TrainingRun = {
    ...withUnknown,
    config: { ...withUnknown.config, lr: "unknown" },
  };
  const other: TrainingRun = {
    ...demoInitialRuns[0]!,
    config: { ...demoInitialRuns[0]!.config, lr: "unknown" },
  };
  const diff2 = diffRunConfigs(bothUnknown, other);
  assert.ok(
    diff2.some((d) => d.field === "lr" && d.oldValue === "unknown" && d.newValue === "unknown"),
    "unknown 对 unknown 也列出，不冒充一致",
  );
});

// ---------- 解析细节 ----------

test("parseTable 按首行识别 TSV，引号内的制表符不被切开", () => {
  const table = parseTable('a\tb\n"x\ty"\tc\n');
  assert.equal(table.delimiter, "\t");
  assert.deepEqual(table.header, ["a", "b"]);
  assert.deepEqual(table.rows, [["x\ty", "c"]]);
});

test("buildRuns 在映射未定时不产出任何记录", () => {
  const result = buildRuns(parseTable("runId,acc,准确率\nR01,80,80\n"), OPT);
  assert.equal(result.ok, false);
  assert.equal(result.mapping.status, "needs_mapping");
  assert.equal(result.rows.length, 0);
});

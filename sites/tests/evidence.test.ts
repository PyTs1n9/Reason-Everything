import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEvidencePackage,
  type EvidencePackage,
} from "../src/experiment/evidence.ts";
import type { ClaimSpec, TrainingRun } from "../src/experiment/types.ts";
import {
  demoAllRuns,
  demoBackfillRuns,
  demoInitialRuns,
  demoQuestion,
} from "./fixtures/experiment-demo.ts";

const CTX = { projectId: "p_demo", questionId: "q_demo_0001" };

const BASE_CLAIM = {
  factor: "augmentation",
  metric: "accuracy",
  targetRunId: "R02",
  baselineRunId: "R01",
  expectedDeltaPp: 2,
} as const;

const TARGET_CLAIM: ClaimSpec = {
  ...BASE_CLAIM,
  scope: "target_lr",
  learningRates: [0.01, 0.001],
};

const BOTH_CLAIM: ClaimSpec = demoQuestion.confirmedClaim!;

const R01 = demoInitialRuns[0]!;
const R02 = demoInitialRuns[1]!;
const R03 = demoBackfillRuns[0]!;
const R04 = demoBackfillRuns[1]!;

function withR03(): TrainingRun[] {
  return [R01, R02, R03];
}

function summarize(pkg: EvidencePackage): Record<string, unknown> {
  return {
    status: pkg.status,
    contribution: pkg.augmentationContributionPp,
    cells: pkg.cells.map(
      (c) =>
        `${c.cellId.split(":").slice(-2).join("/")}=${c.status}${c.runId ? `:${c.runId}` : ""}`,
    ),
    pairs: pkg.pairs.map(
      (p) => `lr=${p.lr} ${p.treatedRunId}-${p.controlRunId} ${p.direction} ${p.deltaPp}`,
    ),
    suggestions: pkg.suggestions.map((s) => ({
      cell: s.cellId.split(":").slice(-2).join("/"),
      copy: s.copyFromRunId,
      change: s.change.map((c) => `${c.field}:${c.from}->${c.to}`),
      compare: s.compareToRunId,
    })),
    missingConfigs: pkg.missingConfigs.map((m) => `${m.runId}[${m.unknownFields.join(",")}]`),
    duplicates: pkg.duplicateCandidates.map((d) => `[${d.runIds.join(",")}]`),
    counterexample: pkg.counterexample,
    coverage: pkg.coverage,
    observation: pkg.observation
      ? `${pkg.observation.targetRunId}-${pkg.observation.baselineRunId} ${pkg.observation.deltaPp} diff=${pkg.observation.configDiff.map((d) => d.field).join("+")}`
      : null,
  };
}

function print(tag: string, pkg: EvidencePackage): void {
  console.log(`[${tag}] ${JSON.stringify(summarize(pkg))}`);
}

// ---------- 断言 A ----------

test("A：仅 R01、R02，目标 0.01 → 只建议补 0.01/关，增强贡献 null", () => {
  const pkg = buildEvidencePackage(TARGET_CLAIM, demoInitialRuns, CTX);
  print("A", pkg);

  assert.equal(pkg.status, "waiting_for_run");
  assert.equal(pkg.augmentationContributionPp, null, "无严格配对 → 增强贡献为 null");
  assert.equal(pkg.pairs.length, 0);
  assert.equal(pkg.cells.length, 2, "target_lr 只开目标档两格");
  assert.equal(pkg.cells[0]?.status, "measured");
  assert.equal(pkg.cells[0]?.runId, "R02");
  assert.equal(pkg.cells[1]?.cellId, "cell:p_demo:augmentation:accuracy:0.01:off");
  assert.equal(pkg.cells[1]?.status, "requested");
  assert.equal(pkg.cells[1]?.accuracy, null, "缺测值为 null");

  assert.equal(pkg.suggestions.length, 1, "只补一格");
  const s = pkg.suggestions[0]!;
  assert.equal(s.cellId, "cell:p_demo:augmentation:accuracy:0.01:off");
  assert.equal(s.copyFromRunId, "R02");
  assert.deepEqual(s.change, [{ field: "augmentation", from: "on", to: "off" }]);
  assert.equal(s.compareToRunId, "R02");
  assert.match(s.text, /复制 R02 的配置/);
  assert.match(s.text, /augmentation: on → off/);
  assert.match(s.text, /完成后与运行 R02比较/);

  assert.equal(pkg.observation?.deltaPp, "+2.00", "原始观测差 +2.00");
  assert.deepEqual(
    pkg.observation?.configDiff.map((d) => d.field),
    ["lr", "augmentation"],
    "观测的两次运行同时差 lr 与增强",
  );
  assert.equal(pkg.counterexample.exists, false, "没有配对就没有反例");
});

// ---------- 断言 B ----------

test("B：追加 R03 → 配对 R02/R03 差 +0.20，方向为正，+2 幅度不符", () => {
  const pkg = buildEvidencePackage(TARGET_CLAIM, withR03(), CTX);
  print("B", pkg);

  assert.equal(pkg.status, "reviewable");
  assert.equal(pkg.pairs.length, 1);
  const pair = pkg.pairs[0]!;
  assert.equal(pair.treatedRunId, "R02");
  assert.equal(pair.controlRunId, "R03");
  assert.equal(pair.deltaPp, "+0.20");
  assert.equal(pair.direction, "提高");
  assert.equal(pkg.augmentationContributionPp, "+0.20");
  assert.equal(pkg.suggestions.length, 0, "该档已配对，无补跑单");

  assert.equal(pkg.counterexample.exists, true, "0.20 < 2 → 原幅度主张被反驳");
  assert.deepEqual(pkg.counterexample.refutingLrs, [0.01]);
  assert.match(String(pkg.counterexample.statement), /反驳/);
  assert.equal(pkg.coverage.complete, true);
  assert.deepEqual(pkg.coverage.measuredLrs, [0.01]);
});

// ---------- 断言 C ----------

test("C：初始两行 + 两档范围 → 需 0.01/关 和 0.001/开", () => {
  const pkg = buildEvidencePackage(BOTH_CLAIM, demoInitialRuns, CTX);
  print("C", pkg);

  assert.equal(pkg.status, "waiting_for_run");
  assert.equal(pkg.cells.length, 4);
  assert.equal(pkg.pairs.length, 0);
  assert.equal(pkg.augmentationContributionPp, null);

  const requested = pkg.cells.filter((c) => c.status === "requested");
  assert.deepEqual(
    requested.map((c) => c.cellId),
    [
      "cell:p_demo:augmentation:accuracy:0.001:on",
      "cell:p_demo:augmentation:accuracy:0.01:off",
    ],
    "缺两格就明确两格",
  );
  assert.equal(pkg.suggestions.length, 2, "两档各需一次补跑，不能声称跑一次即可");
  const cells = pkg.suggestions.map((s) => s.cellId.split(":").slice(-2).join("/"));
  assert.deepEqual(cells.sort(), ["0.001/on", "0.01/off"]);

  const s001 = pkg.suggestions.find((s) => s.cellId.endsWith(":0.001:on"))!;
  assert.equal(s001.copyFromRunId, "R01");
  assert.deepEqual(s001.change, [{ field: "augmentation", from: "off", to: "on" }]);
  assert.equal(s001.compareToRunId, "R01");

  assert.equal(pkg.counterexample.exists, false, "无配对 → 无反例");
  assert.equal(pkg.coverage.complete, false);
  assert.deepEqual(pkg.coverage.requiredLrs, [0.001, 0.01]);
  assert.deepEqual(pkg.coverage.measuredLrs, []);
});

// ---------- 断言 D ----------

test("D：四行齐全 → 两档差 +0.20 与 +0.50", () => {
  const pkg = buildEvidencePackage(BOTH_CLAIM, demoAllRuns, CTX);
  print("D", pkg);

  assert.equal(pkg.status, "reviewable");
  assert.equal(pkg.pairs.length, 2);
  assert.equal(pkg.suggestions.length, 0);

  const byLr = new Map(pkg.pairs.map((p) => [p.lr, p]));
  assert.equal(byLr.get(0.01)?.deltaPp, "+0.20");
  assert.equal(byLr.get(0.01)?.treatedRunId, "R02");
  assert.equal(byLr.get(0.01)?.controlRunId, "R03");
  assert.equal(byLr.get(0.001)?.deltaPp, "+0.50");
  assert.equal(byLr.get(0.001)?.treatedRunId, "R04");
  assert.equal(byLr.get(0.001)?.controlRunId, "R01");

  assert.equal(pkg.counterexample.exists, true, "两档都未达 2pp → 全称主张被反驳");
  assert.deepEqual([...pkg.counterexample.refutingLrs].sort(), [0.001, 0.01]);
  assert.equal(pkg.coverage.complete, true, "反例与覆盖分开：此处覆盖也齐");
  assert.equal(pkg.augmentationContributionPp, null, "两档逐档见 pairs");
});

// ---------- 断言 E ----------

test("E：R03 seed=8 或 optimizer=sgd 都不能与 R02 配对", () => {
  for (const patch of [{ seed: 8 }, { optimizer: "sgd" }] as const) {
    const changed: TrainingRun = { ...R03, config: { ...R03.config, ...patch } };
    const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, changed], CTX);
    print(`E(${Object.keys(patch)[0]})`, pkg);

    assert.equal(pkg.pairs.length, 0, `配置 ${JSON.stringify(patch)} 不得配对`);
    assert.equal(pkg.augmentationContributionPp, null);
    assert.equal(pkg.status, "waiting_for_run");
    const cell = pkg.cells.find((c) => c.cellId.endsWith(":0.01:off"))!;
    assert.equal(cell.status, "requested");
    assert.equal(pkg.suggestions.length, 1, "该格退回缺测并出补跑单");
    assert.equal(pkg.suggestions[0]?.copyFromRunId, "R02");
  }
});

// ---------- 断言 F ----------

test("F：同条件旧记录直接复用，没有重复补跑单", () => {
  const extra: TrainingRun = {
    ...R02,
    runId: "R09",
    config: { ...R02.config, lr: 0.05 },
    metrics: { accuracy: 77 },
  };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [...demoAllRuns, extra], CTX);
  print("F", pkg);

  assert.equal(pkg.status, "reviewable");
  assert.equal(pkg.suggestions.length, 0, "已存在的同条件记录复用，不重复补跑");
  assert.equal(pkg.pairs.length, 1);
  assert.equal(pkg.pairs[0]?.treatedRunId, "R02");
  assert.equal(pkg.pairs[0]?.controlRunId, "R03");
  assert.equal(pkg.augmentationContributionPp, "+0.20");
  assert.equal(
    pkg.cells.some((c) => c.cellId.includes(":0.05:")),
    false,
    "未选中的其他空格保持普通空格，不入证据包",
  );
  assert.equal(pkg.unmetConditions.length, 0);
});

// ---------- 附加 ----------

test("效果为 0 → 方向未变，反例成立", () => {
  const flat: TrainingRun = { ...R03, metrics: { accuracy: 82.0 } };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, flat], CTX);
  assert.equal(pkg.pairs[0]?.deltaPp, "0.00");
  assert.equal(pkg.pairs[0]?.direction, "未变");
  assert.equal(pkg.counterexample.exists, true);
  assert.equal(pkg.augmentationContributionPp, "0.00");
});

test("效果为负数 → 方向下降，反例成立", () => {
  const worse: TrainingRun = { ...R03, metrics: { accuracy: 83 } };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, worse], CTX);
  assert.equal(pkg.pairs[0]?.deltaPp, "-1.00");
  assert.equal(pkg.pairs[0]?.direction, "下降");
  assert.equal(pkg.counterexample.exists, true);
  assert.match(String(pkg.counterexample.statement), /反驳/);
});

test("仅方向主张（无增幅）：未变即反例", () => {
  const directionOnly: ClaimSpec = { ...TARGET_CLAIM, expectedDeltaPp: null };
  const flat: TrainingRun = { ...R03, metrics: { accuracy: 82.0 } };
  const pkg = buildEvidencePackage(directionOnly, [R01, R02, flat], CTX);
  assert.equal(pkg.counterexample.exists, true);
  assert.match(String(pkg.counterexample.statement), /方向/);
});

test("未知条件 → needs_input，进 missingConfigs，不发补跑单", () => {
  const unknownSeed: TrainingRun = {
    ...R03,
    config: { ...R03.config, seed: "unknown" },
  };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, unknownSeed], CTX);
  print("unknown", pkg);

  assert.equal(pkg.status, "needs_input");
  assert.equal(pkg.missingConfigs.length, 1);
  assert.equal(pkg.missingConfigs[0]?.runId, "R03");
  assert.deepEqual(pkg.missingConfigs[0]?.unknownFields, ["seed"]);
  const cell = pkg.cells.find((c) => c.cellId.endsWith(":0.01:off"))!;
  assert.equal(cell.status, "missing", "有配置待确认 → 不是可补跑的 missing 运行");
  assert.equal(pkg.suggestions.length, 0, "先确认配置，不急着补跑");
  assert.equal(pkg.pairs.length, 0);
});

test("记录乱序不改变配对与输出", () => {
  const forward = buildEvidencePackage(BOTH_CLAIM, demoAllRuns, CTX);
  const reversed = buildEvidencePackage(BOTH_CLAIM, [...demoAllRuns].reverse(), CTX);
  const shuffled = buildEvidencePackage(
    BOTH_CLAIM,
    [demoAllRuns[2]!, demoAllRuns[0]!, demoAllRuns[3]!, demoAllRuns[1]!],
    CTX,
  );
  assert.deepEqual(reversed, forward);
  assert.deepEqual(shuffled, forward);
});

test("不同项目的同 ID 记录不参与配对", () => {
  const foreign: TrainingRun = {
    ...R03,
    projectId: "p_other",
  };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, foreign], CTX);
  print("foreign", pkg);

  assert.equal(pkg.pairs.length, 0, "跨项目 R03 不可用");
  assert.equal(pkg.status, "waiting_for_run");
  assert.equal(pkg.suggestions.length, 1, "本项目该格仍缺测");
  assert.equal(pkg.cells.find((c) => c.cellId.endsWith(":0.01:off"))?.status, "requested");
});

test("重复候选列出全部 runId 并要求选定，不挑准确率最高者", () => {
  const higher: TrainingRun = {
    ...R03,
    runId: "R05",
    metrics: { accuracy: 99 },
  };
  const pkg = buildEvidencePackage(TARGET_CLAIM, [R01, R02, R03, higher], CTX);
  print("duplicate", pkg);

  assert.equal(pkg.status, "needs_input");
  assert.equal(pkg.duplicateCandidates.length, 1);
  assert.deepEqual(pkg.duplicateCandidates[0]?.runIds, ["R03", "R05"]);
  const cell = pkg.cells.find((c) => c.cellId.endsWith(":0.01:off"))!;
  assert.equal(cell.runId, null, "不自动选择，尤其不选 99 分那条");
  assert.equal(cell.status, "missing");
  assert.equal(pkg.pairs.length, 0);
  assert.equal(pkg.suggestions.length, 0);
});

test("证据编号稳定、cellId 含上下文/学习率/开关，重复调用结果一致", () => {
  const first = buildEvidencePackage(BOTH_CLAIM, demoAllRuns, CTX);
  const second = buildEvidencePackage(BOTH_CLAIM, demoAllRuns, CTX);
  assert.deepEqual(second, first);

  const measured = first.cells.find((c) => c.status === "measured")!;
  assert.match(measured.cellId, /^cell:p_demo:augmentation:accuracy:/);
  assert.ok(measured.cellId.includes(":0.01:") || measured.cellId.includes(":0.001:"));
  assert.ok(measured.cellId.endsWith(":on") || measured.cellId.endsWith(":off"));
  assert.equal(new Set(first.evidenceIds).size, first.evidenceIds.length, "证据编号不重复");
  assert.ok(first.evidenceIds.includes(measured.cellId));
  assert.ok(first.evidenceIds.includes(first.pairs[0]!.pairId));
});

test("建议与结论文字不出现估算、统计显著或普遍因果表述", () => {
  const packages = [
    buildEvidencePackage(TARGET_CLAIM, demoInitialRuns, CTX),
    buildEvidencePackage(BOTH_CLAIM, demoAllRuns, CTX),
    buildEvidencePackage(TARGET_CLAIM, [R01, R02, { ...R03, metrics: { accuracy: 83 } }], CTX),
  ];
  const forbidden = /显著|估算|估计|p\s*值|普遍|已证明|证明了/;
  for (const pkg of packages) {
    for (const s of pkg.suggestions) {
      assert.equal(forbidden.test(s.text), false, `建议含越界表述: ${s.text}`);
      assert.match(s.text, /复制/);
      assert.match(s.text, /完成后与/);
    }
    if (pkg.counterexample.statement) {
      assert.equal(
        forbidden.test(pkg.counterexample.statement),
        false,
        `结论含越界表述: ${pkg.counterexample.statement}`,
      );
    }
    for (const pair of pkg.pairs) {
      assert.equal(forbidden.test(pair.deltaPp), false);
    }
  }
});

/**
 * 规则评估：按 ClaimSpec 对可比对照做确定性计算（不经过模型）。
 *
 * 配对口径：除 lr 与 augmentation 外，两侧运行的全部配置列必须一致；
 * 两档学习率各配一对（开/关），缺任一侧即 insufficient_data，
 * 问题状态为 waiting_for_run——这是正常产物，并给出具体补跑配置。
 * 增幅判断在整数百分之一百分点上进行，不用浮点相等。
 */

import type {
  ClaimSpec,
  QuestionStatus,
  RuleConclusion,
  TrainingRun,
} from "./types.ts";
import {
  compareAccuracy,
  formatDeltaPp,
  isStrictlyPairable,
  sameCell,
  toHundredths,
  configColumns,
} from "./runs.ts";
import type { Cell, RunConfig } from "./types.ts";

export interface EvalOutcome {
  conclusions: RuleConclusion[];
  evidenceRunIds: string[];
  suggestions: string[];
  questionStatus: QuestionStatus;
}

function cellAt(config: RunConfig, key: string): Cell | undefined {
  if (key === "extras") return undefined;
  const direct = (config as Record<string, Cell | Record<string, Cell> | undefined>)[key];
  if (direct !== undefined && typeof direct !== "object") return direct as Cell;
  if (config.extras && key in config.extras) return config.extras[key];
  return undefined;
}

function withoutVolatile(config: RunConfig): RunConfig {
  const rest = { ...config };
  delete (rest as Partial<RunConfig>).lr;
  delete (rest as Partial<RunConfig>).augmentation;
  return rest;
}

function lrEquals(cell: Cell, lr: number): boolean {
  return typeof cell === "number" && Number.isFinite(cell) && cell === lr;
}

/** 在候选运行里找：lr 等于给定值、augmentation 等于给定值、其余列与模板一致。 */
function findSide(
  runs: readonly TrainingRun[],
  template: RunConfig,
  lr: number,
  augmentation: Cell,
): TrainingRun | undefined {
  const templateBase = withoutVolatile(template);
  const baseKeys = new Set(configColumns(templateBase));
  return runs.find((run) => {
    if (!lrEquals(run.config.lr, lr)) return false;
    if (!sameCell(run.config.augmentation, augmentation)) return false;
    const runBase = withoutVolatile(run.config);
    const runKeys = new Set(configColumns(runBase));
    const keys = new Set([...baseKeys, ...runKeys]);
    for (const key of keys) {
      const va = cellAt(templateBase, key);
      const vb = cellAt(runBase, key);
      if (va === undefined || vb === undefined) return false;
      if (!sameCell(va, vb)) return false;
    }
    return true;
  });
}

function missingSuggestion(template: RunConfig, lr: number, augmentation: Cell): string {
  const parts: string[] = [];
  for (const key of ["model", "evalSplit", "seed", "optimizer", "epochs"]) {
    const value = cellAt(template, key);
    if (value !== undefined) parts.push(`${key}=${String(value)}`);
  }
  for (const [key, value] of Object.entries(template.extras ?? {})) {
    parts.push(`${key}=${String(value)}`);
  }
  parts.push(`lr=${lr}`, `augmentation=${String(augmentation)}`);
  return `补跑：${parts.join(", ")}`;
}

/**
 * 评估主张。返回逐档规则结论、证据运行、补跑建议与问题状态。
 * 只有全部档位都拿到可比对照时才是 reviewable。
 */
export function evaluateClaim(spec: ClaimSpec, runs: readonly TrainingRun[]): EvalOutcome {
  const target = runs.find((r) => r.runId === spec.targetRunId);
  const baseline = runs.find((r) => r.runId === spec.baselineRunId);

  if (!target || !baseline) {
    return {
      conclusions: [
        {
          ruleId: "input@claim",
          result: "insufficient_data",
          detail: `目标或基准运行不在已导入集合（target=${spec.targetRunId}, baseline=${spec.baselineRunId}）`,
        },
      ],
      evidenceRunIds: [],
      suggestions: [],
      questionStatus: "waiting_for_run",
    };
  }

  if (sameCell(target.config.augmentation, baseline.config.augmentation)) {
    return {
      conclusions: [
        {
          ruleId: "input@claim",
          result: "needs_clarification",
          detail: "目标与基准的 augmentation 相同，无法构成增强开关对照",
        },
      ],
      evidenceRunIds: [target.runId, baseline.runId],
      suggestions: [],
      questionStatus: "needs_input",
    };
  }

  if (!isStrictlyPairable(target.config) || !isStrictlyPairable(baseline.config)) {
    return {
      conclusions: [
        {
          ruleId: "input@claim",
          result: "needs_clarification",
          detail: "目标或基准存在 unknown 配置，不能参加严格配对",
        },
      ],
      evidenceRunIds: [target.runId, baseline.runId],
      suggestions: [],
      questionStatus: "needs_input",
    };
  }

  const scopeLrs: number[] =
    spec.scope === "both_lrs"
      ? [...spec.learningRates]
      : [target.config.lr as number];

  const conclusions: RuleConclusion[] = [];
  const evidence = new Set<string>();
  const suggestions: string[] = [];
  let missing = false;

  for (const lr of scopeLrs) {
    const onRun = findSide(runs, target.config, lr, target.config.augmentation);
    const offRun = findSide(runs, target.config, lr, baseline.config.augmentation);

    if (!onRun || !offRun) {
      missing = true;
      if (!onRun) suggestions.push(missingSuggestion(target.config, lr, target.config.augmentation));
      if (!offRun) suggestions.push(missingSuggestion(target.config, lr, baseline.config.augmentation));
      const absent = [
        !onRun ? `augmentation=${String(target.config.augmentation)}` : null,
        !offRun ? `augmentation=${String(baseline.config.augmentation)}` : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" 与 ");
      conclusions.push({
        ruleId: `direction@${lr}`,
        result: "insufficient_data",
        detail: `lr=${lr} 缺少 ${absent} 的可比运行`,
      });
      continue;
    }

    evidence.add(onRun.runId);
    evidence.add(offRun.runId);

    const deltaH =
      toHundredths(onRun.metrics.accuracy) - toHundredths(offRun.metrics.accuracy);
    const direction = compareAccuracy(onRun.metrics.accuracy, offRun.metrics.accuracy);
    const deltaStr = formatDeltaPp(deltaH);

    conclusions.push({
      ruleId: `direction@${lr}`,
      result: direction === "提高" ? "pass" : "fail",
      detail: `lr=${lr}: ${onRun.runId}=${onRun.metrics.accuracy} vs ${offRun.runId}=${offRun.metrics.accuracy} → ${direction} ${deltaStr} 个百分点`,
    });

    if (spec.expectedDeltaPp !== null) {
      const requiredH = toHundredths(spec.expectedDeltaPp);
      const met = direction === "提高" && deltaH >= requiredH;
      conclusions.push({
        ruleId: `delta@${lr}`,
        result: met ? "pass" : "fail",
        detail: `lr=${lr}: 要求至少 ${formatDeltaPp(requiredH)} 个百分点，实测 ${deltaStr}`,
      });
    }
  }

  return {
    conclusions,
    evidenceRunIds: [...evidence],
    suggestions,
    questionStatus: missing ? "waiting_for_run" : "reviewable",
  };
}

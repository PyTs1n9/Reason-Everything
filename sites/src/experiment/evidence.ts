/**
 * 证据包：输入已确认的 ClaimSpec 与项目内 TrainingRun[]，输出结构化证据。
 *
 * 确定性：同一输入反复结果一致；运行记录乱序不改变配对（候选按 runId 排序）。
 * 只用同项目记录。锚点=用户选定的目标运行及其评测口径；每档学习率检查
 * 增强开/关两格，配对要求除 augmentation 外全部配置相等（unknown 不算相等）。
 *
 * 原始观测（锚点两次运行的差）与「增强贡献」分开：增强贡献只来自真正对照。
 * 反例是否存在 与 证据是否覆盖全部档位 是两个独立字段。
 * 缺测值一律 null，不做估算、不做统计显著性判断。
 */

import type {
  Cell,
  ClaimSpec,
  QuestionStatus,
  RuleConclusion,
  RunConfig,
  TrainingRun,
} from "./types.ts";
import {
  cellAt,
  compareAccuracy,
  configColumns,
  formatDeltaPp,
  isStrictlyPairable,
  sameCell,
  toHundredths,
} from "./runs.ts";
import { diffRunConfigs, type ConfigDiffItem } from "./import.ts";

export interface EvidenceContext {
  projectId: string;
  questionId: string;
}

export type CellStatus = "measured" | "missing" | "requested";

export interface EvidenceCell {
  cellId: string;
  lr: number;
  augmentation: Cell;
  status: CellStatus;
  /** 缺测为 null，绝不以估算填充。 */
  runId: string | null;
  accuracy: number | null;
}

export interface MatchedPair {
  pairId: string;
  lr: number;
  treatedCellId: string;
  controlCellId: string;
  treatedRunId: string;
  controlRunId: string;
  /** 处理侧 − 对照侧，两位小数百分点。 */
  deltaPp: string;
  direction: "提高" | "下降" | "未变";
}

export interface MissingConfig {
  runId: string;
  cellId: string;
  unknownFields: string[];
  message: string;
}

export interface DuplicateCandidate {
  cellId: string;
  runIds: string[];
  message: string;
}

export interface RerunRequest {
  suggestionId: string;
  cellId: string;
  lr: number;
  augmentation: Cell;
  /** 复制哪次配置。 */
  copyFromRunId: string;
  /** 保留哪些条件（不含被变更项）。 */
  keepConditions: Array<{ field: string; value: Cell }>;
  /** 变更哪项。 */
  change: Array<{ field: string; from: Cell; to: number | Cell }>;
  /** 运行后与谁比较；对侧也缺测时为 null（比较对象见 text）。 */
  compareToRunId: string | null;
  text: string;
}

export interface RawObservation {
  targetRunId: string;
  baselineRunId: string;
  deltaPp: string;
  direction: "提高" | "下降" | "未变";
  configDiff: ConfigDiffItem[];
  caveat: string;
}

export interface CounterexampleReport {
  exists: boolean;
  refutingLrs: number[];
  statement: string | null;
}

export interface CoverageReport {
  requiredLrs: number[];
  measuredLrs: number[];
  complete: boolean;
}

export interface EvidencePackage {
  questionId: string;
  projectId: string;
  status: QuestionStatus;
  units: {
    metric: "accuracy";
    accuracyUnit: "0-100";
    deltaUnit: "percentage_points";
    internal: "integer_hundredths";
  };
  rules: string[];
  observation: RawObservation | null;
  /** 真正对照得出的增强贡献；无完整配对时为 null。 */
  augmentationContributionPp: string | null;
  cells: EvidenceCell[];
  pairs: MatchedPair[];
  unmetConditions: string[];
  missingConfigs: MissingConfig[];
  duplicateCandidates: DuplicateCandidate[];
  suggestions: RerunRequest[];
  evidenceIds: string[];
  counterexample: CounterexampleReport;
  coverage: CoverageReport;
}

function byRunId(a: TrainingRun, b: TrainingRun): number {
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

function lrEquals(cell: Cell, lr: number): boolean {
  return typeof cell === "number" && Number.isFinite(cell) && cell === lr;
}

function normLr(lr: number): string {
  return String(lr);
}

function makeCellId(ctx: EvidenceContext, claim: ClaimSpec, lr: number, aug: Cell): string {
  return `cell:${ctx.projectId}:${claim.factor}:${claim.metric}:${normLr(lr)}:${String(aug)}`;
}

function makePairId(ctx: EvidenceContext, claim: ClaimSpec, lr: number): string {
  return `pair:${ctx.projectId}:${claim.factor}:${claim.metric}:${normLr(lr)}`;
}

type ClassifyResult =
  | { kind: "full" }
  | { kind: "unknown"; fields: string[] }
  | { kind: "none" };

/** 候选分类：除 lr/augmentation 外与锚点模板全等 → full；仅未知项待确认 → unknown；已知值不同 → none。 */
function classify(run: TrainingRun, template: RunConfig, lr: number, aug: Cell): ClassifyResult {
  if (!lrEquals(run.config.lr, lr)) return { kind: "none" };
  if (!sameCell(run.config.augmentation, aug)) return { kind: "none" };
  const keys = new Set([...configColumns(run.config), ...configColumns(template)]);
  keys.delete("lr");
  keys.delete("augmentation");
  const fields: string[] = [];
  for (const key of keys) {
    const rv = cellAt(run.config, key);
    const tv = cellAt(template, key);
    if (rv === undefined || rv === "unknown" || tv === undefined || tv === "unknown") {
      fields.push(key);
      continue;
    }
    if (rv !== tv) return { kind: "none" };
  }
  return fields.length > 0 ? { kind: "unknown", fields } : { kind: "full" };
}

function anchorUnknownFields(config: RunConfig): string[] {
  const fields: string[] = [];
  for (const key of configColumns(config)) {
    const value = cellAt(config, key);
    if (value === undefined || value === "unknown") fields.push(key);
  }
  return fields;
}

function buildRules(projectId: string): string[] {
  return [
    "accuracy 单位 0–100（最多两位小数），内部转整数百分之一百分点计算",
    "差值 = 处理侧 − 对照侧，按整数百分之一百分点相减后格式化为两位小数百分点",
    "配对要求 model、evalSplit、lr、seed 及已登记的其余配置全部相等，仅 augmentation 相反；unknown 不视为相等",
    `只使用同项目（${projectId}）内的运行记录`,
    "expectedDeltaPp 为 null 时只检查方向；非 null 时逐档检查是否至少提高该百分点数",
    "缺测值保持 null，不估算缺失准确率，不做统计显著性判断",
  ];
}

function buildSuggestion(
  ctx: EvidenceContext,
  claim: ClaimSpec,
  lr: number,
  aug: Cell,
  cellId: string,
  otherCellId: string,
  anchor: TrainingRun,
  sibling: TrainingRun | null,
): RerunRequest {
  const copyRun = sibling ?? anchor;
  const change: Array<{ field: string; from: Cell; to: number | Cell }> = [];
  if (!lrEquals(copyRun.config.lr, lr)) {
    change.push({ field: "lr", from: copyRun.config.lr, to: lr });
  }
  if (!sameCell(copyRun.config.augmentation, aug)) {
    change.push({ field: "augmentation", from: copyRun.config.augmentation, to: aug });
  }
  const changed = new Set(change.map((c) => c.field));
  const keepConditions = configColumns(copyRun.config)
    .filter((field) => !changed.has(field))
    .map((field) => ({ field, value: cellAt(copyRun.config, field) as Cell }));

  const keepText = keepConditions.map((c) => `${c.field}=${String(c.value)}`).join(", ");
  const changeText =
    change.length > 0
      ? `将 ${change.map((c) => `${c.field}: ${String(c.from)} → ${String(c.to)}`).join("、")}`
      : "无需变更配置";
  const compareTarget = sibling ? `运行 ${sibling.runId}` : `同档另一格 ${otherCellId}`;
  const text =
    `补跑 ${cellId}：复制 ${copyRun.runId} 的配置（${keepText}），${changeText}；` +
    `完成后与${compareTarget}比较。`;

  return {
    suggestionId: `req:${cellId}`,
    cellId,
    lr,
    augmentation: aug,
    copyFromRunId: copyRun.runId,
    keepConditions,
    change,
    compareToRunId: sibling ? sibling.runId : null,
    text,
  };
}

function buildCounterexample(
  claim: ClaimSpec,
  pairs: MatchedPair[],
): CounterexampleReport {
  const refutingLrs: number[] = [];
  const details: string[] = [];
  for (const pair of pairs) {
    const deltaH =
      (toHundredthsFromDelta(pair.deltaPp));
    const violated =
      claim.expectedDeltaPp === null
        ? pair.direction !== "提高"
        : pair.direction !== "提高" || deltaH < toHundredths(claim.expectedDeltaPp);
    if (violated) {
      refutingLrs.push(pair.lr);
      details.push(`lr=${pair.lr} 实测 ${pair.deltaPp}`);
    }
  }
  if (refutingLrs.length === 0) {
    return { exists: false, refutingLrs: [], statement: null };
  }
  const both = claim.scope === "both_lrs";
  const requirement =
    claim.expectedDeltaPp === null
      ? both
        ? "每档均「提高」"
        : "「提高」方向"
      : both
        ? `每档均提高至少 ${formatDeltaPp(toHundredths(claim.expectedDeltaPp))} 个百分点`
        : `该档提高至少 ${formatDeltaPp(toHundredths(claim.expectedDeltaPp))} 个百分点`;
  const statement = both
    ? `原「${requirement}」是全称主张，已被实测反例（${details.join("；")}）反驳；全称主张只需一个反例，其余档位是否已测不影响该结论。`
    : `原「${requirement}」主张已被实测反例（${details.join("；")}）反驳。`;
  return {
    exists: true,
    refutingLrs,
    statement,
  };
}

/** "+0.20" → 20；"-1.00" → -100；"0.00" → 0。 */
function toHundredthsFromDelta(deltaPp: string): number {
  const negative = deltaPp.startsWith("-");
  const body = negative ? deltaPp.slice(1) : deltaPp;
  const [intPart = "0", fracPart = "0"] = body.split(".");
  const value = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  return negative ? -value : value;
}

export function buildEvidencePackage(
  claim: ClaimSpec,
  runs: readonly TrainingRun[],
  ctx: EvidenceContext,
): EvidencePackage {
  const projectRuns = runs.filter((r) => r.projectId === ctx.projectId).sort(byRunId);

  const unmetConditions: string[] = [];
  const missingConfigs: MissingConfig[] = [];
  const duplicateCandidates: DuplicateCandidate[] = [];
  let needsInput = false;

  const target = projectRuns.find((r) => r.runId === claim.targetRunId) ?? null;
  const baseline = projectRuns.find((r) => r.runId === claim.baselineRunId) ?? null;

  if (!target) {
    unmetConditions.push(`目标运行 ${claim.targetRunId} 不在项目 ${ctx.projectId} 内`);
    needsInput = true;
  }
  if (!baseline) {
    unmetConditions.push(`基准运行 ${claim.baselineRunId} 不在项目 ${ctx.projectId} 内`);
    needsInput = true;
  }

  let anchorOk = target !== null && baseline !== null;

  if (target) {
    const unknownFields = anchorUnknownFields(target.config);
    if (unknownFields.length > 0 || typeof target.config.lr !== "number") {
      const fields =
        typeof target.config.lr === "number"
          ? unknownFields
          : [...unknownFields, "lr(需为数值)"];
      missingConfigs.push({
        runId: target.runId,
        cellId: "",
        unknownFields: fields,
        message: `目标运行 ${target.runId} 的 ${fields.join("、")} 未确认，锚点配置不完整`,
      });
      unmetConditions.push(`目标运行 ${target.runId} 缺少必要配置: ${fields.join("、")}`);
      needsInput = true;
      anchorOk = false;
    }
  }

  if (baseline && (baseline.config.augmentation === undefined || baseline.config.augmentation === "unknown")) {
    missingConfigs.push({
      runId: baseline.runId,
      cellId: "",
      unknownFields: ["augmentation"],
      message: `基准运行 ${baseline.runId} 的 augmentation 未确认，无法定义对照格`,
    });
    unmetConditions.push(`基准运行 ${baseline.runId} 的增强开关未知`);
    needsInput = true;
    anchorOk = false;
  }

  if (target && baseline && sameCell(target.config.augmentation, baseline.config.augmentation)) {
    unmetConditions.push("目标与基准的 augmentation 相同，无法构成增强开/关对照");
    needsInput = true;
    anchorOk = false;
  }

  const observation: RawObservation | null =
    target && baseline
      ? {
          targetRunId: target.runId,
          baselineRunId: baseline.runId,
          deltaPp: formatDeltaPp(
            toHundredths(target.metrics.accuracy) - toHundredths(baseline.metrics.accuracy),
          ),
          direction: compareAccuracy(target.metrics.accuracy, baseline.metrics.accuracy),
          configDiff: diffRunConfigs(target, baseline),
          caveat:
            "该观测差来自锚点两次运行，二者同时差学习率与增强开关，不等于增强贡献；增强贡献只由同档严格配对给出。",
        }
      : null;

  const cells: EvidenceCell[] = [];
  const pairs: MatchedPair[] = [];
  const suggestions: RerunRequest[] = [];

  const scopeLrs: number[] = claim.scope === "both_lrs"
    ? [...claim.learningRates]
    : target && typeof target.config.lr === "number"
      ? [target.config.lr]
      : [];

  if (anchorOk && target && baseline) {
    const targetAug = target.config.augmentation;
    const baselineAug = baseline.config.augmentation;

    for (const lr of scopeLrs) {
      const cellIds: string[] = [];
      const augOrder: Cell[] = [targetAug, baselineAug];
      for (const aug of augOrder) {
        const cellId = makeCellId(ctx, claim, lr, aug);
        cellIds.push(cellId);
        const fulls: TrainingRun[] = [];
        const unknowns: Array<{ run: TrainingRun; fields: string[] }> = [];
        for (const run of projectRuns) {
          const kind = classify(run, target.config, lr, aug);
          if (kind.kind === "full") fulls.push(run);
          else if (kind.kind === "unknown") unknowns.push({ run, fields: kind.fields });
        }

        if (fulls.length === 1) {
          const chosen = fulls[0]!;
          cells.push({
            cellId,
            lr,
            augmentation: aug,
            status: "measured",
            runId: chosen.runId,
            accuracy: chosen.metrics.accuracy,
          });
        } else if (fulls.length > 1) {
          const runIds = fulls.map((r) => r.runId).sort();
          duplicateCandidates.push({
            cellId,
            runIds,
            message: `${cellId} 存在多个同条件运行（${runIds.join("、")}），需用户选定；不按准确率自动挑选`,
          });
          unmetConditions.push(`${cellId} 有重复候选（${runIds.join("、")}），待选定`);
          needsInput = true;
          cells.push({ cellId, lr, augmentation: aug, status: "missing", runId: null, accuracy: null });
        } else if (unknowns.length > 0) {
          for (const { run, fields } of unknowns) {
            missingConfigs.push({
              runId: run.runId,
              cellId,
              unknownFields: [...fields].sort(),
              message: `运行 ${run.runId} 的 ${[...fields].sort().join("、")} 未确认，不能与锚点配置配对`,
            });
          }
          unmetConditions.push(`${cellId} 有待确认配置的候选（${[...new Set(unknowns.map((u) => u.run.runId))].sort().join("、")}）`);
          needsInput = true;
          cells.push({ cellId, lr, augmentation: aug, status: "missing", runId: null, accuracy: null });
        } else {
          cells.push({ cellId, lr, augmentation: aug, status: "requested", runId: null, accuracy: null });
          unmetConditions.push(`${cellId} 未测`);
        }
      }

      const treated = cells[cells.length - 2]!;
      const control = cells[cells.length - 1]!;
      if (treated.status === "measured" && control.status === "measured") {
        pairs.push({
          pairId: makePairId(ctx, claim, lr),
          lr,
          treatedCellId: treated.cellId,
          controlCellId: control.cellId,
          treatedRunId: treated.runId!,
          controlRunId: control.runId!,
          deltaPp: formatDeltaPp(toHundredths(treated.accuracy!) - toHundredths(control.accuracy!)),
          direction: compareAccuracy(treated.accuracy!, control.accuracy!),
        });
      }

      const suggestionTargets: Array<[EvidenceCell, EvidenceCell]> = [
        [treated, control],
        [control, treated],
      ];
      for (const [cell, other] of suggestionTargets) {
        if (cell.status !== "requested") continue;
        const sibling =
          other.status === "measured" && other.runId
            ? projectRuns.find((r) => r.runId === other.runId) ?? null
            : null;
        suggestions.push(
          buildSuggestion(
            ctx,
            claim,
            lr,
            cell.augmentation,
            cell.cellId,
            other.cellId,
            target,
            sibling,
          ),
        );
      }
    }
  }

  const measuredLrs = pairs.map((p) => p.lr);
  const coverage: CoverageReport = {
    requiredLrs: scopeLrs,
    measuredLrs,
    complete: scopeLrs.length > 0 && measuredLrs.length === scopeLrs.length,
  };

  const counterexample = buildCounterexample(claim, pairs);

  const augmentationContributionPp =
    claim.scope === "target_lr" && pairs.length === 1 ? pairs[0]!.deltaPp : null;

  const status: QuestionStatus = needsInput
    ? "needs_input"
    : cells.some((c) => c.status !== "measured")
      ? "waiting_for_run"
      : cells.length > 0
        ? "reviewable"
        : "needs_input";

  const evidenceIds = [
    ...cells.map((c) => c.cellId),
    ...pairs.map((p) => p.pairId),
    ...suggestions.map((s) => s.suggestionId),
  ];

  return {
    questionId: ctx.questionId,
    projectId: ctx.projectId,
    status,
    units: {
      metric: "accuracy",
      accuracyUnit: "0-100",
      deltaUnit: "percentage_points",
      internal: "integer_hundredths",
    },
    rules: buildRules(ctx.projectId),
    observation,
    augmentationContributionPp,
    cells,
    pairs,
    unmetConditions,
    missingConfigs,
    duplicateCandidates,
    suggestions,
    evidenceIds,
    counterexample,
    coverage,
  };
}

/** 把证据包转成分析版本可存储的规则结论（缺格 → insufficient_data，配对 → 方向，反例 → fail）。 */
export function conclusionsFromPackage(pkg: EvidencePackage): RuleConclusion[] {
  const conclusions: RuleConclusion[] = [];
  for (const cell of pkg.cells) {
    if (cell.status !== "measured") {
      conclusions.push({
        ruleId: `cell@${cell.cellId}`,
        result: "insufficient_data",
        detail: `${cell.cellId} 未测，缺测值为 null`,
      });
    }
  }
  for (const pair of pkg.pairs) {
    conclusions.push({
      ruleId: `direction@${pair.lr}`,
      result: pair.direction === "提高" ? "pass" : "fail",
      detail: `${pair.treatedRunId} vs ${pair.controlRunId} → ${pair.direction} ${pair.deltaPp} 个百分点`,
    });
  }
  for (const lr of pkg.counterexample.refutingLrs) {
    conclusions.push({
      ruleId: `counterexample@${lr}`,
      result: "fail",
      detail: `lr=${lr} 构成原主张的实测反例`,
    });
  }
  return conclusions;
}

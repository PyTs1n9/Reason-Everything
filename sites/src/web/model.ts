/**
 * 前端视图模型纯函数（可离线单测；DOM 逻辑在 web/assets/study.js）。
 */

import type { ProjectSummary } from "../experiment/storage.ts";
import type { ClaimSpec, TrainingRun } from "../experiment/types.ts";
import type { EvidencePackage } from "../experiment/evidence.ts";

/** 按项目名过滤（大小写不敏感、去空格）；空查询返回原列表顺序。 */
export function filterProjects(list: readonly ProjectSummary[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((p) => p.name.toLowerCase().includes(q));
}

/** 更新时间 → 展示串 "MM-DD HH:mm"（真实时间，本地时区）。 */
export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 从运行集合提取去重、升序的学习率选项（仅数值；unknown 跳过）。 */
export function deriveLrOptions(runs: readonly TrainingRun[]): number[] {
  const values = new Set<number>();
  for (const run of runs) {
    const lr = run.config.lr;
    if (typeof lr === "number" && Number.isFinite(lr)) values.add(lr);
  }
  return [...values].sort((a, b) => a - b);
}

/** 录入表单缺项（按提交顺序）；返回中文缺项列表，空数组=可提交。 */
export interface EntryFormState {
  rawClaim: string;
  dataText: string;
  baselineRunId: string;
  targetRunId: string;
  scope: "target_lr" | "both_lrs" | "";
  targetLr: number | null;
}

export function evaluateEntryMissing(state: EntryFormState): string[] {
  const missing: string[] = [];
  if (!state.rawClaim.trim()) missing.push("主张原句");
  if (!state.dataText.trim()) missing.push("训练数据（CSV/TSV）");
  if (!state.targetRunId) missing.push("目标运行");
  if (!state.baselineRunId) missing.push("基线运行");
  if (!state.scope) missing.push("问题范围");
  if (state.scope === "target_lr" && state.targetLr === null) missing.push("目标学习率");
  return missing;
}

/** 问题状态 → 文字 + 形状（状态不得只靠颜色）。 */
export function statusGlyph(status: string): { glyph: string; text: string } {
  switch (status) {
    case "needs_input":
      return { glyph: "◇", text: "待补充" };
    case "waiting_for_run":
      return { glyph: "◆", text: "待补跑" };
    case "reviewable":
      return { glyph: "●", text: "可分析" };
    default:
      return { glyph: "○", text: status };
  }
}

/** 模型输出状态 → 文字 + 形状。 */
export function modelGlyph(status: string): { glyph: string; text: string } {
  switch (status) {
    case "ready":
      return { glyph: "●", text: "分析已生成" };
    case "failed":
      return { glyph: "▲", text: "分析失败" };
    case "unavailable":
      return { glyph: "○", text: "AI 未接通" };
    default:
      return { glyph: "◇", text: "分析未生成" };
  }
}

// ---------- 问题详情：实验对照矩阵（读同一份 revision 数据，配对/算术一律走卡 04 引擎） ----------

export type MatrixCellState = "measured" | "suggested" | "empty";

export interface MatrixCell {
  /** 选择键：`lr|augmentation`。 */
  key: string;
  lr: number;
  augmentation: string;
  state: MatrixCellState;
  runId: string | null;
  accuracy: number | null;
  /** 范围内格子的 cellId（与证据编号互链；范围外为 null）。 */
  cellId: string | null;
}

export interface QuestionMatrix {
  /** 学习率升序。 */
  lrs: number[];
  cells: MatrixCell[];
  fixedConditions: { model: string; evalSplit: string; seed: string };
}

function equalNumber(a: CellLike, b: number): boolean {
  return typeof a === "number" && Number.isFinite(a) && a === b;
}

type CellLike = string | number | "unknown";

/** 固定条件展示串（仅取值，不做计算）。 */
export function formatAccuracy(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}

/**
 * 由「同一份 revision 的 claim + runs + 卡 04 证据包」生成矩阵模型。
 * - 范围内格子：状态以卡 04 引擎输出为准（measured/requested/missing→建议或未跑）；
 * - 范围外格子：按 (lr, augmentation) 原样取快照运行（点开可见配置与来源）；
 * - UI 不做任何配对或算术。
 */
export function buildQuestionMatrix(
  claim: ClaimSpec,
  runs: readonly TrainingRun[],
  pkg: EvidencePackage,
): QuestionMatrix {
  const lrs = [...new Set(claim.learningRates)].sort((a, b) => a - b);
  const anchor = runs.find((r) => r.runId === claim.targetRunId) ?? runs[0] ?? null;
  const targetLr =
    anchor && typeof claim.targetRunId === "string"
      ? (runs.find((r) => r.runId === claim.targetRunId)?.config.lr ?? null)
      : null;

  const pkgByKey = new Map<string, (typeof pkg.cells)[number]>();
  for (const cell of pkg.cells) pkgByKey.set(`${cell.lr}|${String(cell.augmentation)}`, cell);
  const suggestedCellIds = new Set(pkg.suggestions.map((s) => s.cellId));

  const cells: MatrixCell[] = [];
  for (const lr of lrs) {
    const inScope = claim.scope === "both_lrs" ? true : equalNumber(targetLr, lr);
    for (const augmentation of ["off", "on"]) {
      const key = `${lr}|${augmentation}`;
      const pkgCell = pkgByKey.get(key);
      if (inScope && pkgCell) {
        if (pkgCell.status === "measured" && pkgCell.runId !== null && pkgCell.accuracy !== null) {
          cells.push({
            key,
            lr,
            augmentation,
            state: "measured",
            runId: pkgCell.runId,
            accuracy: pkgCell.accuracy,
            cellId: pkgCell.cellId,
          });
        } else if (pkgCell.status === "requested" || suggestedCellIds.has(pkgCell.cellId)) {
          cells.push({ key, lr, augmentation, state: "suggested", runId: null, accuracy: null, cellId: pkgCell.cellId });
        } else {
          cells.push({ key, lr, augmentation, state: "empty", runId: null, accuracy: null, cellId: pkgCell.cellId });
        }
        continue;
      }
      const raw = runs.find(
        (r) => equalNumber(r.config.lr, lr) && String(r.config.augmentation) === augmentation,
      );
      if (raw) {
        cells.push({
          key,
          lr,
          augmentation,
          state: "measured",
          runId: raw.runId,
          accuracy: raw.metrics.accuracy,
          cellId: null,
        });
      } else {
        cells.push({ key, lr, augmentation, state: "empty", runId: null, accuracy: null, cellId: null });
      }
    }
  }

  return {
    lrs,
    cells,
    fixedConditions: {
      model: anchor ? String(anchor.config.model) : "—",
      evalSplit: anchor ? String(anchor.config.evalSplit) : "—",
      seed: anchor ? String(anchor.config.seed) : "—",
    },
  };
}

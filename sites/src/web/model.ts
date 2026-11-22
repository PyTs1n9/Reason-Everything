/**
 * 前端视图模型纯函数（可离线单测；DOM 逻辑在 web/assets/study.js）。
 */

import type { ProjectSummary } from "../experiment/storage.ts";
import type { TrainingRun } from "../experiment/types.ts";

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

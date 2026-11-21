/**
 * TrainingRun 的校验、配置匹配与准确率比较（全部整数化，杜绝浮点相等）。
 *
 * 单位口径：accuracy 为 0–100 的百分数，最多两位小数；
 * 计算层统一转成「整数百分之一百分点」（80.0 → 8000）再比较。
 * 配置匹配只看配置列；实验编号、备注、指标、导入时间是元数据，
 * 永不参与匹配。空值是 "unknown"，绝不能默认为同值。
 */

import type { Cell, RunConfig, TrainingRun } from "./types.ts";
import { SOURCE_KINDS } from "./types.ts";

export const REQUIRED_CONFIG_KEYS = [
  "model",
  "evalSplit",
  "seed",
  "lr",
  "augmentation",
] as const;

export const OPTIONAL_CONFIG_KEYS = ["optimizer", "epochs"] as const;

/** 百分数 → 整数百分之一百分点（两位小数以内精确）。 */
export function toHundredths(value: number): number {
  return Math.round(value * 100);
}

/** 校验 accuracy：有限、0–100、最多两位小数。通过返回 null。 */
export function validateAccuracy(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `accuracy 必须是有限数字: ${String(value)}`;
  }
  if (value < 0 || value > 100) {
    return `accuracy 超出 0–100: ${value}`;
  }
  const scaled = value * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    return `accuracy 最多两位小数: ${value}`;
  }
  return null;
}

/** 三态比较：提高 / 下降 / 未变。先转整数百分之一百分点再比。 */
export function compareAccuracy(target: number, baseline: number): "提高" | "下降" | "未变" {
  const t = toHundredths(target);
  const b = toHundredths(baseline);
  if (t > b) return "提高";
  if (t < b) return "下降";
  return "未变";
}

/** 整数百分之一百分点 → 带符号两位小数字符串，如 "+2.00"。 */
export function formatDeltaPp(deltaHundredths: number): string {
  const sign = deltaHundredths > 0 ? "+" : deltaHundredths < 0 ? "-" : "";
  const abs = Math.abs(deltaHundredths);
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, "0");
  return `${sign}${intPart}.${fracPart}`;
}

function cellAt(config: RunConfig, key: string): Cell | undefined {
  if (key === "extras") return undefined;
  const direct = (config as Record<string, Cell | Record<string, Cell> | undefined>)[key];
  if (direct !== undefined && typeof direct !== "object") return direct as Cell;
  if (config.extras && key in config.extras) return config.extras[key];
  return undefined;
}

/** unknown 永不相等——包括 unknown 与 unknown 自己。 */
export function sameCell(a: Cell, b: Cell): boolean {
  if (a === "unknown" || b === "unknown") return false;
  return a === b;
}

/** 一行实际出现的配置列：在场的必要列 + 出现过的可选列 + 附加列。 */
export function configColumns(config: RunConfig): string[] {
  const cols = new Set<string>();
  for (const key of REQUIRED_CONFIG_KEYS) {
    if (key in config) cols.add(key);
  }
  for (const key of OPTIONAL_CONFIG_KEYS) {
    if (key in config) cols.add(key);
  }
  if (config.extras) {
    for (const key of Object.keys(config.extras)) cols.add(key);
  }
  return [...cols];
}

/**
 * 按解析后的规范配置比较两条记录的全部配置列。
 * 任一侧缺列、含 unknown 或值不同 → 不匹配。
 */
export function configsMatch(a: RunConfig, b: RunConfig): boolean {
  const keys = new Set([...configColumns(a), ...configColumns(b)]);
  for (const key of keys) {
    const va = cellAt(a, key);
    const vb = cellAt(b, key);
    if (va === undefined || vb === undefined) return false;
    if (!sameCell(va, vb)) return false;
  }
  return true;
}

/** 必要配置齐全且无 unknown 才能参加严格配对。 */
export function isStrictlyPairable(config: RunConfig): boolean {
  return REQUIRED_CONFIG_KEYS.every((key) => {
    const value = cellAt(config, key);
    return value !== undefined && value !== "unknown";
  });
}

/** 运行记录的结构校验；返回错误列表（空数组 = 通过）。 */
export function validateRun(run: TrainingRun): string[] {
  const errors: string[] = [];
  if (!run.runId) errors.push("runId 为空");
  if (!run.projectId) errors.push("projectId 为空");
  if (!SOURCE_KINDS.includes(run.source)) {
    errors.push(`source 必须是 demo|real: ${String(run.source)}`);
  }
  if (!run.config || typeof run.config !== "object") {
    errors.push("config 缺失");
  } else {
    for (const key of REQUIRED_CONFIG_KEYS) {
      if (!(key in run.config)) errors.push(`缺少必要配置列 ${key}`);
    }
  }
  if (!run.metrics || typeof run.metrics !== "object") {
    errors.push("metrics 缺失");
  } else {
    const err = validateAccuracy(run.metrics.accuracy);
    if (err) errors.push(err);
  }
  if (!run.metadata || typeof run.metadata.importedAt !== "string" || !run.metadata.importedAt) {
    errors.push("metadata.importedAt 缺失");
  }
  return errors;
}

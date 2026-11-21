/**
 * 主张解析与 ClaimSpec 构建（离线、确定性）。
 *
 * v1 只支持「提高」类主张；「下降」「未变」以及无法识别的句子
 * 一律返回待澄清，绝不擅自改比较方向。百分数（%）与百分点
 * （个百分点）严格区分：v1 的增幅只接受百分点。
 */

import type { ClaimScope, ClaimSpec, Factor, Metric } from "./types.ts";
import { CLAIM_SCOPES } from "./types.ts";

export type ClaimDirection = "increase" | "decrease" | "unchanged";

export interface ParsedClaim {
  direction: ClaimDirection;
  /** 句中显式增幅；未写增幅时为 null。 */
  deltaPp: number | null;
  /** 增幅单位；未写增幅时为 null。 */
  deltaUnit: "pp" | "percent" | null;
}

export type ClaimBuild =
  | { ok: true; spec: ClaimSpec }
  | { ok: false; reason: "needs_clarification"; detail: string };

export interface ClaimParams {
  factor: Factor;
  metric: Metric;
  targetRunId: string;
  baselineRunId: string;
  scope: ClaimScope;
  learningRates: number[];
}

function clarify(detail: string): ClaimBuild {
  return { ok: false, reason: "needs_clarification", detail };
}

/** 解析原句的方向与增幅；识别不了返回 null。 */
export function parseClaimSentence(raw: string): ParsedClaim | null {
  const text = raw.trim();
  if (!text) return null;

  let direction: ClaimDirection;
  if (/提高|上升|增加|变大/.test(text)) {
    direction = "increase";
  } else if (/下降|降低|减少|变小/.test(text)) {
    direction = "decrease";
  } else if (/未变|不变|持平|没有变化|无变化/.test(text)) {
    direction = "unchanged";
  } else {
    return null;
  }

  // 先匹配百分点，再匹配百分数：两者语义不同，不能互换。
  // 捕获符号，负增幅留给 proposeClaim 判为待澄清。
  const pp = text.match(/(-?\d+(?:\.\d+)?)\s*(?:个百分点|百分点|pp)/i);
  if (pp) {
    return { direction, deltaPp: Number(pp[1]), deltaUnit: "pp" };
  }
  const percent = text.match(/(-?\d+(?:\.\d+)?)\s*(?:%|％)/);
  if (percent) {
    return { direction, deltaPp: Number(percent[1]), deltaUnit: "percent" };
  }
  return { direction, deltaPp: null, deltaUnit: null };
}

/**
 * 由原句与用户确认的参数构建 ClaimSpec。
 * 任何 v1 不支持的表达都返回待澄清，不猜测、不改方向。
 */
export function proposeClaim(rawClaim: string, params: ClaimParams): ClaimBuild {
  const parsed = parseClaimSentence(rawClaim);
  if (!parsed) {
    return clarify("无法从原句识别比较方向（提高/下降/未变）");
  }
  if (parsed.direction !== "increase") {
    return clarify(`v1 只支持「提高」类主张，原句方向为「${parsed.direction}」，不改写比较方向`);
  }
  if (parsed.deltaUnit === "percent") {
    return clarify("原句增幅是百分数（%），与百分点不同；v1 增幅只接受「个百分点」");
  }

  if (params.factor !== "augmentation") {
    return clarify(`v1 因素固定为 augmentation，收到 ${String(params.factor)}`);
  }
  if (params.metric !== "accuracy") {
    return clarify(`v1 指标固定为 accuracy，收到 ${String(params.metric)}`);
  }
  if (!CLAIM_SCOPES.includes(params.scope)) {
    return clarify(`范围必须是 target_lr 或 both_lrs，收到 ${String(params.scope)}`);
  }
  if (params.learningRates.length !== 2) {
    return clarify("两档学习率列表必须恰好两个数值");
  }
  for (const lr of params.learningRates) {
    if (typeof lr !== "number" || !Number.isFinite(lr)) {
      return clarify(`学习率必须是有限数值，收到 ${String(lr)}`);
    }
  }
  if (!params.targetRunId || !params.baselineRunId) {
    return clarify("目标运行与基准运行都必须指定");
  }
  if (params.targetRunId === params.baselineRunId) {
    return clarify("目标运行与基准运行不能是同一条");
  }
  if (parsed.deltaPp !== null && parsed.deltaPp < 0) {
    return clarify("增幅不能为负数");
  }

  const spec: ClaimSpec = {
    factor: params.factor,
    metric: params.metric,
    targetRunId: params.targetRunId,
    baselineRunId: params.baselineRunId,
    scope: params.scope,
    learningRates: [params.learningRates[0]!, params.learningRates[1]!],
    expectedDeltaPp: parsed.deltaPp,
  };
  return { ok: true, spec };
}

/** 对编码读回的 ClaimSpec 做运行时结构校验，返回错误列表。 */
export function validateClaimSpecShape(claim: ClaimSpec): string[] {
  const errors: string[] = [];
  if (claim.factor !== "augmentation") errors.push(`factor 非法: ${String(claim.factor)}`);
  if (claim.metric !== "accuracy") errors.push(`metric 非法: ${String(claim.metric)}`);
  if (!CLAIM_SCOPES.includes(claim.scope)) errors.push(`scope 非法: ${String(claim.scope)}`);
  if (!claim.targetRunId) errors.push("targetRunId 为空");
  if (!claim.baselineRunId) errors.push("baselineRunId 为空");
  if (claim.targetRunId && claim.targetRunId === claim.baselineRunId) {
    errors.push("targetRunId 与 baselineRunId 相同");
  }
  if (!Array.isArray(claim.learningRates) || claim.learningRates.length !== 2) {
    errors.push("learningRates 必须是两档列表");
  } else {
    for (const lr of claim.learningRates) {
      if (typeof lr !== "number" || !Number.isFinite(lr)) {
        errors.push(`learningRates 含非法数值: ${String(lr)}`);
      }
    }
  }
  if (claim.expectedDeltaPp !== null) {
    if (typeof claim.expectedDeltaPp !== "number" || !Number.isFinite(claim.expectedDeltaPp)) {
      errors.push("expectedDeltaPp 必须是有限数或 null");
    } else if (claim.expectedDeltaPp < 0) {
      errors.push("expectedDeltaPp 不能为负");
    }
  }
  return errors;
}

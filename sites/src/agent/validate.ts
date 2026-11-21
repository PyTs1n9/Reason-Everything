/**
 * 输出验证（服务端校验，确定性）：
 * - 调用一：字段集合与类型、只用给定字典、增幅与原句一致、scope 未经学生确认必须置空、
 *   缺增幅/null、百分比与百分点不清必须追问；拒绝返回实验数值（多余字段）。
 * - 调用二：四段结构与类型、evidenceIds 必须存在于预注册事实、运行号与数字必须绑定
 *   已注册事实（拒绝 R99、虚构精确数字）、缺测时不得给出增强贡献数值且须引用缺格/未满足
 *   条件、有补跑单时 nextAction 必须引用动作事实。
 * 校验只保证结构与绑定合法，不宣称能证明全部自由文本正确（自由文本是建议草稿）。
 */

import { parseClaimSentence } from "../experiment/claim.ts";
import type { EvidencePackage } from "../experiment/evidence.ts";
import type {
  AnalysisModelOutput,
  AnalysisRequest,
  ParseModelOutput,
  ParseRequest,
} from "./adapter.ts";
import { buildFactRegistry } from "./facts.ts";

export type ValidationCode = "empty_response" | "bad_json" | "validation_failed";

export type ValidationResult<T> =
  | { ok: true; output: T }
  | { ok: false; code: ValidationCode; errors: string[] };

const PARSE_KEYS = ["factor", "metric", "scope", "expectedDeltaPp", "clarifyingQuestion"];
const SECTION_KEYS = ["observation", "interpretation", "nextAction", "revisedClaim"] as const;

function parseJson(raw: string): { value: unknown } | { code: ValidationCode; errors: string[] } {
  const text = raw.trim();
  if (!text) return { code: "empty_response", errors: ["空响应"] };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { code: "bad_json", errors: ["响应不是合法 JSON"] };
  }
}

function fail(code: ValidationCode, errors: string[]): { ok: false; code: ValidationCode; errors: string[] } {
  return { ok: false, code, errors };
}

export function validateParseOutput(raw: string, request: ParseRequest): ValidationResult<ParseModelOutput> {
  const parsed = parseJson(raw);
  if ("code" in parsed) return fail(parsed.code, parsed.errors);

  const obj = parsed.value;
  const errors: string[] = [];
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return fail("validation_failed", ["输出不是 JSON 对象"]);
  }
  const record = obj as Record<string, unknown>;

  const keys = Object.keys(record).sort();
  const expected = [...PARSE_KEYS].sort();
  if (keys.join("|") !== expected.join("|")) {
    errors.push(`字段集合不符（不得返回实验数值或补跑结论）: 实际 ${keys.join(",")}`);
  }

  if (typeof record.factor !== "string" || !request.fieldDict.factors.includes(record.factor)) {
    errors.push("factor 不在给定字典内或类型错误");
  }
  if (typeof record.metric !== "string" || !request.fieldDict.metrics.includes(record.metric)) {
    errors.push("metric 不在给定字典内或类型错误");
  }
  if (record.scope !== null) {
    errors.push("学生未指定学习率范围，scope 必须为 null（由后续确认步骤输入）");
  }
  if (
    record.expectedDeltaPp !== null &&
    (typeof record.expectedDeltaPp !== "number" ||
      !Number.isFinite(record.expectedDeltaPp) ||
      record.expectedDeltaPp < 0)
  ) {
    errors.push("expectedDeltaPp 必须是非负数或 null");
  }
  if (typeof record.clarifyingQuestion !== "string") {
    errors.push("clarifyingQuestion 必须是字符串");
  }

  const ground = parseClaimSentence(request.rawClaim);
  const question = typeof record.clarifyingQuestion === "string" ? record.clarifyingQuestion.trim() : "";

  if (record.expectedDeltaPp === null) {
    if (ground && ground.direction === "increase" && ground.deltaUnit === "pp" && ground.deltaPp !== null) {
      errors.push("原句明写了百分点增幅，expectedDeltaPp 不得丢弃");
    }
  } else if (typeof record.expectedDeltaPp === "number") {
    if (!ground) {
      errors.push("原句无法识别增幅，expectedDeltaPp 必须为 null");
    } else if (ground.direction !== "increase") {
      errors.push("原句不是「提高」类主张，不得给出增幅，须追问");
    } else if (ground.deltaUnit === "percent") {
      errors.push("百分数与百分点含义不清，须询问，不得直接换算");
    } else if (ground.deltaPp !== null && record.expectedDeltaPp !== ground.deltaPp) {
      errors.push(`错误增幅: 原句为 ${ground.deltaPp} 个百分点，模型给出 ${record.expectedDeltaPp}`);
    } else if (ground.deltaPp === null) {
      errors.push("原句未写增幅，expectedDeltaPp 必须为 null");
    }
  }

  const needsQuestion =
    record.scope === null ||
    !ground ||
    ground.direction !== "increase" ||
    ground.deltaUnit === "percent" ||
    ground.deltaPp === null;
  if (typeof record.clarifyingQuestion === "string" && needsQuestion && question === "") {
    errors.push("缺少追问（scope 未确认/方向或单位不清时必须提问）");
  }

  if (errors.length > 0) return fail("validation_failed", errors);
  return { ok: true, output: record as unknown as ParseModelOutput };
}

function stripBoundTokens(text: string): string {
  return text
    .replace(/\bR\d{2,}\b/g, " ")
    .replace(/\b[vV]\d+\b/g, " ");
}

function extractNumbers(text: string): number[] {
  const matches = stripBoundTokens(text).match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map(Number);
}

function hasRegisteredNumber(registry: ReturnType<typeof buildFactRegistry>, value: number): boolean {
  for (const registered of registry.numericValues) {
    if (Math.abs(registered - value) < 1e-9) return true;
  }
  return false;
}

export function validateAnalysisOutput(
  request: AnalysisRequest,
  raw: string,
): ValidationResult<AnalysisModelOutput> {
  const parsed = parseJson(raw);
  if ("code" in parsed) return fail(parsed.code, parsed.errors);

  const obj = parsed.value;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return fail("validation_failed", ["输出不是 JSON 对象"]);
  }
  const record = obj as Record<string, unknown>;
  const errors: string[] = [];

  const keys = Object.keys(record).sort();
  const expected = [...SECTION_KEYS].sort();
  if (keys.join("|") !== expected.join("|")) {
    errors.push(`段落集合不符（需 ${SECTION_KEYS.join("/")}）: 实际 ${keys.join(",")}`);
  }

  const registry = buildFactRegistry(request.evidence, request.question.confirmedClaim);
  const texts: string[] = [];
  const sectionShapes: Record<string, { text: string; evidenceIds: string[] } | null> = {};

  for (const key of SECTION_KEYS) {
    const section = record[key];
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      errors.push(`${key} 必须是 {text, evidenceIds}`);
      sectionShapes[key] = null;
      continue;
    }
    const sec = section as Record<string, unknown>;
    if (typeof sec.text !== "string" || sec.text.trim() === "") {
      errors.push(`${key}.text 必须是非空字符串`);
      sectionShapes[key] = null;
      continue;
    }
    if (
      !Array.isArray(sec.evidenceIds) ||
      sec.evidenceIds.length === 0 ||
      !sec.evidenceIds.every((id) => typeof id === "string")
    ) {
      errors.push(`${key}.evidenceIds 必须是非空字符串数组（每条分析要带 evidenceIds）`);
      sectionShapes[key] = null;
      continue;
    }
    texts.push(sec.text);
    sectionShapes[key] = { text: sec.text, evidenceIds: sec.evidenceIds as string[] };
  }

  // 引用存在性
  for (const [key, section] of Object.entries(sectionShapes)) {
    if (!section) continue;
    for (const id of section.evidenceIds) {
      if (!registry.ids.has(id)) errors.push(`${key} 引用了不存在的事实编号: ${id}`);
    }
  }

  const allText = texts.join("\n");

  // 运行号必须是证据包中真实出现的
  const runTokens = allText.match(/\bR\d{2,}\b/g) ?? [];
  for (const token of new Set(runTokens)) {
    if (!registry.runIds.has(token)) errors.push(`虚构运行编号: ${token}`);
  }

  // 精确数字必须绑定已注册事实
  for (const value of extractNumbers(allText)) {
    if (!hasRegisteredNumber(registry, value)) {
      errors.push(`虚构精确数字: ${value}（数值须绑定已注册事实）`);
    }
  }

  const contribution = request.evidence.augmentationContributionPp;
  const hasMissingCells = request.evidence.cells.some((c) => c.status !== "measured");
  if (contribution === null && hasMissingCells) {
    const contributionWithNumber = [
      /贡献[^。；\n]{0,20}[+-]\d+(?:\.\d+)?/,
      /贡献[^。；\n]{0,20}\d+(?:\.\d+)?\s*个百分点/,
    ];
    for (const text of texts) {
      if (contributionWithNumber.some((pattern) => pattern.test(text))) {
        errors.push("缺测时不得给出增强贡献数值（原句算不出贡献）");
      }
    }
    const observation = sectionShapes.observation;
    if (observation) {
      const citedMissing = observation.evidenceIds.some((id) => {
        const kind = registry.kindsById.get(id);
        return kind === "cell-missing" || kind === "condition";
      });
      if (!citedMissing) {
        errors.push("缺测时 observation 必须引用缺格或未满足条件，解释算不出增强贡献");
      }
    }
  }

  const hasActions = request.evidence.suggestions.length > 0;
  if (hasActions) {
    const nextAction = sectionShapes.nextAction;
    if (nextAction) {
      const citesAction = nextAction.evidenceIds.some(
        (id) => registry.kindsById.get(id) === "action",
      );
      if (!citesAction) errors.push("存在补跑单时 nextAction 必须引用动作事实");
    }
  }

  if (errors.length > 0) return fail("validation_failed", errors);
  return { ok: true, output: record as unknown as AnalysisModelOutput };
}

/** 结构校验（手动填写路径用：不对照原句，只保证形状合法）。 */
export function validateProposalShape(output: unknown): output is ParseModelOutput {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("|") !== [...PARSE_KEYS].sort().join("|")) return false;
  if (typeof record.factor !== "string") return false;
  if (typeof record.metric !== "string") return false;
  if (record.scope !== null && typeof record.scope !== "string") return false;
  if (
    record.expectedDeltaPp !== null &&
    (typeof record.expectedDeltaPp !== "number" || !Number.isFinite(record.expectedDeltaPp) || record.expectedDeltaPp < 0)
  ) {
    return false;
  }
  return typeof record.clarifyingQuestion === "string";
}

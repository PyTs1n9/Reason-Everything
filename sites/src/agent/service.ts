/**
 * 模型服务：装入提示词 → 调用适配器 → 服务端校验 → 最多修复重试一次 → 记录。
 *
 * - parseProposal：单次调用；失败（空响应/坏 JSON/超时/校验不过）交给手动路径。
 * - acceptManualProposal：模型不可用时手动填写，来源标注 manual。
 * - confirmProposal：服务输入模拟学生确认（target/baseline/scope/学习率），
 *   复用卡 02 的 claim 构建（不改比较方向）。
 * - analyze：按 requestId 幂等（重复回调只打一次模型）；校验不过最多修复重试一次；
 *   仍失败 → model 分析失败并保留独立规则报告（证据包原样返回）。
 * - 记录只含 provider/model/版本/关联 revision·job/结果；不写密钥、不默认记录访客原文。
 */

import { proposeClaim } from "../experiment/claim.ts";
import type { ClaimSpec, Factor, Metric } from "../experiment/types.ts";
import type { EvidencePackage } from "../experiment/evidence.ts";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  PARSE_PROMPT_VERSION,
  PARSE_SYSTEM_PROMPT,
} from "./prompts.ts";
import {
  withTimeout,
  type AnalysisModelOutput,
  type AnalysisRequest,
  type ModelAdapter,
  type ParseModelOutput,
  type ParseRequest,
} from "./adapter.ts";
import { RULES_VERSION, buildFactRegistry } from "./facts.ts";
import { validateAnalysisOutput, validateParseOutput, validateProposalShape } from "./validate.ts";

export const DEFAULT_FIELD_DICT = {
  factors: ["augmentation"],
  metrics: ["accuracy"],
  scopes: ["target_lr", "both_lrs"],
};

export interface ModelCallRecord {
  requestId: string;
  kind: "parse" | "analysis";
  promptVersion: string;
  rulesVersion?: string;
  revisionId?: string;
  jobId?: string;
  provider: string;
  model: string;
  result: "ok" | string;
  attempts: number;
}

export type ParseProposalResult =
  | { ok: true; source: "model"; output: ParseModelOutput; log: ModelCallRecord }
  | { ok: false; error: { code: string; message: string }; log: ModelCallRecord };

export interface ManualProposal {
  source: "manual";
  output: ParseModelOutput;
}

export function acceptManualProposal(
  output: unknown,
): { ok: true; proposal: ManualProposal } | { ok: false; errors: string[] } {
  if (!validateProposalShape(output)) {
    return { ok: false, errors: ["手动填写的结构不合法（字段集合或类型不符）"] };
  }
  return { ok: true, proposal: { source: "manual", output } };
}

export interface ConfirmParams {
  rawClaim: string;
  targetRunId: string;
  baselineRunId: string;
  scope: "target_lr" | "both_lrs";
  learningRates: number[];
}

export type ConfirmedClaim =
  | { ok: true; claim: ClaimSpec; source: "model" | "manual" }
  | { ok: false; reason: "needs_clarification"; detail: string; source: "model" | "manual" };

/** 确认结构化主张：服务输入模拟学生确认目标运行与范围。 */
export function confirmProposal(
  proposal: { source: "model" | "manual"; output: ParseModelOutput },
  params: ConfirmParams,
): ConfirmedClaim {
  if (proposal.output.scope !== null && proposal.output.scope !== params.scope) {
    return {
      ok: false,
      reason: "needs_clarification",
      detail: `解析结果的 scope=${proposal.output.scope} 与确认输入 ${params.scope} 不一致`,
      source: proposal.source,
    };
  }
  const built = proposeClaim(params.rawClaim, {
    factor: proposal.output.factor as Factor,
    metric: proposal.output.metric as Metric,
    targetRunId: params.targetRunId,
    baselineRunId: params.baselineRunId,
    scope: params.scope,
    learningRates: params.learningRates,
  });
  if (!built.ok) {
    return { ok: false, reason: built.reason, detail: built.detail, source: proposal.source };
  }
  return { ok: true, claim: built.spec, source: proposal.source };
}

export interface AnalyzeInput {
  question: {
    questionId: string;
    rawClaim: string;
    confirmedClaim: ClaimSpec;
  };
  evidence: EvidencePackage;
  revisionId?: string;
  jobId?: string;
}

export type AnalysisResult =
  | { ok: true; output: AnalysisModelOutput; log: ModelCallRecord }
  | {
      ok: false;
      error: { code: string; message: string };
      /** 独立规则报告：模型失败时原样保留证据包。 */
      ruleReport: EvidencePackage;
      log: ModelCallRecord;
    };

export interface AgentServiceOptions {
  timeoutMs?: number;
}

const NOT_PROVIDED = "未提供";

export function createAgentService(adapter: ModelAdapter, options: AgentServiceOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const analysisCache = new Map<string, AnalysisResult>();

  return {
    async parseProposal(requestId: string, rawClaim: string): Promise<ParseProposalResult> {
      const request: ParseRequest = {
        systemPrompt: PARSE_SYSTEM_PROMPT,
        promptVersion: PARSE_PROMPT_VERSION,
        rawClaim,
        fieldDict: DEFAULT_FIELD_DICT,
      };
      let provider = NOT_PROVIDED;
      let model = NOT_PROVIDED;
      try {
        const response = await withTimeout(adapter.parse(request), timeoutMs);
        provider = response.provider;
        model = response.model;
        const check = validateParseOutput(response.text, request);
        if (check.ok) {
          return {
            ok: true,
            source: "model",
            output: check.output,
            log: {
              requestId,
              kind: "parse",
              promptVersion: PARSE_PROMPT_VERSION,
              provider,
              model,
              result: "ok",
              attempts: 1,
            },
          };
        }
        return {
          ok: false,
          error: { code: check.code, message: check.errors.join("；") },
          log: {
            requestId,
            kind: "parse",
            promptVersion: PARSE_PROMPT_VERSION,
            provider,
            model,
            result: check.code,
            attempts: 1,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message === "timeout" ? "timeout" : "adapter_error";
        return {
          ok: false,
          error: { code, message },
          log: {
            requestId,
            kind: "parse",
            promptVersion: PARSE_PROMPT_VERSION,
            provider,
            model,
            result: code,
            attempts: 1,
          },
        };
      }
    },

    /** 按 requestId 幂等：重复回调返回同一结果，不再打模型。 */
    async analyze(requestId: string, input: AnalyzeInput): Promise<AnalysisResult> {
      const cached = analysisCache.get(requestId);
      if (cached) return cached;

      const registry = buildFactRegistry(input.evidence, input.question.confirmedClaim);
      const request: AnalysisRequest = {
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        rulesVersion: RULES_VERSION,
        question: input.question,
        evidence: input.evidence,
        facts: registry.facts,
        allowedEvidenceIds: [...registry.ids],
      };

      let provider = NOT_PROVIDED;
      let model = NOT_PROVIDED;
      let attempts = 0;
      let lastCode = "adapter_error";
      let lastMessage = "";
      let output: AnalysisModelOutput | null = null;

      while (attempts < 2) {
        attempts++;
        try {
          const response = await withTimeout(adapter.analyze(request), timeoutMs);
          provider = response.provider;
          model = response.model;
          const check = validateAnalysisOutput(request, response.text);
          if (check.ok) {
            output = check.output;
            lastCode = "ok";
            lastMessage = "";
            break;
          }
          lastCode = check.code;
          lastMessage = check.errors.join("；");
          request.repairFeedback = check.errors;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastCode = message === "timeout" ? "timeout" : "adapter_error";
          lastMessage = message;
        }
      }

      const log: ModelCallRecord = {
        requestId,
        kind: "analysis",
        promptVersion: ANALYSIS_PROMPT_VERSION,
        rulesVersion: RULES_VERSION,
        revisionId: input.revisionId,
        jobId: input.jobId,
        provider,
        model,
        result: lastCode,
        attempts,
      };

      const result: AnalysisResult = output
        ? { ok: true, output, log }
        : {
            ok: false,
            error: { code: lastCode, message: lastMessage },
            ruleReport: input.evidence,
            log,
          };
      analysisCache.set(requestId, result);
      return result;
    },
  };
}

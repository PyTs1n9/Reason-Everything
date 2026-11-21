/**
 * 模型适配器契约：可切换实现，离线测试全走 mock。
 *
 * 真实路径（本环境核对结论见 progress.md 卡 06）：
 * 浏览器 → 同源 Sites Function → Qoder Cloud Agents（apiOrigin=https://api.qoder.com，
 * apiPathPrefix=/api/v1/cloud，get_context 实测 configured=true）。中段 Function 与
 * QODER_PAT 尚未开通（需用户对 PAT 创建的明确确认），故本卡交付适配器 + mock。
 * 密钥只放平台 Secret；前端与本层不接触任何凭据。
 */

import type { ClaimSpec } from "../experiment/types.ts";
import type { EvidencePackage } from "../experiment/evidence.ts";

export interface ParseRequest {
  systemPrompt: string;
  promptVersion: string;
  /** 只有原句。 */
  rawClaim: string;
  /** 可选字段字典：允许的因素、指标、范围。 */
  fieldDict: {
    factors: string[];
    metrics: string[];
    scopes: string[];
  };
  /** 修复重试时回传的校验错误。 */
  repairFeedback?: string[];
}

export interface ParseModelOutput {
  factor: string;
  metric: string;
  scope: string | null;
  expectedDeltaPp: number | null;
  clarifyingQuestion: string;
}

export interface Fact {
  factId: string;
  kind: "cell-measured" | "cell-missing" | "pair" | "action" | "condition" | "number" | "run" | "contribution";
  /** 可替换占位符绑定的值（数值/运行号/文本）。 */
  value?: string | number;
  runIds?: string[];
  cellId?: string;
}

export interface AnalysisRequest {
  systemPrompt: string;
  promptVersion: string;
  rulesVersion: string;
  question: {
    questionId: string;
    rawClaim: string;
    confirmedClaim: ClaimSpec;
  };
  /** 只读证据包（卡 04 输出）。 */
  evidence: EvidencePackage;
  /** 预注册的事实与允许引用的编号。 */
  facts: Fact[];
  allowedEvidenceIds: string[];
  /** 修复重试时回传的校验错误。 */
  repairFeedback?: string[];
}

export interface AnalysisModelSection {
  text: string;
  evidenceIds: string[];
}

export interface AnalysisModelOutput {
  observation: AnalysisModelSection;
  interpretation: AnalysisModelSection;
  nextAction: AnalysisModelSection;
  revisedClaim: AnalysisModelSection;
}

export interface ModelResponse {
  text: string;
  provider: string;
  model: string;
}

export interface ModelAdapter {
  parse(request: ParseRequest): Promise<ModelResponse>;
  analyze(request: AnalysisRequest): Promise<ModelResponse>;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface MockScriptStep {
  /** 返回的原始文本。 */
  text?: string;
  /** 永不返回（用于超时用例）。 */
  hang?: boolean;
  /** 直接抛错。 */
  error?: string;
}

/**
 * 离线桩：按队列回放脚本；队列耗尽后重复最后一步。
 * 记录调用次数与收到的请求，供断言「提示词真的被装入」「重复回调只打一次」。
 */
export class MockAdapter implements ModelAdapter {
  parseSteps: MockScriptStep[];
  analyzeSteps: MockScriptStep[];
  parseCalls = 0;
  analyzeCalls = 0;
  lastParseRequest: ParseRequest | null = null;
  lastAnalyzeRequests: AnalysisRequest[] = [];

  constructor(parseSteps: MockScriptStep[] = [{ text: "" }], analyzeSteps: MockScriptStep[] = [{ text: "" }]) {
    this.parseSteps = parseSteps;
    this.analyzeSteps = analyzeSteps;
  }

  private async step(steps: MockScriptStep[], call: number): Promise<ModelResponse> {
    const index = Math.min(call, steps.length - 1);
    const step = steps[index] ?? { text: "" };
    if (step.hang) return new Promise<ModelResponse>(() => {});
    if (step.error) throw new Error(step.error);
    return { text: step.text ?? "", provider: "mock", model: "mock-model" };
  }

  async parse(request: ParseRequest): Promise<ModelResponse> {
    this.lastParseRequest = request;
    const call = this.parseCalls++;
    return this.step(this.parseSteps, call);
  }

  async analyze(request: AnalysisRequest): Promise<ModelResponse> {
    this.lastAnalyzeRequests.push(request);
    const call = this.analyzeCalls++;
    return this.step(this.analyzeSteps, call);
  }
}

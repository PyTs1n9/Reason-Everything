import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MockAdapter,
  type AnalysisRequest,
  type ParseRequest,
} from "../src/agent/adapter.ts";
import { buildFactRegistry, RULES_VERSION } from "../src/agent/facts.ts";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  PARSE_PROMPT_VERSION,
  PARSE_SYSTEM_PROMPT,
} from "../src/agent/prompts.ts";
import {
  acceptManualProposal,
  confirmProposal,
  createAgentService,
  type AnalyzeInput,
} from "../src/agent/service.ts";
import { buildEvidencePackage, type EvidencePackage } from "../src/experiment/evidence.ts";
import { demoInitialRuns, demoQuestion } from "./fixtures/experiment-demo.ts";

const CTX = { projectId: "p_demo", questionId: "q_demo_0001" };
const CLAIM = demoQuestion.confirmedClaim!;
const SENTENCE = demoQuestion.rawClaim;
const pkg: EvidencePackage = buildEvidencePackage(CLAIM, demoInitialRuns, CTX);

function analyzeInput(evidence: EvidencePackage = pkg): AnalyzeInput {
  return {
    question: {
      questionId: "q_demo_0001",
      rawClaim: SENTENCE,
      confirmedClaim: CLAIM,
    },
    evidence,
    revisionId: "rev_0001",
    jobId: "job_0001",
  };
}

function missingCellId(): string {
  return pkg.cells.find((c) => c.status !== "measured")!.cellId;
}

const GOOD_PARSE = JSON.stringify({
  factor: "augmentation",
  metric: "accuracy",
  scope: null,
  expectedDeltaPp: 2,
  clarifyingQuestion: "目标学习率是哪一档，还是两档都要验证？",
});

/** 只使用已注册事实的合法分析文本。 */
const GOOD_ANALYSIS = JSON.stringify({
  observation: {
    text: "原始比较来自 R02 与 R01：两次运行同时差 lr 与增强开关，+2.00 个百分点只是观测，算不出增强贡献。",
    evidenceIds: [missingCellId(), "fact:cond:0", "fact:obs-delta"],
  },
  interpretation: {
    text: "R02 的准确率 82 高于 R01 的 80，但配置同时变化，不能归为单一因素。",
    evidenceIds: ["fact:run:R02", "fact:run:R01"],
  },
  nextAction: {
    text: "先补跑缺失的那格：复用现有配置只改增强开关。",
    evidenceIds: [pkg.suggestions[0]!.suggestionId],
  },
  revisedClaim: {
    text: "在两档学习率下分别验证数据增强是否让准确率提高 2 个百分点。",
    evidenceIds: ["fact:claim-delta"],
  },
});

// ---------- 提示词资源 ----------

test("两条版本化提示词可被测试定位", () => {
  assert.equal(PARSE_PROMPT_VERSION, "parse-v1");
  assert.equal(ANALYSIS_PROMPT_VERSION, "analysis-v1");
  assert.match(PARSE_SYSTEM_PROMPT, /你负责读懂学生想验证什么/);
  assert.match(PARSE_SYSTEM_PROMPT, /只输出 JSON/);
  assert.match(PARSE_SYSTEM_PROMPT, /factor、metric、scope、expectedDeltaPp、clarifyingQuestion/);
  assert.match(PARSE_SYSTEM_PROMPT, /不得返回实验数值或补跑结论/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /实验设计助教/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /每条分析要带 evidenceIds/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /revisedClaim|仅返回 JSON/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /不发明运行编号/);
});

// ---------- 调用一：解析 ----------

test("解析正常：装入提示词，输出与原句一致，确认后得到契约主张", async () => {
  const adapter = new MockAdapter([{ text: GOOD_PARSE }]);
  const service = createAgentService(adapter);

  const result = await service.parseProposal("req-parse-1", SENTENCE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "model");
  assert.deepEqual(result.output, {
    factor: "augmentation",
    metric: "accuracy",
    scope: null,
    expectedDeltaPp: 2,
    clarifyingQuestion: "目标学习率是哪一档，还是两档都要验证？",
  });

  const request: ParseRequest = adapter.lastParseRequest!;
  assert.equal(request.systemPrompt, PARSE_SYSTEM_PROMPT, "真实 system 提示词被装入");
  assert.equal(request.rawClaim, SENTENCE);
  assert.deepEqual(request.fieldDict, {
    factors: ["augmentation"],
    metrics: ["accuracy"],
    scopes: ["target_lr", "both_lrs"],
  });
  assert.equal(result.log.promptVersion, "parse-v1");
  assert.equal(result.log.provider, "mock");

  const confirmed = confirmProposal(result, {
    rawClaim: SENTENCE,
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.deepEqual(confirmed.claim, CLAIM, "服务输入模拟确认后与契约主张一致");
  assert.equal(confirmed.source, "model");
});

test("空响应 → 解析失败，手动路径可填并标注来源", async () => {
  const service = createAgentService(new MockAdapter([{ text: "" }]));
  const result = await service.parseProposal("req-parse-empty", SENTENCE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "empty_response");
  assert.equal(result.log.attempts, 1);

  const parsed = JSON.parse(GOOD_PARSE) as unknown;
  const manual = acceptManualProposal(parsed);
  assert.equal(manual.ok, true);
  if (!manual.ok) return;
  assert.equal(manual.proposal.source, "manual");
  const confirmed = confirmProposal(manual.proposal, {
    rawClaim: SENTENCE,
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
  });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) assert.equal(confirmed.source, "manual");
});

test("坏 JSON → 解析失败", async () => {
  const service = createAgentService(new MockAdapter([{ text: "{oops" }]));
  const result = await service.parseProposal("req-parse-badjson", SENTENCE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "bad_json");
});

test("错误增幅被拒绝（模型说 5，原句是 2）", async () => {
  const wrong = JSON.stringify({
    factor: "augmentation",
    metric: "accuracy",
    scope: null,
    expectedDeltaPp: 5,
    clarifyingQuestion: "哪一档学习率？",
  });
  const service = createAgentService(new MockAdapter([{ text: wrong }]));
  const result = await service.parseProposal("req-parse-delta", SENTENCE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation_failed");
  assert.match(result.error.message, /错误增幅/);
});

test("学生未确认范围时模型不得擅自设 scope", async () => {
  const withScope = JSON.stringify({
    factor: "augmentation",
    metric: "accuracy",
    scope: "both_lrs",
    expectedDeltaPp: 2,
    clarifyingQuestion: "哪一档？",
  });
  const service = createAgentService(new MockAdapter([{ text: withScope }]));
  const result = await service.parseProposal("req-parse-scope", SENTENCE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /scope 必须为 null/);
});

test("返回实验数值（多余字段）被拒绝", async () => {
  const withExtra = JSON.stringify({
    factor: "augmentation",
    metric: "accuracy",
    scope: null,
    expectedDeltaPp: 2,
    clarifyingQuestion: "哪一档？",
    accuracy: 82,
  });
  const service = createAgentService(new MockAdapter([{ text: withExtra }]));
  const result = await service.parseProposal("req-parse-extra", SENTENCE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /字段集合不符/);
});

// ---------- 调用二：最终分析 ----------

test("分析正常：四段输出、记录完整且不含访客原文", async () => {
  const adapter = new MockAdapter([], [{ text: GOOD_ANALYSIS }]);
  const service = createAgentService(adapter);

  const result = await service.analyze("req-an-1", analyzeInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.output.observation.text.includes("R02"), true);
  assert.equal(result.log.promptVersion, ANALYSIS_PROMPT_VERSION);
  assert.equal(result.log.rulesVersion, RULES_VERSION);
  assert.equal(result.log.provider, "mock");
  assert.equal(result.log.revisionId, "rev_0001");
  assert.equal(result.log.jobId, "job_0001");
  assert.equal(result.log.result, "ok");
  const serialized = JSON.stringify(result.log);
  assert.equal(serialized.includes("数据增强"), false, "记录不含访客原句");
  assert.equal(serialized.includes("原始比较"), false, "记录不含模型自由文本");

  const request: AnalysisRequest = adapter.lastAnalyzeRequests[0]!;
  assert.equal(request.systemPrompt, ANALYSIS_SYSTEM_PROMPT, "真实 system 提示词被装入");
  assert.equal(request.rulesVersion, RULES_VERSION);
  assert.ok(request.facts.length > 0, "预注册了事实");
  assert.ok(request.allowedEvidenceIds.includes(missingCellId()), "允许引用的编号含 cellId");
  assert.ok(request.allowedEvidenceIds.includes(pkg.suggestions[0]!.suggestionId));
  assert.deepEqual(request.question.confirmedClaim, CLAIM);
});

test("空响应 → 重试一次后失败，独立规则报告保留", async () => {
  const adapter = new MockAdapter([], [{ text: "" }, { text: "" }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-empty", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "empty_response");
  assert.equal(result.log.attempts, 2);
  assert.equal(adapter.analyzeCalls, 2);
  assert.deepEqual(result.ruleReport, pkg, "规则报告原样保留");
});

test("坏 JSON → 重试一次后失败", async () => {
  const adapter = new MockAdapter([], [{ text: "not json" }, { text: "not json" }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-badjson", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "bad_json");
  assert.equal(adapter.analyzeCalls, 2);
});

test("超时 → 失败并保留规则报告", async () => {
  const adapter = new MockAdapter([], [{ hang: true }, { hang: true }]);
  const service = createAgentService(adapter, { timeoutMs: 20 });
  const result = await service.analyze("req-an-timeout", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "timeout");
  assert.equal(adapter.analyzeCalls, 2);
  assert.deepEqual(result.ruleReport.conclusions, pkg.conclusions);
});

test("伪造编号 R99 被拒绝（引用与正文双重检查）", async () => {
  const forged = JSON.parse(GOOD_ANALYSIS) as Record<string, { text: string; evidenceIds: string[] }>;
  forged.observation = {
    text: "R99 显示增强贡献 +2.00 个百分点。",
    evidenceIds: ["fact:run:R99"],
  };
  const adapter = new MockAdapter([], [{ text: JSON.stringify(forged) }, { text: JSON.stringify(forged) }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-r99", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /不存在的事实编号: fact:run:R99/);
  assert.match(result.error.message, /虚构运行编号: R99/);
});

test("虚构精确数字被拒绝", async () => {
  const invented = JSON.parse(GOOD_ANALYSIS) as Record<string, { text: string; evidenceIds: string[] }>;
  invented.interpretation = {
    text: "R02 的准确率 83.7 明显更高。",
    evidenceIds: ["fact:run:R02"],
  };
  const adapter = new MockAdapter([], [{ text: JSON.stringify(invented) }, { text: JSON.stringify(invented) }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-num", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /虚构精确数字: 83.7/);
});

test("缺测时把 +2 当作已匹配增强贡献被拒绝", async () => {
  const wrongContribution = JSON.parse(GOOD_ANALYSIS) as Record<string, { text: string; evidenceIds: string[] }>;
  wrongContribution.observation = {
    text: "本题的增强贡献为 +2.00 个百分点。",
    evidenceIds: [missingCellId()],
  };
  const adapter = new MockAdapter([], [
    { text: JSON.stringify(wrongContribution) },
    { text: JSON.stringify(wrongContribution) },
  ]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-contrib", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /不得给出增强贡献数值/);
});

test("缺证据（空 evidenceIds）被拒绝", async () => {
  const noEvidence = JSON.parse(GOOD_ANALYSIS) as Record<string, { text: string; evidenceIds: string[] }>;
  noEvidence.observation = { text: "缺测无法给出贡献。", evidenceIds: [] };
  const adapter = new MockAdapter([], [{ text: JSON.stringify(noEvidence) }, { text: JSON.stringify(noEvidence) }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-noev", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /observation\.evidenceIds 必须是非空字符串数组/);
});

test("修复重试：第一次不合格、第二次合格 → 成功", async () => {
  const broken = JSON.stringify({ observation: { text: "只有一页", evidenceIds: [] } });
  const adapter = new MockAdapter([], [{ text: broken }, { text: GOOD_ANALYSIS }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-repair", analyzeInput());
  assert.equal(result.ok, true);
  assert.equal(adapter.analyzeCalls, 2);
  if (!result.ok) return;
  assert.equal(result.log.attempts, 2);
  assert.ok(
    (adapter.lastAnalyzeRequests[1]?.repairFeedback?.length ?? 0) > 0,
    "第二次请求携带修复反馈",
  );
});

test("修复失败：两次都不合格 → 模型分析失败，规则报告保留", async () => {
  const bad = JSON.parse(GOOD_ANALYSIS) as Record<string, { text: string; evidenceIds: string[] }>;
  bad.nextAction = {
    text: "先补跑缺失的那格。",
    evidenceIds: ["fact:claim-delta"],
  };
  const text = JSON.stringify(bad);
  const adapter = new MockAdapter([], [{ text }, { text }]);
  const service = createAgentService(adapter);
  const result = await service.analyze("req-an-repairfail", analyzeInput());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation_failed");
  assert.match(result.error.message, /nextAction 必须引用动作事实/);
  assert.equal(adapter.analyzeCalls, 2);
  assert.deepEqual(result.ruleReport, pkg, "失败仍保留独立规则报告");
});

test("重复回调按 requestId 幂等：只打一次模型", async () => {
  const adapter = new MockAdapter([], [{ text: GOOD_ANALYSIS }]);
  const service = createAgentService(adapter);
  const first = await service.analyze("req-an-dup", analyzeInput());
  const second = await service.analyze("req-an-dup", analyzeInput());
  assert.equal(adapter.analyzeCalls, 1, "重复回调不再调用模型");
  assert.deepEqual(second, first);
});

test("事实注册表覆盖 evidenceId 高亮链路（cell/pair/action）", () => {
  const registry = buildFactRegistry(pkg, CLAIM);
  assert.ok(registry.ids.has(missingCellId()));
  assert.ok(registry.ids.has(pkg.suggestions[0]!.suggestionId));
  assert.ok(registry.runIds.has("R01"));
  assert.ok(registry.runIds.has("R02"));
  assert.ok(registry.numericValues.has(82));
  assert.ok(registry.numericValues.has(2));
  const missingFact = registry.facts.find((f) => f.factId === missingCellId());
  assert.equal(missingFact?.kind, "cell-missing");
});

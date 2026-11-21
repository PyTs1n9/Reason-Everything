/**
 * 实验归因业务 v1 数据结构（契约见 docs/experiment-v1.md）。
 *
 * 四种身份各自独立：Project / Question / TrainingRun / AnalysisRevision。
 * 状态分三处存：问题状态、分析作业状态、模型输出状态，互不混用。
 */

/** 运行数据来源：演示数据与真实导入必须能分开标识。 */
export type SourceKind = "demo" | "real";

/** 问题状态。waiting_for_run 是缺实验时的正常产物，不是错误。 */
export type QuestionStatus = "needs_input" | "waiting_for_run" | "reviewable";

/** 分析作业状态（作业本身，不是问题也不是版本）。 */
export type AnalysisJobStatus = "queued" | "running" | "succeeded" | "failed";

/** 模型输出状态。failed 时已算出的证据（结论与引用）保留。 */
export type ModelOutputStatus = "pending" | "ready" | "failed" | "unavailable";

/** v1 固定要验证的因素：增强开关。 */
export type Factor = "augmentation";

/** v1 固定指标：准确率，高者优，单位 0–100。 */
export type Metric = "accuracy";

/** 主张范围：只看目标学习率，或两档学习率逐档验证。 */
export type ClaimScope = "target_lr" | "both_lrs";

export interface Project {
  projectId: string;
  name: string;
  updatedAt: string;
}

/**
 * 已确认的结构化主张。
 * expectedDeltaPp 为百分点：null 表示仅检查方向；非 null 表示逐档验证
 * 「至少提高 N 个百分点」。v1 只表达「提高」，比较方向不可改。
 */
export interface ClaimSpec {
  factor: Factor;
  metric: Metric;
  targetRunId: string;
  baselineRunId: string;
  scope: ClaimScope;
  /** 两档学习率列表（数值，单位同导入的 lr 列）。 */
  learningRates: [number, number];
  expectedDeltaPp: number | null;
}

export interface Question {
  questionId: string;
  projectId: string;
  /** 用户原句。 */
  rawClaim: string;
  /** 已确认的结构化主张；未确认时为 null（needs_input）。 */
  confirmedClaim: ClaimSpec | null;
  /** 当前版本的 revisionId；尚无分析时为 null。 */
  currentRevisionId: string | null;
  status: QuestionStatus;
}

/**
 * 配置单元格。空值一律是 "unknown"，绝不默认与任何值相同
 * （unknown 连另一个 unknown 都不等于——缺对缺不能算匹配）。
 */
export type Cell = string | number | "unknown";

/** 每行的必要配置列；optimizer / epochs 等为可选列，参与匹配。 */
export interface RunConfig {
  model: Cell;
  evalSplit: Cell;
  seed: Cell;
  lr: Cell;
  augmentation: Cell;
  optimizer?: Cell;
  epochs?: Cell;
  /** 导入时发现的其他配置列，确认角色后并入匹配。 */
  extras?: Record<string, Cell>;
}

/** 指标与备注类信息：只作元数据，永不参与配置匹配。 */
export interface RunMetadata {
  /** 实验编号（元数据，不是 runId）。 */
  experimentNo?: string;
  note?: string;
  importedAt: string;
}

export interface TrainingRun {
  /** 项目内唯一；不同项目可各自拥有 R01。 */
  runId: string;
  projectId: string;
  config: RunConfig;
  source: SourceKind;
  /** accuracy 单位 0–100，最多两位小数。 */
  metrics: { accuracy: number };
  metadata: RunMetadata;
}

export interface EvidenceRef {
  runId: string;
  projectId: string;
}

export type RuleResult = "pass" | "fail" | "insufficient_data" | "needs_clarification";

export interface RuleConclusion {
  /** 形如 `direction@0.01`、`delta@0.01`（逐档规则）。 */
  ruleId: string;
  result: RuleResult;
  detail: string;
}

/**
 * 分析版本：不可变。输入是快照 + 引用，生成后不再改；
 * 疑问范围变化或追加记录都在同一 questionId 下新建 revision。
 */
export interface AnalysisRevision {
  /** 与 runId 不同域：runId 不能冒充 revisionId。 */
  revisionId: string;
  questionId: string;
  parentId: string | null;
  createdAt: string;
  inputSnapshot: {
    claim: ClaimSpec;
    runs: TrainingRun[];
  };
  conclusions: RuleConclusion[];
  evidenceRefs: EvidenceRef[];
  suggestions: string[];
  modelOutput: ModelOutputStatus;
}

/** 分析作业：排队与执行状态属于作业，不属于问题或版本。 */
export interface AnalysisJob {
  jobId: string;
  questionId: string;
  /** 成功后回填产出的 revisionId；未产出时为 null。 */
  revisionId: string | null;
  status: AnalysisJobStatus;
}

export const QUESTION_STATUSES: readonly QuestionStatus[] = [
  "needs_input",
  "waiting_for_run",
  "reviewable",
];

export const ANALYSIS_JOB_STATUSES: readonly AnalysisJobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
];

export const MODEL_OUTPUT_STATUSES: readonly ModelOutputStatus[] = [
  "pending",
  "ready",
  "failed",
  "unavailable",
];

export const RULE_RESULTS: readonly RuleResult[] = [
  "pass",
  "fail",
  "insufficient_data",
  "needs_clarification",
];

export const SOURCE_KINDS: readonly SourceKind[] = ["demo", "real"];

export const CLAIM_SCOPES: readonly ClaimScope[] = ["target_lr", "both_lrs"];

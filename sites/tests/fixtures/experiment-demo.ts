/**
 * 卡 02 固定演示样例（全部标记为 demo 来源，不是真实实验）。
 *
 * 共同条件：model=M1、evalSplit=S1:v1、seed=7、optimizer=adam、epochs=20。
 *   R01 增强关 / lr 0.001 / accuracy 80.0
 *   R02 增强开 / lr 0.01  / accuracy 82.0
 *   R03 增强关 / lr 0.01  / accuracy 81.8   ← 回填数据，不在初始导入里
 *   R04 增强开 / lr 0.001 / accuracy 80.5   ← 回填数据，不在初始导入里
 *
 * 初始导入恰好两行（R01、R02）；R03、R04 单独作为后续回填集合。
 */

import type {
  AnalysisJob,
  AnalysisRevision,
  Project,
  Question,
  TrainingRun,
} from "../../src/experiment/types.ts";

const IMPORTED_AT = "2026-11-21T00:00:00.000Z";

export const demoProject: Project = {
  projectId: "p_demo",
  name: "演示项目 · 增强开关归因",
  updatedAt: IMPORTED_AT,
};

export const demoQuestion: Question = {
  questionId: "q_demo_0001",
  projectId: "p_demo",
  rawClaim: "数据增强使准确率提高了 2 个百分点",
  confirmedClaim: {
    factor: "augmentation",
    metric: "accuracy",
    targetRunId: "R02",
    baselineRunId: "R01",
    scope: "both_lrs",
    learningRates: [0.001, 0.01],
    expectedDeltaPp: 2,
  },
  currentRevisionId: "rev_demo_0001",
  status: "waiting_for_run",
};

function run(
  runId: string,
  augmentation: "on" | "off",
  lr: number,
  accuracy: number,
  experimentNo: string,
): TrainingRun {
  return {
    runId,
    projectId: "p_demo",
    config: {
      model: "M1",
      evalSplit: "S1:v1",
      seed: 7,
      lr,
      augmentation,
      optimizer: "adam",
      epochs: 20,
    },
    source: "demo",
    metrics: { accuracy },
    metadata: { experimentNo, importedAt: IMPORTED_AT },
  };
}

/** 初始导入：恰好两行。 */
export const demoInitialRuns: TrainingRun[] = [run("R01", "off", 0.001, 80.0, "E-01"), run("R02", "on", 0.01, 82.0, "E-02")];

/** 后续回填：单独集合，不藏在初始运行里。 */
export const demoBackfillRuns: TrainingRun[] = [
  run("R03", "off", 0.01, 81.8, "E-03"),
  run("R04", "on", 0.001, 80.5, "E-04"),
];

export const demoAllRuns: TrainingRun[] = [...demoInitialRuns, ...demoBackfillRuns];

/** 初始两行下按 ClaimSpec 的真实规则输出（与 evaluateClaim 一致）。 */
export const demoRevision: AnalysisRevision = {
  revisionId: "rev_demo_0001",
  questionId: "q_demo_0001",
  parentId: null,
  createdAt: IMPORTED_AT,
  inputSnapshot: {
    claim: {
      factor: "augmentation",
      metric: "accuracy",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "both_lrs",
      learningRates: [0.001, 0.01],
      expectedDeltaPp: 2,
    },
    runs: [demoInitialRuns[0]!, demoInitialRuns[1]!],
  },
  conclusions: [
    {
      ruleId: "direction@0.001",
      result: "insufficient_data",
      detail: "lr=0.001 缺少 augmentation=on 的可比运行",
    },
    {
      ruleId: "direction@0.01",
      result: "insufficient_data",
      detail: "lr=0.01 缺少 augmentation=off 的可比运行",
    },
  ],
  evidenceRefs: [],
  suggestions: [
    "补跑：model=M1, evalSplit=S1:v1, seed=7, optimizer=adam, epochs=20, lr=0.001, augmentation=on",
    "补跑：model=M1, evalSplit=S1:v1, seed=7, optimizer=adam, epochs=20, lr=0.01, augmentation=off",
  ],
  modelOutput: "pending",
};

export const demoJob: AnalysisJob = {
  jobId: "job_demo_0001",
  questionId: "q_demo_0001",
  revisionId: null,
  status: "queued",
};

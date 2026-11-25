/**
 * 演示验收（无界面）：只用正式服务动作驱动完整比赛示例。
 * 隔离测试项目 + 进程内后端，不触碰任何真实研究数据；
 * 正式持久化适配器（IndexedDB）由 tests/harness 在浏览器单独核验。
 * 运行：npm run verify:flow   （任一场景失败 → 退出码 1）
 */

import { parseClaimSentence } from "../src/experiment/claim.ts";
import { conclusionsFromPackage } from "../src/experiment/evidence.ts";
import { MemoryBackend, createDataService } from "../src/experiment/storage.ts";
import type {
  AnalysisRequest,
  ModelAdapter,
  ModelResponse,
  ParseRequest,
} from "../src/agent/adapter.ts";
import { createAgentService } from "../src/agent/service.ts";
import { createWorkflowService, type AnalyzeDone } from "../src/workflow/service.ts";

const ACTOR = { userId: "verify-local" };

let tick = 0;
function now(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 21, 13, 0, 0) + tick).toISOString();
}

const HEADER = "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy";
const R01 = "R01,M1,S1:v1,7,0.001,off,adam,20,80";
const R02 = "R02,M1,S1:v1,7,0.01,on,adam,20,82";
const R03 = "R03,M1,S1:v1,7,0.01,off,adam,20,81.8";
const R04 = "R04,M1,S1:v1,7,0.001,on,adam,20,80.5";
const R03_SEED8 = "R03,M1,S1:v1,8,0.01,off,adam,20,81.8";
const R05_SPLIT = "R05,M1,S1:v2,7,0.01,off,adam,20,81.8";
const SENTENCE = "数据增强使准确率提高了 2 个百分点";
const SENTENCE_BOTH = "数据增强在两档学习率下都提高了吗";

const csv = (...rows: string[]): string => [HEADER, ...rows].join("\n");

/** 离线桩：按请求证据现场生成合法四段；fabricate 模式故意伪造。 */
class VerifyAdapter implements ModelAdapter {
  fabricate = false;
  parseCalls = 0;
  analyzeCalls = 0;

  async parse(request: ParseRequest): Promise<ModelResponse> {
    this.parseCalls += 1;
    const ground = parseClaimSentence(request.rawClaim);
    const delta =
      ground && ground.direction === "increase" && ground.deltaUnit === "pp" ? ground.deltaPp : null;
    return {
      text: JSON.stringify({
        factor: "augmentation",
        metric: "accuracy",
        scope: null,
        expectedDeltaPp: delta,
        clarifyingQuestion: "目标学习率是哪一档，还是两档都要验证？",
      }),
      provider: "mock",
      model: "mock-verify",
    };
  }

  async analyze(request: AnalysisRequest): Promise<ModelResponse> {
    this.analyzeCalls += 1;
    if (this.fabricate) {
      return {
        text: JSON.stringify({
          observation: {
            text: "R99 显示缺失格的准确率是 81.5，增强贡献为 +2.00 个百分点。",
            evidenceIds: ["fact:obs-delta"],
          },
          interpretation: {
            text: "两次运行的观测差为 2 个百分点。",
            evidenceIds: ["fact:run:R02"],
          },
          nextAction: { text: "无需补跑，已有足够证据。", evidenceIds: ["fact:claim-delta"] },
          revisedClaim: {
            text: "数据增强使准确率提高了 2 个百分点。",
            evidenceIds: ["fact:claim-delta"],
          },
        }),
        provider: "mock",
        model: "mock-verify",
      };
    }
    return { text: JSON.stringify(buildValid(request)), provider: "mock", model: "mock-verify" };
  }
}

function buildValid(request: AnalysisRequest): Record<string, unknown> {
  const pkg = request.evidence;
  const claim = request.question.confirmedClaim;
  const missing = pkg.cells.filter((c) => c.status !== "measured").map((c) => c.cellId);
  const observationIds = ["fact:obs-delta"];
  if (missing.length > 0) observationIds.push(missing[0]!);
  else if (pkg.pairs.length > 0) observationIds.push(pkg.pairs[0]!.pairId);

  const action = pkg.suggestions[0]?.suggestionId;
  const nextAction = action
    ? { text: "先补跑缺失的那格：复用现有配置只改增强开关。", evidenceIds: [action] }
    : {
        text: "现有对照已足够描述该档效应，可直接复用。",
        evidenceIds: [pkg.pairs[0]?.pairId ?? pkg.cells[0]!.cellId],
      };
  const revisedClaim =
    claim.expectedDeltaPp === null
      ? {
          text: "在两档学习率下分别验证数据增强是否让准确率提高。",
          evidenceIds: [missing[0] ?? "fact:obs-delta"],
        }
      : {
          text: "数据增强是否让准确率提高 2 个百分点，需按确认的范围逐档验证。",
          evidenceIds: ["fact:claim-delta"],
        };

  return {
    observation: {
      text: "原始比较来自 R02 与 R01：两次运行同时差 lr 与增强开关，+2.00 个百分点只是观测，算不出增强贡献。",
      evidenceIds: observationIds,
    },
    interpretation: {
      text: "目标运行的准确率高于基准，但两次运行同时改变了配置，不能归为单一因素。",
      evidenceIds: ["fact:run:R02", "fact:run:R01"],
    },
    nextAction,
    revisedClaim,
  };
}

// ---------- 断言收集 ----------

const failures = new Map<string, string[]>();
function check(scenario: string, cond: boolean, detail: string): void {
  if (!cond) {
    const list = failures.get(scenario) ?? [];
    list.push(detail);
    failures.set(scenario, list);
  }
}
function finish(scenario: string, summary: string): void {
  const fails = failures.get(scenario);
  const tag = fails ? "FAIL" : "PASS";
  console.log(`[${scenario}] ${tag} ${summary}${fails ? " | 问题: " + fails.join("；") : ""}`);
}

function matrixFromRuns(runs: Array<{ runId: string; config: { lr: unknown; augmentation: unknown }; metrics: { accuracy: number } }>): string {
  const lrs = [...new Set(runs.map((r) => r.config.lr))].sort((a, b) => Number(a) - Number(b));
  const parts: string[] = [];
  for (const lr of lrs) {
    for (const aug of ["off", "on"]) {
      const hit = runs.find((r) => r.config.lr === lr && r.config.augmentation === aug);
      parts.push(`${String(lr)}/${aug}=${hit ? `${hit.runId}(${hit.metrics.accuracy})` : "—"}`);
    }
  }
  return parts.join("  ");
}

function runIdsOf(result: AnalyzeDone): string {
  const ids = new Set<string>();
  for (const citation of result.analysis?.citations ?? []) {
    for (const runId of citation.runIds) ids.add(runId);
  }
  return [...ids].sort().join(",") || "(无)";
}

async function main(): Promise<void> {
  const backend = new MemoryBackend();
  const data = createDataService(backend);
  const adapter = new VerifyAdapter();
  const agent = createAgentService(adapter, { timeoutMs: 2000 });
  const wf = createWorkflowService({ storage: data, agent, now });
  const wfReentry = createWorkflowService({ storage: data, agent: null, now });

  console.log("== AgentFlow 无界面核验闭环（verify:flow）==");
  console.log("模型模式: mock-verify（离线桩）；本地模型配置接口已实现，真实模型未测");
  console.log("数据: 进程内后端 + 隔离测试项目（p_v1..p_v5），不触碰真实研究数据");

  const runsOf = (projectId: string) => data.listRuns(ACTOR, projectId);

  // ---------- ① 初始两行 · 目标 0.01 ----------
  const S1 = "①";
  await wf.createProject(ACTOR, "验收 · 目标档", "p_v1");
  await wf.createQuestion(ACTOR, { projectId: "p_v1", questionId: "q_a", rawClaim: SENTENCE });
  const p1 = await wf.parseClaim("req-parse-a", SENTENCE);
  check(S1, p1.ok, "解析失败");
  if (p1.ok) {
    const c1 = await wf.confirmScope(ACTOR, {
      questionId: "q_a",
      proposal: p1.output,
      source: "model",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "target_lr",
      learningRates: [0.001, 0.01],
    });
    check(S1, "question" in c1, `确认失败: ${JSON.stringify(c1)}`);
  }
  const pv1 = await wf.previewImport(ACTOR, { projectId: "p_v1", text: csv(R01, R02), source: "demo" });
  await wf.commitImport(ACTOR, { projectId: "p_v1", runs: [...pv1.added, ...pv1.incomplete] });
  const a1 = await wf.analyze(ACTOR, { requestId: "req-1a", questionId: "q_a" });
  check(S1, !a1.gated, "被闸门拦截");
  if (!a1.gated) {
    console.log(`[${S1}] 矩阵(项目): ${matrixFromRuns(await runsOf("p_v1"))}`);
    console.log(
      `[${S1}] 观测=${a1.evidence.observation?.deltaPp} (配置差=${a1.evidence.observation?.configDiff.map((d) => d.field).join("+")}) ` +
        `增强贡献(目标0.01)=${a1.evidence.augmentationContributionPp ?? "未知"} ` +
        `待补格=${a1.evidence.cells.filter((c) => c.status !== "measured").length} ` +
        `补跑单=${a1.evidence.suggestions.length} 引用runId=[${runIdsOf(a1)}]`,
    );
    check(S1, a1.evidence.observation?.deltaPp === "+2.00", "观测差不是 +2.00");
    check(S1, a1.evidence.augmentationContributionPp === null, "贡献应为未知(null)");
    check(S1, a1.evidence.cells.length === 2, "target_lr 应只查两格");
    check(S1, a1.evidence.cells.filter((c) => c.status !== "measured").length === 1, "应仅一格待补");
    check(S1, a1.evidence.suggestions.length === 1, "应只有一张补跑单");
    check(S1, a1.status === "waiting_for_run", "状态应为 waiting_for_run");
    check(S1, a1.modelOutput === "ready" && a1.analysis !== null, "模型分析未就绪");
    check(S1, a1.evidence.cells.some((c) => c.runId === "R02" && c.status === "measured"), "R02 未入格");
  }
  finish(S1, "初始 R01/R02 对角线测量、观测 +2.00、贡献未知、仅一格待补");

  // ---------- ② 追加 R03 ----------
  const S2 = "②";
  const pv2 = await wf.previewImport(ACTOR, { projectId: "p_v1", text: csv(R03), source: "demo" });
  const b1 = await wf.appendRunsAndReanalyze(ACTOR, {
    requestId: "req-1b",
    questionId: "q_a",
    runs: [...pv2.added, ...pv2.incomplete],
  });
  check(S2, !b1.gated, "被闸门拦截");
  if (!b1.gated && !a1.gated) {
    const v1 = await wf.getRevision(ACTOR, "q_a", a1.revisionId);
    const v2 = await wf.getRevision(ACTOR, "q_a", b1.revisionId);
    const versions = await wf.listRevisions(ACTOR, "q_a");
    const sameClaim =
      JSON.stringify(v1?.inputSnapshot.claim) === JSON.stringify(v2?.inputSnapshot.claim);
    console.log(
      `[${S2}] 上下文不变=${sameClaim} ` +
        `V1可重读=${v1?.inputSnapshot.runs.length === 2 && v1.conclusions.some((c) => c.result === "insufficient_data")} ` +
        `V2目标效应=${b1.evidence.pairs[0]?.deltaPp ?? "无"} 贡献=${b1.evidence.augmentationContributionPp ?? "未知"} ` +
        `补跑建议=${b1.evidence.suggestions.length} 版本数=${versions.length}`,
    );
    check(S2, v1?.inputSnapshot.runs.length === 2, "V1 快照被改写");
    check(S2, v1?.parentId === null, "V1 父版本应为 null");
    check(S2, sameClaim, "V2 主张上下文变化");
    check(S2, versions.length === 2, `版本数应为 2，实际 ${versions.length}`);
    check(S2, b1.evidence.pairs.length === 1 && b1.evidence.pairs[0]?.deltaPp === "+0.20", "V2 目标效应应为 +0.20");
    check(S2, b1.evidence.augmentationContributionPp === "+0.20", "贡献应为 +0.20");
    check(S2, b1.evidence.suggestions.length === 0, "不应重复建议这组实验");
    check(S2, b1.evidence.pairs[0]?.treatedRunId === "R02" && b1.evidence.pairs[0]?.controlRunId === "R03", "配对运行不对");
    check(S2, !b1.duplicate, "不应是重复请求");
  }
  finish(S2, "追加 R03 → V2 目标效应 +0.20、V1 可重读、无需重复建议");

  // ---------- ③ 两档均有效 ----------
  const S3 = "③";
  await wf.createProject(ACTOR, "验收 · 两档", "p_v2");
  await wf.createQuestion(ACTOR, { projectId: "p_v2", questionId: "q_b", rawClaim: SENTENCE_BOTH });
  const p3 = await wf.parseClaim("req-parse-b", SENTENCE_BOTH);
  check(S3, p3.ok, "两档句解析失败");
  if (p3.ok) {
    const c3 = await wf.confirmScope(ACTOR, {
      questionId: "q_b",
      proposal: p3.output,
      source: "model",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "both_lrs",
      learningRates: [0.001, 0.01],
    });
    check(S3, "question" in c3, `两档确认失败: ${JSON.stringify(c3)}`);
  }
  const seedBoth = async (rows: string[]) => {
    const pv = await wf.previewImport(ACTOR, { projectId: "p_v2", text: csv(...rows), source: "demo" });
    const runs = [...pv.added, ...pv.incomplete];
    if (runs.length > 0) await wf.commitImport(ACTOR, { projectId: "p_v2", runs });
  };
  await seedBoth([R01, R02]);
  const s3a = await wf.analyze(ACTOR, { requestId: "req-3a", questionId: "q_b" });
  await seedBoth([R03]);
  const s3b = await wf.analyze(ACTOR, { requestId: "req-3b", questionId: "q_b" });
  await seedBoth([R04]);
  const s3c = await wf.analyze(ACTOR, { requestId: "req-3c", questionId: "q_b" });
  const pending = (r: typeof s3a) => (r.gated ? -1 : r.evidence.cells.filter((c) => c.status !== "measured").length);
  console.log(
    `[${S3}] 待补格: 初始=${pending(s3a)} +R03=${pending(s3b)} +R04=${pending(s3c)}` +
      (s3c.gated ? "" : ` | 两档差值: 0.001=${s3c.evidence.pairs.find((p) => p.lr === 0.001)?.deltaPp ?? "?"}, 0.01=${s3c.evidence.pairs.find((p) => p.lr === 0.01)?.deltaPp ?? "?"}`),
  );
  check(S3, pending(s3a) === 2, "初始应待补两格");
  check(S3, pending(s3b) === 1, "+R03 应待补一格");
  check(S3, pending(s3c) === 0, "+R04 应待补零格");
  if (!s3c.gated) {
    check(S3, s3c.evidence.pairs.find((p) => p.lr === 0.001)?.deltaPp === "+0.50", "0.001 档应为 +0.50");
    check(S3, s3c.evidence.pairs.find((p) => p.lr === 0.01)?.deltaPp === "+0.20", "0.01 档应为 +0.20");
    check(S3, s3c.status === "reviewable", "补齐后应为 reviewable");
    check(S3, new Set(s3c.evidence.cells.map((c) => c.lr)).size === 2, "应覆盖两档");
  }
  finish(S3, "两档均有效：待补 2→1→0，差值 +0.50 / +0.20");

  // ---------- ④ 配对排除 ----------
  const S4 = "④";
  await wf.createProject(ACTOR, "验收 · 排除", "p_v3");
  await wf.createQuestion(ACTOR, { projectId: "p_v3", questionId: "q_c", rawClaim: SENTENCE });
  const p4 = await wf.parseClaim("req-parse-c", SENTENCE);
  check(S4, p4.ok, "解析失败");
  if (p4.ok) {
    const c4 = await wf.confirmScope(ACTOR, {
      questionId: "q_c",
      proposal: p4.output,
      source: "model",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "target_lr",
      learningRates: [0.001, 0.01],
    });
    check(S4, "question" in c4, "确认失败");
  }
  const pv4 = await wf.previewImport(ACTOR, {
    projectId: "p_v3",
    text: csv(R01, R02, R03_SEED8, R05_SPLIT),
    source: "demo",
  });
  await wf.commitImport(ACTOR, { projectId: "p_v3", runs: [...pv4.added, ...pv4.incomplete] });
  const s4a = await wf.analyze(ACTOR, { requestId: "req-4a", questionId: "q_c" });
  check(S4, !s4a.gated, "被闸门拦截");
  if (!s4a.gated) {
    console.log(
      `[${S4}] 换种子/换评测集: 配对=${s4a.evidence.pairs.length} 待补=${s4a.evidence.cells.filter((c) => c.status !== "measured").length} 补跑单=${s4a.evidence.suggestions.length}`,
    );
    check(S4, s4a.evidence.pairs.length === 0, "seed=8 或 S1:v2 不得配对");
    check(S4, s4a.evidence.suggestions.length === 1, "仍应提示补正确对照");
  }
  // 候选对照放在另一个项目：不得串入
  await wf.createProject(ACTOR, "验收 · 隔离源", "p_v4");
  const pvOk = await wf.previewImport(ACTOR, { projectId: "p_v4", text: csv(R03), source: "demo" });
  await wf.commitImport(ACTOR, { projectId: "p_v4", runs: [...pvOk.added, ...pvOk.incomplete] });
  const s4b = await wf.analyze(ACTOR, { requestId: "req-4b", questionId: "q_c" });
  check(S4, !s4b.gated, "二次分析被拦截");
  if (!s4b.gated) {
    console.log(`[${S4}] 跨项目候选(p_v4 有正确 R03): p_v3 配对=${s4b.evidence.pairs.length}（应为 0）`);
    check(S4, s4b.evidence.pairs.length === 0, "跨项目候选串入了配对");
    check(S4, s4b.evidence.cells.every((c) => c.runId !== "R03"), "跨项目 R03 不得入格");
  }
  finish(S4, "换种子/评测集不配对，跨项目候选不串入");

  // ---------- ⑤ 模型伪造 ----------
  const S5 = "⑤";
  await wf.createProject(ACTOR, "验收 · 伪造", "p_v5");
  await wf.createQuestion(ACTOR, { projectId: "p_v5", questionId: "q_d", rawClaim: SENTENCE });
  const p5 = await wf.parseClaim("req-parse-d", SENTENCE);
  check(S5, p5.ok, "解析失败");
  if (p5.ok) {
    const c5 = await wf.confirmScope(ACTOR, {
      questionId: "q_d",
      proposal: p5.output,
      source: "model",
      targetRunId: "R02",
      baselineRunId: "R01",
      scope: "target_lr",
      learningRates: [0.001, 0.01],
    });
    check(S5, "question" in c5, "确认失败");
  }
  const pv5 = await wf.previewImport(ACTOR, { projectId: "p_v5", text: csv(R01, R02), source: "demo" });
  await wf.commitImport(ACTOR, { projectId: "p_v5", runs: [...pv5.added, ...pv5.incomplete] });

  adapter.fabricate = true;
  const s5a = await wf.analyze(ACTOR, { requestId: "req-5a", questionId: "q_d" });
  check(S5, !s5a.gated, "被闸门拦截");
  if (!s5a.gated) {
    const ruleCount = conclusionsFromPackage(s5a.evidence).length;
    console.log(
      `[${S5}] 伪造(R99/81.5/缺格测量): modelOutput=${s5a.modelOutput} job=${s5a.job.status} 规则结论=${ruleCount} ` +
        `摘要="${s5a.events.find((e) => e.node === "model" && e.status === "failed")?.summary ?? ""}"`,
    );
    check(S5, s5a.modelOutput === "failed", "伪造输出应标为 failed");
    check(S5, s5a.job.status === "failed", "作业应 failed");
    check(S5, ruleCount > 0, "规则报告应保留");
    check(S5, s5a.analysis === null, "不得保存伪造分析");
  }
  adapter.fabricate = false;
  const s5b = await wf.analyze(ACTOR, { requestId: "req-5b", questionId: "q_d" });
  check(S5, !s5b.gated, "重试被拦截");
  if (!s5b.gated && !s5a.gated) {
    const v1d = await wf.getRevision(ACTOR, "q_d", s5a.revisionId);
    const v2d = await wf.getRevision(ACTOR, "q_d", s5b.revisionId);
    const sameEvidence =
      JSON.stringify(v1d?.inputSnapshot.runs.map((r) => r.runId)) ===
      JSON.stringify(v2d?.inputSnapshot.runs.map((r) => r.runId));
    console.log(
      `[${S5}] 重试: reusedSnapshot=${s5b.reusedSnapshot} modelOutput=${s5b.modelOutput} 连回原版证据=${sameEvidence} 版本数=${(await wf.listRevisions(ACTOR, "q_d")).length}`,
    );
    check(S5, s5b.reusedSnapshot, "重试应沿用原证据");
    check(S5, s5b.modelOutput === "ready" && s5b.analysis !== null, "重试应成功");
    check(S5, sameEvidence, "重试未连回原版证据");
    check(S5, v1d?.modelOutput === "failed", "失败版本应保留");
  }
  finish(S5, "伪造被拒、规则保留、重试成功并连回原版证据");

  // ---------- ⑥ 断线重进 / 重复提交 / 失败重试 / 计数 ----------
  const S6 = "⑥";
  const projects = await wfReentry.listProjects(ACTOR);
  const { job: job1a, events: events1a } = await wfReentry.getJob(ACTOR, "req-1a");
  const versionsQa = await wfReentry.listRevisions(ACTOR, "q_a");
  console.log(
    `[${S6}] 重进后: 项目=${projects.length} q_a版本=${versionsQa.length} req-1a作业=${job1a.status} 事件=${events1a.length}`,
  );
  check(S6, projects.length === 5, `项目数应为 5，实际 ${projects.length}`);
  check(S6, versionsQa.length === 2, "重进后 q_a 版本数应为 2");
  check(S6, job1a.status === "succeeded" && job1a.revisionId !== null, "作业结果可找回");
  check(S6, events1a.length >= 6, "事件可找回");

  const dup = await wfReentry.analyze(ACTOR, { requestId: "req-1a", questionId: "q_a" });
  check(S6, !dup.gated && dup.duplicate, "重复提交应幂等返回");
  const versionsAfterDup = (await wfReentry.listRevisions(ACTOR, "q_a")).length;
  check(S6, versionsAfterDup === 2, "重复提交不得增加版本");

  let staleBlocked = false;
  try {
    await wf.analyze(ACTOR, { requestId: "req-1c", questionId: "q_a", expectedParentId: null });
  } catch (error) {
    staleBlocked = error instanceof Error && error.message.includes("过期父版本");
  }
  check(S6, staleBlocked, "旧父版本提交未被拦截");
  const afterStale = await wf.listRevisions(ACTOR, "q_a");
  check(S6, afterStale.length === 2, "冲突不得产生版本");
  const retried = await wf.analyze(ACTOR, { requestId: "req-1c", questionId: "q_a" });
  check(S6, !retried.gated && !retried.duplicate, "刷新重试应成功");
  const finalQa = await wf.listRevisions(ACTOR, "q_a");
  console.log(
    `[${S6}] 重复提交后版本=${versionsAfterDup} 冲突拦截=${staleBlocked} 刷新重试后版本=${finalQa.length} 模型调用=${adapter.analyzeCalls}`,
  );
  check(S6, finalQa.length === 3, `重试后版本数应为 3，实际 ${finalQa.length}`);
  finish(S6, "断线重进/重复提交/失败重试计数正确（正式适配器见 harness 浏览器段）");

  // ---------- ⑦ 真实最终分析 ----------
  console.log(
    "[⑦] 未测 真实最终分析需用户在本机模型服务中配置 API Key 与模型；" +
      "本次验收只使用离线 mock，不联网、不记录真实密钥。",
  );

  // ---------- 汇总 ----------
  console.log("---- 汇总 ----");
  console.log(`项目数=${projects.length} 问题数=4 q_a版本=${finalQa.length} 模型调用=${adapter.analyzeCalls} 解析调用=${adapter.parseCalls}`);
  if (failures.size > 0) {
    for (const [scenario, list] of failures) console.error(`FAIL ${scenario}: ${list.join("；")}`);
    process.exit(1);
  }
  console.log("verify:flow 全部场景通过（⑦ 未测单列）。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

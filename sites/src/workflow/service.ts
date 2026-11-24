/**
 * 端到端应用服务：把 02–06 接成同一条工作流（卡 07，无 Web UI）。
 *
 * 流程：解析/人工确认范围 → 取数据快照 → 查找对照 → 规则报告与矩阵
 * （数据永远来自卡 04）→ 请求模型解释 → 校验引用并关联格子 → 存档。
 *
 * 闸门与成本：
 * - 未确认范围 → needs_input，不启动模型调用；
 * - 显式携带过期父版本 → stale_parent 冲突，发生在模型调用之前；
 * - 同一 requestId 重复请求 → 幂等重建结果，不再打模型；
 * - 配置缺项（needs_input 证据）→ 只问缺项，不调用模型；
 * - 无模型服务 → 规则报告照常存档，modelOutput=unavailable（AI 区未完成）。
 *
 * 权限：所有动作以 actor（服务端验证身份）走存储分区；任意 projectId
 * 读取他人记录得到 NotFound，不靠前端筛选。
 *
 * HTTP 路由只是这些动作的可选映射；本卡不另起服务凑端点。
 */

import type {
  Actor,
  DataService,
  JobEvent,
  StoredAnalysis,
} from "../experiment/storage.ts";
import { ConflictError, NotFoundError, StorageError } from "../experiment/storage.ts";
import { previewImport, type FieldName, type ImportPreview } from "../experiment/import.ts";
import {
  buildEvidencePackage,
  conclusionsFromPackage,
  type EvidencePackage,
} from "../experiment/evidence.ts";
import type {
  AnalysisJobStatus,
  AnalysisRevision,
  ClaimScope,
  ModelOutputStatus,
  Question,
  QuestionStatus,
  TrainingRun,
} from "../experiment/types.ts";
import type { ParseModelOutput } from "../agent/adapter.ts";
import { confirmProposal, type AgentService } from "../agent/service.ts";
import { buildFactRegistry, type FactRegistry } from "../agent/facts.ts";
import { PARSE_PROMPT_VERSION } from "../agent/prompts.ts";

export interface WorkflowDeps {
  storage: DataService;
  /** null = 本环境无模型服务（E 场景）。 */
  agent: AgentService | null;
  now(): string;
}

// ---------- 动作结果类型 ----------

export interface ConfirmScopeNeedsInput {
  status: "needs_input";
  questionId: string;
  missing: string[];
  detail: string;
  clarifyingQuestion: string;
}

export interface ConfirmScopeDone {
  status: QuestionStatus;
  question: Question;
  source: "model" | "manual";
}

export type ConfirmScopeResult = ConfirmScopeNeedsInput | ConfirmScopeDone;

export interface AnalyzeGated {
  gated: true;
  status: "needs_input";
  questionId: string;
  reason: string;
  modelCalled: false;
}

export interface AnalyzeDone {
  gated: false;
  questionId: string;
  revisionId: string;
  /** 本次证据导出的状态（waiting_for_run / reviewable / needs_input）。 */
  status: QuestionStatus;
  /** 规则报告 + 矩阵（卡 04 输出，只读）。 */
  evidence: EvidencePackage;
  modelOutput: ModelOutputStatus;
  job: { jobId: string; status: AnalysisJobStatus };
  analysis: StoredAnalysis | null;
  events: JobEvent[];
  duplicate: boolean;
  reusedSnapshot: boolean;
}

export type AnalyzeOutcome = AnalyzeGated | AnalyzeDone;

export interface PreviewInput {
  projectId: string;
  text: string;
  source?: "demo" | "real";
  importedAt?: string;
  accuracyUnit?: "percent" | "ratio";
  overrides?: Record<string, FieldName | "ignored">;
  unknownRoles?: Record<string, "config" | "metadata" | "ignored">;
}

export interface ConfirmScopeInput {
  questionId: string;
  /** parseClaim 的产物，或模型不可用时人工填写的同形结构。 */
  proposal: ParseModelOutput;
  source: "model" | "manual";
  targetRunId?: string;
  baselineRunId?: string;
  scope?: "target_lr" | "both_lrs";
  learningRates?: number[];
}

export interface AppendInput {
  requestId: string;
  questionId: string;
  runs: TrainingRun[];
}

const ANALYSIS_SECTIONS = ["observation", "interpretation", "nextAction", "revisedClaim"] as const;

function resolveCitation(
  evidenceId: string,
  registry: FactRegistry,
  pkg: EvidencePackage,
): { evidenceId: string; cellId: string | null; runIds: string[] } {
  const fact = registry.facts.find((f) => f.factId === evidenceId);
  if (!fact) return { evidenceId, cellId: null, runIds: [] };
  if (fact.cellId) return { evidenceId, cellId: fact.cellId, runIds: fact.runIds ?? [] };
  if (fact.kind === "pair") {
    const pair = pkg.pairs.find((p) => p.pairId === evidenceId);
    if (pair) {
      return { evidenceId, cellId: pair.treatedCellId, runIds: [pair.treatedRunId, pair.controlRunId] };
    }
  }
  return { evidenceId, cellId: null, runIds: fact.runIds ?? [] };
}

function evidenceRefsFrom(pkg: EvidencePackage): Array<{ runId: string; projectId: string }> {
  const ids = new Set<string>();
  for (const cell of pkg.cells) if (cell.status === "measured" && cell.runId) ids.add(cell.runId);
  for (const pair of pkg.pairs) {
    ids.add(pair.treatedRunId);
    ids.add(pair.controlRunId);
  }
  return [...ids].sort().map((runId) => ({ runId, projectId: pkg.projectId }));
}

export function createWorkflowService(deps: WorkflowDeps) {
  const { storage } = deps;

  async function reconstruct(actor: Actor, jobId: string, job: { questionId: string; revisionId: string | null; status: AnalysisJobStatus }): Promise<AnalyzeDone> {
    if (!job.revisionId) {
      throw new StorageError("incomplete_job", `作业 ${jobId} 未产出版本，请用新的 requestId 重试`);
    }
    const question = await storage.getQuestion(actor, job.questionId);
    if (!question) throw new NotFoundError(`问题不存在: ${job.questionId}`);
    const revision = await storage.getRevision(actor, job.questionId, job.revisionId);
    if (!revision) throw new NotFoundError(`版本不存在: ${job.revisionId}`);
    const evidence = buildEvidencePackage(revision.inputSnapshot.claim, revision.inputSnapshot.runs, {
      projectId: question.projectId,
      questionId: question.questionId,
    });
    const [analysis, events] = await Promise.all([
      storage.getAnalysis(actor, revision.revisionId),
      storage.getJobEvents(actor, jobId),
    ]);
    return {
      gated: false,
      questionId: question.questionId,
      revisionId: revision.revisionId,
      status: evidence.status,
      evidence,
      modelOutput: revision.modelOutput,
      job: { jobId, status: job.status },
      analysis,
      events,
      duplicate: true,
      reusedSnapshot: false,
    };
  }

  async function runAnalysis(
    actor: Actor,
    opts: { requestId: string; questionId: string; expectedParentId?: string | null; freshSnapshot?: boolean },
  ): Promise<AnalyzeOutcome> {
    // 0) 幂等：同一 requestId 已有作业 → 重建结果，不再打模型
    const existingJob = await storage.getJob(actor, opts.requestId);
    if (existingJob) return reconstruct(actor, opts.requestId, existingJob);

    // 1) 范围闸门：未确认范围 → needs_input，不产生任何模型成本
    const question = await storage.getQuestion(actor, opts.questionId);
    if (!question) throw new NotFoundError(`问题不存在: ${opts.questionId}`);
    if (!question.confirmedClaim) {
      return {
        gated: true,
        status: "needs_input",
        questionId: question.questionId,
        reason: "范围未确认，停在 needs_input，不启动模型调用",
        modelCalled: false,
      };
    }
    const claim = question.confirmedClaim;

    // 2) 过期父版本检查（两个浏览器场景）：发生在模型调用之前
    const currentParent = question.currentRevisionId;
    if (opts.expectedParentId !== undefined && opts.expectedParentId !== currentParent) {
      throw new ConflictError(
        "stale_parent",
        `基于过期父版本提交（客户端 ${String(opts.expectedParentId)}，当前 ${String(currentParent)}），请刷新后重试`,
      );
    }

    // 3) 快照：仅「模型失败/不可用后的再次分析」沿用原证据；append 动作强制新快照
    let snapshotRuns: TrainingRun[];
    let reusedSnapshot = false;
    const latest = currentParent
      ? await storage.getRevision(actor, question.questionId, currentParent)
      : null;
    if (
      !opts.freshSnapshot &&
      latest &&
      (latest.modelOutput === "failed" || latest.modelOutput === "unavailable")
    ) {
      snapshotRuns = latest.inputSnapshot.runs;
      reusedSnapshot = true;
    } else {
      snapshotRuns = await storage.listRuns(actor, question.projectId);
    }

    // 4) 作业与节点事件
    const jobId = opts.requestId;
    let seq = 0;
    const emit = (
      node: JobEvent["node"],
      status: JobEvent["status"],
      summary: string,
      revisionId: string | null = null,
    ) =>
      storage.appendJobEvent(actor, {
        eventId: `${jobId}#${seq++}`,
        jobId,
        revisionId,
        node,
        status,
        at: deps.now(),
        summary,
      });

    await storage.putJob(actor, { jobId, questionId: question.questionId, revisionId: null, status: "queued" });
    await emit("snapshot", "started", reusedSnapshot ? "沿用上次失败分析的原始快照" : "读取项目内训练记录快照");
    const evidence = buildEvidencePackage(claim, snapshotRuns, {
      projectId: question.projectId,
      questionId: question.questionId,
    });
    await emit("snapshot", "completed", `快照 ${snapshotRuns.length} 条运行`);
    await emit(
      "rules",
      "started",
      `按规则版本计算矩阵与结论（状态 ${evidence.status}）`,
    );
    await emit(
      "rules",
      "completed",
      `格子 ${evidence.cells.length}、配对 ${evidence.pairs.length}、补跑建议 ${evidence.suggestions.length}`,
    );

    // 5) 模型节点
    await storage.putJob(actor, { jobId, questionId: question.questionId, revisionId: null, status: "running" });
    let modelOutput: ModelOutputStatus;
    let pendingAnalysis: Omit<StoredAnalysis, "revisionId"> | null = null;

    if (!deps.agent) {
      modelOutput = "unavailable";
      await emit("model", "failed", "模型服务不可用（未配置），AI 分析未完成，规则报告照常存档");
    } else if (evidence.status === "needs_input") {
      modelOutput = "pending";
      await emit("model", "failed", "存在配置缺项，未调用模型；只向用户询问缺项");
    } else {
      await emit("model", "started", "调用模型生成四段分析并校验引用");
      const modelResult = await deps.agent.analyze(jobId, {
        question: {
          questionId: question.questionId,
          rawClaim: question.rawClaim,
          confirmedClaim: claim,
        },
        evidence,
        jobId,
      });
      if (modelResult.ok) {
        modelOutput = "ready";
        const registry = buildFactRegistry(evidence, claim);
        const cited = new Set<string>();
        for (const section of ANALYSIS_SECTIONS) {
          for (const id of modelResult.output[section].evidenceIds) cited.add(id);
        }
        pendingAnalysis = {
          questionId: question.questionId,
          output: modelResult.output,
          citations: [...cited].map((id) => resolveCitation(id, registry, evidence)),
          promptVersion: modelResult.log.promptVersion,
          provider: modelResult.log.provider,
          model: modelResult.log.model,
          createdAt: deps.now(),
        };
        await emit(
          "model",
          "completed",
          `provider=${modelResult.log.provider}，引用校验通过（${cited.size} 条）`,
        );
      } else {
        modelOutput = "failed";
        await emit("model", "failed", `模型分析失败（${modelResult.error.code}），保留独立规则报告`);
      }
    }

    // 6) 存档：事务内复查父版本，迟到的旧版本在此被拒，不会覆盖新结果
    const revision: AnalysisRevision = {
      revisionId: `rev_${crypto.randomUUID()}`,
      questionId: question.questionId,
      parentId: currentParent,
      createdAt: deps.now(),
      inputSnapshot: { claim, runs: snapshotRuns },
      conclusions: conclusionsFromPackage(evidence),
      evidenceRefs: evidenceRefsFrom(evidence),
      suggestions: evidence.suggestions.map((s) => s.text),
      modelOutput,
    };
    await emit("archive", "started", "写入分析版本");
    const created = await storage.createRevision(actor, {
      revision,
      idempotencyKey: jobId,
      expectedParentId: currentParent,
      now: deps.now(),
    });
    if (!created.created) {
      // 存储层幂等命中（并发同键）：按重复请求返回，不产生第二个版本
      const job = await storage.getJob(actor, jobId);
      if (job) return reconstruct(actor, jobId, { ...job, revisionId: created.revision.revisionId });
    }
    const revisionId = created.revision.revisionId;

    if (pendingAnalysis) {
      await storage.putAnalysis(actor, { ...pendingAnalysis, revisionId });
    }
    const jobStatus: AnalysisJobStatus = modelOutput === "ready" ? "succeeded" : "failed";
    await storage.putJob(actor, {
      jobId,
      questionId: question.questionId,
      revisionId,
      status: jobStatus,
    });
    const updated = await storage.getQuestion(actor, question.questionId);
    await emit(
      "archive",
      "completed",
      `版本 ${revisionId} 已存档，问题状态 ${updated?.status ?? evidence.status}`,
      revisionId,
    );

    const [events, analysis] = await Promise.all([
      storage.getJobEvents(actor, jobId),
      storage.getAnalysis(actor, revisionId),
    ]);
    return {
      gated: false,
      questionId: question.questionId,
      revisionId,
      status: evidence.status,
      evidence,
      modelOutput,
      job: { jobId, status: jobStatus },
      analysis,
      events,
      duplicate: false,
      reusedSnapshot,
    };
  }

  return {
    // ---- 项目 ----
    listProjects(actor: Actor) {
      return storage.listProjects(actor);
    },
    createProject(actor: Actor, name: string, projectId?: string) {
      return storage.createProject(actor, name, deps.now(), projectId);
    },

    // ---- 问题与范围 ----
    createQuestion(actor: Actor, input: { projectId: string; questionId?: string; rawClaim: string }) {
      return storage.createQuestion(actor, {
        questionId: input.questionId ?? crypto.randomUUID(),
        projectId: input.projectId,
        rawClaim: input.rawClaim,
        confirmedClaim: null,
        now: deps.now(),
      });
    },

    /** 调用一：解析原句。模型不可用时返回 model_unavailable，走人工填写。 */
    async parseClaim(requestId: string, rawClaim: string) {
      if (!deps.agent) {
        return {
          ok: false as const,
          error: { code: "model_unavailable", message: "模型服务未配置，请人工填写后确认" },
          log: {
            requestId,
            kind: "parse" as const,
            promptVersion: PARSE_PROMPT_VERSION,
            provider: "未提供",
            model: "未提供",
            result: "model_unavailable",
            attempts: 0,
          },
        };
      }
      return deps.agent.parseProposal(requestId, rawClaim);
    },

    /** 确认范围：缺字段时只回缺项（needs_input），不落库不调模型。 */
    async confirmScope(actor: Actor, input: ConfirmScopeInput): Promise<ConfirmScopeResult> {
      const question = await storage.getQuestion(actor, input.questionId);
      if (!question) throw new NotFoundError(`问题不存在: ${input.questionId}`);
      if (question.confirmedClaim) {
        throw new ConflictError("already_confirmed", `主张已确认过: ${input.questionId}`);
      }

      const missing: string[] = [];
      if (!input.targetRunId) missing.push("targetRunId");
      if (!input.baselineRunId) missing.push("baselineRunId");
      if (!input.scope) missing.push("scope");
      if (!input.learningRates || input.learningRates.length !== 2) missing.push("learningRates");
      if (missing.length > 0) {
        return {
          status: "needs_input",
          questionId: question.questionId,
          missing,
          detail: `还缺：${missing.join("、")}`,
          clarifyingQuestion: input.proposal.clarifyingQuestion,
        };
      }

      const confirmed = confirmProposal(
        { source: input.source, output: input.proposal },
        {
          rawClaim: question.rawClaim,
          targetRunId: input.targetRunId!,
          baselineRunId: input.baselineRunId!,
          scope: input.scope!,
          learningRates: input.learningRates!,
        },
      );
      if (!confirmed.ok) {
        return {
          status: "needs_input",
          questionId: question.questionId,
          missing: ["clarification"],
          detail: confirmed.detail,
          clarifyingQuestion: input.proposal.clarifyingQuestion,
        };
      }
      const updated = await storage.confirmClaim(actor, question.questionId, confirmed.claim, deps.now());
      return { status: updated.status, question: updated, source: confirmed.source };
    },

    // ---- 导入 ----
    async previewImport(actor: Actor, input: PreviewInput): Promise<ImportPreview> {
      const project = await storage.getProject(actor, input.projectId);
      if (!project) throw new NotFoundError(`项目不存在: ${input.projectId}`);
      const existingRuns = await storage.listRuns(actor, input.projectId);
      return previewImport(input.text, {
        projectId: input.projectId,
        source: input.source ?? "real",
        importedAt: input.importedAt ?? deps.now(),
        accuracyUnit: input.accuracyUnit,
        overrides: input.overrides,
        unknownRoles: input.unknownRoles,
        existingRuns,
      });
    },

    commitImport(actor: Actor, input: { projectId: string; runs: TrainingRun[] }) {
      return storage.confirmImport(actor, {
        projectId: input.projectId,
        runs: input.runs,
        now: deps.now(),
      });
    },

    // ---- 分析 ----
    analyze(
      actor: Actor,
      opts: { requestId: string; questionId: string; expectedParentId?: string | null },
    ) {
      return runAnalysis(actor, opts);
    },

    /** 补入数据 → 新快照 → 下一版本（同 questionId）。 */
    async appendRunsAndReanalyze(actor: Actor, input: AppendInput): Promise<AnalyzeOutcome> {
      const question = await storage.getQuestion(actor, input.questionId);
      if (!question) throw new NotFoundError(`问题不存在: ${input.questionId}`);
      await storage.confirmImport(actor, {
        projectId: question.projectId,
        runs: input.runs,
        now: deps.now(),
      });
      return runAnalysis(actor, {
        requestId: input.requestId,
        questionId: input.questionId,
        freshSnapshot: true,
      });
    },

    // ---- 读取（刷新/断线重连恢复） ----
    async getJob(actor: Actor, jobId: string) {
      const job = await storage.getJob(actor, jobId);
      if (!job) throw new NotFoundError(`作业不存在: ${jobId}`);
      const events = await storage.getJobEvents(actor, jobId);
      return { job, events };
    },
    getRevision(actor: Actor, questionId: string, revisionId: string) {
      return storage.getRevision(actor, questionId, revisionId);
    },
    listRevisions(actor: Actor, questionId: string) {
      return storage.listRevisions(actor, questionId);
    },

    /** 问题下的作业（节点步骤状态来自其事件）。 */
    listJobs(actor: Actor, questionId: string) {
      return storage.listJobs(actor, questionId);
    },

    /**
     * 更改问题范围 → 同 questionId 下的新版本（卡 02 契约：范围变化产生新 revision）。
     * 先校验过期父版本再改主张，晚到的旧响应不会覆盖正在查看的版本。
     */
    async changeScope(
      actor: Actor,
      input: {
        questionId: string;
        scope: ClaimScope;
        learningRates?: number[];
        requestId: string;
        expectedParentId?: string | null;
      },
    ): Promise<AnalyzeOutcome> {
      const question = await storage.getQuestion(actor, input.questionId);
      if (!question) throw new NotFoundError(`问题不存在: ${input.questionId}`);
      if (!question.confirmedClaim) {
        throw new StorageError("needs_claim", "问题尚未明确，先回答澄清并确认范围");
      }
      if (
        input.expectedParentId !== undefined &&
        input.expectedParentId !== question.currentRevisionId
      ) {
        throw new ConflictError(
          "stale_parent",
          `基于过期父版本提交（客户端 ${String(input.expectedParentId)}，当前 ${String(question.currentRevisionId)}），请刷新后重试`,
        );
      }
      const claim = {
        ...question.confirmedClaim,
        scope: input.scope,
        learningRates: input.learningRates ?? question.confirmedClaim.learningRates,
      };
      await storage.updateClaim(actor, input.questionId, claim, deps.now());
      return runAnalysis(actor, {
        requestId: input.requestId,
        questionId: input.questionId,
        expectedParentId: input.expectedParentId,
        freshSnapshot: true,
      });
    },
  };
}

/** 请求样例（可运行版本见 tests/workflow.test.ts；HTTP 仅为可选映射，不另起服务）。 */
export interface RequestExample {
  action: keyof ReturnType<typeof createWorkflowService> | string;
  example: string;
}

export const REQUEST_EXAMPLES: RequestExample[] = [
  { action: "createProject", example: `wf.createProject(ALICE, "研论书屋 · 演示", "p_demo")` },
  { action: "createQuestion", example: `wf.createQuestion(ALICE, { projectId: "p_demo", rawClaim: "数据增强使准确率提高了 2 个百分点" })` },
  { action: "parseClaim", example: `wf.parseClaim("req-parse-1", rawClaim)` },
  { action: "confirmScope", example: `wf.confirmScope(ALICE, { questionId, proposal, source: "model", targetRunId: "R02", baselineRunId: "R01", scope: "both_lrs", learningRates: [0.001, 0.01] })` },
  { action: "previewImport", example: `wf.previewImport(ALICE, { projectId: "p_demo", text: "runId,model,...\\nR01,..." })` },
  { action: "commitImport", example: `wf.commitImport(ALICE, { projectId: "p_demo", runs: preview.added })` },
  { action: "analyze", example: `wf.analyze(ALICE, { requestId: "req-a1", questionId })` },
  { action: "appendRunsAndReanalyze", example: `wf.appendRunsAndReanalyze(ALICE, { requestId: "req-b1", questionId, runs: [R03] })` },
  { action: "getJob", example: `wf.getJob(ALICE, "req-a1")` },
  { action: "getRevision", example: `wf.getRevision(ALICE, questionId, revisionId)` },
  { action: "listRevisions", example: `wf.listRevisions(ALICE, questionId)` },
  { action: "listProjects", example: `wf.listProjects(ALICE)` },
];

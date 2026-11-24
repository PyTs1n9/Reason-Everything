/**
 * 数据服务：同一存储接口下的适配器与领域操作（不涉及页面）。
 *
 * 身份与结构沿用卡 02 契约（Project/Question/TrainingRun/AnalysisRevision 不加字段）。
 * 隔离在存储分区执行：每个访问者（verified actor）一个数据分区，云端适配器必须
 * 以服务端验证的身份分区，绝不能靠前端筛选，也不把访客数据放进匿名公共表。
 *
 * 一致性语义：
 * - transact 原子提交：回调抛错 → 状态不变（写入中断不出现半个版本）；
 * - 幂等请求键：同一键重复提交只建一个版本；
 * - expectedParentId 过期 → ConflictError('stale_parent')，刷新后可重试；
 * - 可变作业状态（jobs）与定稿证据快照（revisions.inputSnapshot）分库存放，
 *   模型重试只读原始快照。
 *
 * 适配器：
 * - MemoryBackend   离线测试（不作为刷新保存证明）
 * - IndexedDBBackend 浏览器静态环境，标注「本机保存」（storage-indexeddb.ts）
 * - 云适配器待 Function 路由与 backend 授权后接入（见 progress.md 能力记录）
 */

import type {
  AnalysisJob,
  AnalysisJobStatus,
  AnalysisRevision,
  ClaimSpec,
  Project,
  Question,
  QuestionStatus,
  TrainingRun,
} from "./types.ts";
import type { AnalysisModelOutput } from "../agent/adapter.ts";
import { validateRevision } from "./revision.ts";
import { buildEvidencePackage, type EvidencePackage } from "./evidence.ts";
import { runContentKey } from "./import.ts";

export interface Actor {
  /** 服务端验证的访问身份（云端取自 x-qoder-user-context 的 user_id）。 */
  userId: string;
}

export interface StoreState {
  projects: Project[];
  questions: Question[];
  runs: TrainingRun[];
  revisions: AnalysisRevision[];
  jobs: AnalysisJob[];
  /** `${questionId}:${requestKey}` → revisionId */
  idempotency: Record<string, string>;
  /** 模型分析产物（与定稿快照分开存；卡 07 新增）。 */
  analyses: StoredAnalysis[];
  /** 作业节点事件（卡 07 新增）。 */
  jobEvents: JobEvent[];
}

/** 模型四段分析与引用关联（模型产物，不属于不可变规则快照）。 */
export interface StoredAnalysis {
  revisionId: string;
  questionId: string;
  output: AnalysisModelOutput;
  /** 每条引用 → 关联格子/运行（前端按 evidenceId 高亮）。 */
  citations: Array<{ evidenceId: string; cellId: string | null; runIds: string[] }>;
  promptVersion: string;
  provider: string;
  model: string;
  createdAt: string;
}

/** 作业节点事件：jobId、revisionId、node、时间、可读摘要。 */
export interface JobEvent {
  eventId: string;
  jobId: string;
  revisionId: string | null;
  node: "snapshot" | "rules" | "model" | "archive";
  status: "started" | "completed" | "failed";
  at: string;
  summary: string;
}

export function defaultStoreState(): StoreState {
  return {
    projects: [],
    questions: [],
    runs: [],
    revisions: [],
    jobs: [],
    idempotency: {},
    analyses: [],
    jobEvents: [],
  };
}

export class StorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export class NotFoundError extends StorageError {
  constructor(message: string) {
    super("not_found", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends StorageError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ConflictError";
  }
}

/** 统一存储接口：分区隔离 + 原子读改写。 */
export interface StorageBackend {
  /** 对访问者分区做原子读改写；fn 抛错 → 状态保持不变。 */
  transact<T>(actor: Actor, fn: (draft: StoreState) => T): Promise<T>;
  /** 读取分区快照（克隆，外部修改不影响存储）。 */
  read(actor: Actor): Promise<StoreState>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 离线测试适配器：内存分区。不是刷新保存证明。 */
export class MemoryBackend implements StorageBackend {
  private partitions = new Map<string, StoreState>();

  async transact<T>(actor: Actor, fn: (draft: StoreState) => T): Promise<T> {
    const current = this.partitions.get(actor.userId);
    const draft = current ? clone(current) : defaultStoreState();
    const result = fn(draft);
    this.partitions.set(actor.userId, clone(draft));
    return result;
  }

  async read(actor: Actor): Promise<StoreState> {
    const state = this.partitions.get(actor.userId);
    return state ? clone(state) : defaultStoreState();
  }
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  questionCount: number;
  pendingCount: number;
  updatedAt: string;
}

export interface CreateRevisionInput {
  revision: AnalysisRevision;
  idempotencyKey: string;
  /** 提交时问题的当前版本；与存储不一致 → stale_parent 冲突。 */
  expectedParentId: string | null;
  now: string;
}

export interface DataService {
  createProject(actor: Actor, name: string, now: string, projectId?: string): Promise<Project>;
  ensureDemoProject(actor: Actor, now: string): Promise<{ project: Project; created: boolean }>;
  listProjects(actor: Actor): Promise<ProjectSummary[]>;
  getProject(actor: Actor, projectId: string): Promise<Project | null>;
  renameProject(actor: Actor, projectId: string, name: string, now: string): Promise<Project>;
  /** 删除项目并级联清除其问题/运行/版本/作业/分析/事件/幂等键（单事务原子；卡 16 纯新增）。 */
  deleteProject(actor: Actor, projectId: string): Promise<void>;

  createQuestion(
    actor: Actor,
    input: { questionId: string; projectId: string; rawClaim: string; confirmedClaim: Question["confirmedClaim"]; now: string },
  ): Promise<Question>;
  getQuestion(actor: Actor, questionId: string): Promise<Question | null>;
  /** 项目内问题列表（按创建顺序）。 */
  listQuestions(actor: Actor, projectId: string): Promise<Question[]>;
  listRevisions(actor: Actor, questionId: string): Promise<AnalysisRevision[]>;
  getRevision(actor: Actor, questionId: string, revisionId: string): Promise<AnalysisRevision | null>;

  confirmImport(
    actor: Actor,
    input: { projectId: string; runs: TrainingRun[]; now: string },
  ): Promise<TrainingRun[]>;
  listRuns(actor: Actor, projectId: string): Promise<TrainingRun[]>;
  getRun(actor: Actor, projectId: string, runId: string): Promise<TrainingRun | null>;

  createRevision(actor: Actor, input: CreateRevisionInput): Promise<{ revision: AnalysisRevision; created: boolean }>;
  verifyQuestion(actor: Actor, questionId: string): Promise<EvidencePackage>;

  putJob(actor: Actor, job: AnalysisJob): Promise<AnalysisJob>;
  updateJobStatus(actor: Actor, jobId: string, status: AnalysisJobStatus): Promise<AnalysisJob>;
  getJob(actor: Actor, jobId: string): Promise<AnalysisJob | null>;
  /** 模型重试只用定稿的原始快照（返回克隆）。 */
  getModelInput(actor: Actor, revisionId: string): Promise<AnalysisRevision["inputSnapshot"]>;

  /** 确认结构化主张（needs_input → 已确认；重复确认报冲突）。 */
  confirmClaim(actor: Actor, questionId: string, claim: ClaimSpec, now: string): Promise<Question>;
  putAnalysis(actor: Actor, analysis: StoredAnalysis): Promise<StoredAnalysis>;
  getAnalysis(actor: Actor, revisionId: string): Promise<StoredAnalysis | null>;
  appendJobEvent(actor: Actor, event: JobEvent): Promise<JobEvent>;
  getJobEvents(actor: Actor, jobId: string): Promise<JobEvent[]>;
  /** 某问题下的全部作业（按创建顺序）。 */
  listJobs(actor: Actor, questionId: string): Promise<AnalysisJob[]>;
  /** 更新已确认主张（如范围变化；先于新版本写入）。 */
  updateClaim(actor: Actor, questionId: string, claim: ClaimSpec, now: string): Promise<Question>;
}

export const DEMO_PROJECT_ID = "p_demo";

function requireProject(draft: StoreState, projectId: string): Project {
  const project = draft.projects.find((p) => p.projectId === projectId);
  if (!project) throw new NotFoundError(`项目不存在: ${projectId}`);
  return project;
}

function projectRuns(draft: StoreState, projectId: string): TrainingRun[] {
  return draft.runs.filter((r) => r.projectId === projectId);
}

function touch(project: Project, now: string): void {
  project.updatedAt = now;
}

function deriveQuestionStatus(draft: StoreState, question: Question): QuestionStatus {
  if (!question.confirmedClaim) return "needs_input";
  const pkg = buildEvidencePackage(question.confirmedClaim, projectRuns(draft, question.projectId), {
    projectId: question.projectId,
    questionId: question.questionId,
  });
  return pkg.status;
}

function orderedRevisions(draft: StoreState, question: Question): AnalysisRevision[] {
  const ofQuestion = draft.revisions.filter((r) => r.questionId === question.questionId);
  const byId = new Map(ofQuestion.map((r) => [r.revisionId, r]));
  const chain: AnalysisRevision[] = [];
  let cursor = question.currentRevisionId ? byId.get(question.currentRevisionId) : undefined;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  chain.reverse();
  const chained = new Set(chain.map((r) => r.revisionId));
  const rest = ofQuestion
    .filter((r) => !chained.has(r.revisionId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return [...chain, ...rest];
}

export function createDataService(backend: StorageBackend): DataService {
  return {
    async createProject(actor, name, now, projectId) {
      return backend.transact(actor, (draft) => {
        const id = projectId ?? crypto.randomUUID();
        if (draft.projects.some((p) => p.projectId === id)) {
          throw new ConflictError("duplicate_id", `项目 ID 已存在: ${id}`);
        }
        const project: Project = { projectId: id, name, updatedAt: now };
        draft.projects.push(project);
        return clone(project);
      });
    },

    async ensureDemoProject(actor, now) {
      return backend.transact(actor, (draft) => {
        const existing = draft.projects.find((p) => p.projectId === DEMO_PROJECT_ID);
        if (existing) return { project: clone(existing), created: false };
        const project: Project = { projectId: DEMO_PROJECT_ID, name: "演示项目 · 增强开关归因", updatedAt: now };
        draft.projects.push(project);
        return { project: clone(project), created: true };
      });
    },

    async listProjects(actor) {
      const state = await backend.read(actor);
      return state.projects
        .map((project) => {
          const questions = state.questions.filter((q) => q.projectId === project.projectId);
          return {
            projectId: project.projectId,
            name: project.name,
            questionCount: questions.length,
            pendingCount: questions.filter((q) => q.status === "waiting_for_run").length,
            updatedAt: project.updatedAt,
          };
        })
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.projectId < b.projectId ? -1 : 1));
    },

    async getProject(actor, projectId) {
      const state = await backend.read(actor);
      const project = state.projects.find((p) => p.projectId === projectId);
      return project ? clone(project) : null;
    },

    async renameProject(actor, projectId, name, now) {
      return backend.transact(actor, (draft) => {
        const project = requireProject(draft, projectId);
        project.name = name;
        touch(project, now);
        return clone(project);
      });
    },

    async deleteProject(actor, projectId) {
      return backend.transact(actor, (draft) => {
        requireProject(draft, projectId);
        const questionIds = new Set(
          draft.questions.filter((q) => q.projectId === projectId).map((q) => q.questionId),
        );
        const jobIds = new Set(
          draft.jobs.filter((j) => questionIds.has(j.questionId)).map((j) => j.jobId),
        );
        draft.projects = draft.projects.filter((p) => p.projectId !== projectId);
        draft.questions = draft.questions.filter((q) => !questionIds.has(q.questionId));
        draft.runs = draft.runs.filter((r) => r.projectId !== projectId);
        draft.revisions = draft.revisions.filter((r) => !questionIds.has(r.questionId));
        draft.jobs = draft.jobs.filter((j) => !questionIds.has(j.questionId));
        draft.analyses = draft.analyses.filter((a) => !questionIds.has(a.questionId));
        draft.jobEvents = draft.jobEvents.filter((e) => !jobIds.has(e.jobId));
        for (const key of Object.keys(draft.idempotency)) {
          for (const questionId of questionIds) {
            if (key.startsWith(`${questionId}:`)) {
              delete draft.idempotency[key];
              break;
            }
          }
        }
      });
    },

    async createQuestion(actor, input) {
      return backend.transact(actor, (draft) => {
        requireProject(draft, input.projectId);
        if (draft.questions.some((q) => q.questionId === input.questionId)) {
          throw new ConflictError("duplicate_id", `问题 ID 已存在: ${input.questionId}`);
        }
        const question: Question = {
          questionId: input.questionId,
          projectId: input.projectId,
          rawClaim: input.rawClaim,
          confirmedClaim: input.confirmedClaim,
          currentRevisionId: null,
          status: "needs_input",
        };
        question.status = deriveQuestionStatus(draft, question);
        draft.questions.push(question);
        const project = requireProject(draft, input.projectId);
        touch(project, input.now);
        return clone(question);
      });
    },

    async getQuestion(actor, questionId) {
      const state = await backend.read(actor);
      const question = state.questions.find((q) => q.questionId === questionId);
      return question ? clone(question) : null;
    },

    async listQuestions(actor, projectId) {
      const state = await backend.read(actor);
      requireProject(state, projectId);
      return clone(state.questions.filter((q) => q.projectId === projectId));
    },

    async listRevisions(actor, questionId) {
      const state = await backend.read(actor);
      const question = state.questions.find((q) => q.questionId === questionId);
      if (!question) throw new NotFoundError(`问题不存在: ${questionId}`);
      return clone(orderedRevisions(state, question));
    },

    async getRevision(actor, questionId, revisionId) {
      const state = await backend.read(actor);
      const revision = state.revisions.find(
        (r) => r.questionId === questionId && r.revisionId === revisionId,
      );
      return revision ? clone(revision) : null;
    },

    async confirmImport(actor, input) {
      return backend.transact(actor, (draft) => {
        const project = requireProject(draft, input.projectId);
        const added: TrainingRun[] = [];
        for (const incoming of input.runs) {
          if (incoming.projectId !== input.projectId) {
            throw new ConflictError("cross_project_run", `运行属于其他项目: ${incoming.runId}`);
          }
          const existing = draft.runs.find(
            (r) => r.projectId === input.projectId && r.runId === incoming.runId,
          );
          if (existing) {
            if (runContentKey(existing) !== runContentKey(incoming)) {
              throw new ConflictError(
                "run_conflict",
                `runId 已存在且内容不同，整批拒绝，不覆盖旧实验: ${incoming.runId}`,
              );
            }
            continue;
          }
          draft.runs.push(clone(incoming));
          added.push(clone(incoming));
        }
        touch(project, input.now);
        return added;
      });
    },

    async listRuns(actor, projectId) {
      const state = await backend.read(actor);
      requireProject(state, projectId);
      return clone(projectRuns(state, projectId));
    },

    async getRun(actor, projectId, runId) {
      const state = await backend.read(actor);
      const run = state.runs.find((r) => r.projectId === projectId && r.runId === runId);
      return run ? clone(run) : null;
    },

    async createRevision(actor, input) {
      const { revision, idempotencyKey, expectedParentId, now } = input;
      return backend.transact(actor, (draft) => {
        const key = `${revision.questionId}:${idempotencyKey}`;
        const existingId = draft.idempotency[key];
        if (existingId) {
          const existing = draft.revisions.find((r) => r.revisionId === existingId);
          if (existing) return { revision: clone(existing), created: false };
          delete draft.idempotency[key];
        }

        const question = draft.questions.find((q) => q.questionId === revision.questionId);
        if (!question) throw new NotFoundError(`问题不存在: ${revision.questionId}`);

        if (question.currentRevisionId !== expectedParentId) {
          throw new ConflictError(
            "stale_parent",
            `基于过期父版本提交（期望 ${String(expectedParentId)}，当前 ${String(question.currentRevisionId)}），请刷新后重试`,
          );
        }
        if (revision.parentId !== expectedParentId) {
          throw new ConflictError("parent_mismatch", "revision.parentId 与 expectedParentId 不一致");
        }

        const project = requireProject(draft, question.projectId);
        const errors = validateRevision(revision, {
          question,
          knownRunIds: projectRuns(draft, question.projectId).map((r) => r.runId),
          knownRevisionIds: draft.revisions
            .filter((r) => r.questionId === question.questionId)
            .map((r) => r.revisionId),
        });
        if (errors.length > 0) {
          throw new StorageError("invalid_revision", errors.join("；"));
        }
        if (draft.revisions.some((r) => r.revisionId === revision.revisionId)) {
          throw new ConflictError("duplicate_id", `版本 ID 已存在: ${revision.revisionId}`);
        }

        draft.revisions.push(clone(revision));
        draft.idempotency[key] = revision.revisionId;
        question.currentRevisionId = revision.revisionId;
        question.status = deriveQuestionStatus(draft, question);
        touch(project, now);
        return { revision: clone(revision), created: true };
      });
    },

    async verifyQuestion(actor, questionId) {
      const state = await backend.read(actor);
      const question = state.questions.find((q) => q.questionId === questionId);
      if (!question) throw new NotFoundError(`问题不存在: ${questionId}`);
      if (!question.confirmedClaim) {
        throw new StorageError("no_claim", "问题尚无已确认主张，无法核验");
      }
      return buildEvidencePackage(
        question.confirmedClaim,
        projectRuns(state, question.projectId),
        { projectId: question.projectId, questionId: question.questionId },
      );
    },

    async putJob(actor, job) {
      return backend.transact(actor, (draft) => {
        const index = draft.jobs.findIndex((j) => j.jobId === job.jobId);
        if (index >= 0) draft.jobs[index] = clone(job);
        else draft.jobs.push(clone(job));
        return clone(job);
      });
    },

    async updateJobStatus(actor, jobId, status) {
      return backend.transact(actor, (draft) => {
        const job = draft.jobs.find((j) => j.jobId === jobId);
        if (!job) throw new NotFoundError(`作业不存在: ${jobId}`);
        job.status = status;
        return clone(job);
      });
    },

    async getJob(actor, jobId) {
      const state = await backend.read(actor);
      const job = state.jobs.find((j) => j.jobId === jobId);
      return job ? clone(job) : null;
    },

    async getModelInput(actor, revisionId) {
      const state = await backend.read(actor);
      const revision = state.revisions.find((r) => r.revisionId === revisionId);
      if (!revision) throw new NotFoundError(`版本不存在: ${revisionId}`);
      return clone(revision.inputSnapshot);
    },

    async confirmClaim(actor, questionId, claim, now) {
      return backend.transact(actor, (draft) => {
        const question = draft.questions.find((q) => q.questionId === questionId);
        if (!question) throw new NotFoundError(`问题不存在: ${questionId}`);
        if (question.confirmedClaim) {
          throw new ConflictError("already_confirmed", `主张已确认过: ${questionId}`);
        }
        question.confirmedClaim = clone(claim);
        question.status = deriveQuestionStatus(draft, question);
        const project = requireProject(draft, question.projectId);
        touch(project, now);
        return clone(question);
      });
    },

    async putAnalysis(actor, analysis) {
      return backend.transact(actor, (draft) => {
        const index = draft.analyses.findIndex((a) => a.revisionId === analysis.revisionId);
        if (index >= 0) draft.analyses[index] = clone(analysis);
        else draft.analyses.push(clone(analysis));
        return clone(analysis);
      });
    },

    async getAnalysis(actor, revisionId) {
      const state = await backend.read(actor);
      const analysis = state.analyses.find((a) => a.revisionId === revisionId);
      return analysis ? clone(analysis) : null;
    },

    async appendJobEvent(actor, event) {
      return backend.transact(actor, (draft) => {
        if (!draft.jobEvents.some((e) => e.eventId === event.eventId)) {
          draft.jobEvents.push(clone(event));
        }
        return clone(event);
      });
    },

    async getJobEvents(actor, jobId) {
      const state = await backend.read(actor);
      return clone(state.jobEvents.filter((e) => e.jobId === jobId));
    },

    async listJobs(actor, questionId) {
      const state = await backend.read(actor);
      if (!state.questions.some((q) => q.questionId === questionId)) {
        throw new NotFoundError(`问题不存在: ${questionId}`);
      }
      return clone(state.jobs.filter((j) => j.questionId === questionId));
    },

    async updateClaim(actor, questionId, claim, now) {
      return backend.transact(actor, (draft) => {
        const question = draft.questions.find((q) => q.questionId === questionId);
        if (!question) throw new NotFoundError(`问题不存在: ${questionId}`);
        question.confirmedClaim = clone(claim);
        question.status = deriveQuestionStatus(draft, question);
        const project = requireProject(draft, question.projectId);
        touch(project, now);
        return clone(question);
      });
    },
  };
}

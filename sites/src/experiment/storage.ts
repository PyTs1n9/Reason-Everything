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
import {
  PAPER_EVIDENCE_KINDS,
  verifyPaperQuote,
  type PaperCandidate,
  type PaperEvidence,
  type PaperEvidenceKind,
  type PaperPageSource,
  type PaperRegion,
  type PaperSource,
  type PaperStudy,
} from "../web/paper-study.ts";

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
  /** 文献工作区附属记录，旧分区可能没有此键。 */
  paperStudies?: PaperStudy[];
  /** 原 PDF 字节按项目与文件指纹保存，供刷新后回查原版。 */
  paperFiles?: PaperFileBytes[];
  /** 问题与项目文献原文的关联，解除关联不删除文献。 */
  paperEvidence?: PaperEvidence[];
  /** 问题级研究记录，旧分区可能没有此键；不改变四种冻结业务身份。 */
  researchRecords?: ResearchRecordState;
}

export interface PaperFileBytes {
  projectId: string;
  filename: string;
  sha256: string;
  bytes: Uint8Array;
}

export type PaperFileInput = Omit<PaperFileBytes, "projectId">;

export type PaperOcrPageUpdate =
  | { page: number; ok: true; text: string; regions: PaperRegion[] }
  | { page: number; ok: false; error: string };

export type VerificationItemStatus = "pending" | "in_progress" | "recorded";
export type VerificationConclusion = "supported" | "not_supported" | "insufficient";

export interface ResearchSource {
  sourceId: string;
  title: string;
  filename: string;
  paperSha256: string;
  page: number;
  quote: string;
}

export interface ResearchNote {
  noteId: string;
  questionId: string;
  body: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VerificationItem {
  itemId: string;
  questionId: string;
  question: string;
  method: string;
  criteria: string;
  status: VerificationItemStatus;
  noteId: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VerificationResult {
  resultId: string;
  itemId: string;
  observation: string;
  basis: string;
  verifiedOn: string;
  conclusion: VerificationConclusion;
  createdAt: string;
}

export interface ResearchRecordState {
  notes: ResearchNote[];
  items: VerificationItem[];
  results: VerificationResult[];
}

export interface QuestionResearch {
  sources: ResearchSource[];
  notes: ResearchNote[];
  items: VerificationItem[];
  results: VerificationResult[];
}

export interface SaveResearchNoteInput {
  noteId?: string;
  questionId: string;
  body: string;
  sourceIds?: string[];
  now: string;
}

export interface SaveVerificationItemInput {
  itemId?: string;
  questionId: string;
  question: string;
  method: string;
  criteria: string;
  status?: VerificationItemStatus;
  noteId?: string | null;
  sourceIds?: string[];
  now: string;
}

export interface AppendVerificationResultInput {
  questionId: string;
  itemId: string;
  observation: string;
  basis: string;
  verifiedOn: string;
  conclusion: VerificationConclusion;
  now: string;
}

export interface AddPaperEvidenceInput {
  projectId: string;
  questionId: string;
  paperSha256: string;
  page: number;
  quote: string;
  kind: PaperEvidenceKind;
  note: string;
  now: string;
}

export interface UpdatePaperEvidenceInput {
  questionId: string;
  evidenceId: string;
  kind: PaperEvidenceKind;
  note: string;
  now: string;
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
    researchRecords: { notes: [], items: [], results: [] },
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
  importPaper(actor: Actor, input: { name: string; paper: PaperSource; now: string; projectId?: string; file?: PaperFileInput }): Promise<Project>;
  attachPaperFile(actor: Actor, projectId: string, file: PaperFileInput): Promise<PaperFileBytes>;
  getPaperFile(actor: Actor, projectId: string, sha256?: string): Promise<PaperFileBytes | null>;
  updatePaperPageOcr(actor: Actor, input: { projectId: string; sha256?: string; now: string; update: PaperOcrPageUpdate }): Promise<PaperStudy>;
  listPaperStudies(actor: Actor, projectId: string): Promise<PaperStudy[]>;
  getPaperStudy(actor: Actor, projectId: string, sha256?: string): Promise<PaperStudy | null>;
  savePaperCandidates(actor: Actor, projectId: string, generation: { model: string; candidates: PaperCandidate[] }, sha256?: string): Promise<PaperStudy>;
  acceptPaperCandidate(actor: Actor, input: { projectId: string; candidateId: string; question: string; now: string }): Promise<Question>;
  listPaperEvidence(actor: Actor, questionId: string): Promise<PaperEvidence[]>;
  addPaperEvidence(actor: Actor, input: AddPaperEvidenceInput): Promise<PaperEvidence>;
  updatePaperEvidence(actor: Actor, input: UpdatePaperEvidenceInput): Promise<PaperEvidence>;
  removePaperEvidence(actor: Actor, input: { questionId: string; evidenceId: string; now: string }): Promise<void>;

  getQuestionResearch(actor: Actor, questionId: string): Promise<QuestionResearch>;
  saveResearchNote(actor: Actor, input: SaveResearchNoteInput): Promise<ResearchNote>;
  saveVerificationItem(actor: Actor, input: SaveVerificationItemInput): Promise<VerificationItem>;
  appendVerificationResult(actor: Actor, input: AppendVerificationResultInput): Promise<VerificationResult>;

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

function insertProject(draft: StoreState, name: string, now: string, projectId: string = crypto.randomUUID()): Project {
  if (draft.projects.some((project) => project.projectId === projectId)) {
    throw new ConflictError("duplicate_id", `项目 ID 已存在: ${projectId}`);
  }
  const project = { projectId, name, updatedAt: now };
  draft.projects.push(project);
  return project;
}

function insertQuestion(draft: StoreState, project: Project, input: {
  questionId: string; rawClaim: string; confirmedClaim: Question["confirmedClaim"]; now: string;
}): Question {
  if (draft.questions.some((question) => question.questionId === input.questionId)) {
    throw new ConflictError("duplicate_id", `问题 ID 已存在: ${input.questionId}`);
  }
  const question: Question = {
    questionId: input.questionId,
    projectId: project.projectId,
    rawClaim: input.rawClaim,
    confirmedClaim: input.confirmedClaim,
    currentRevisionId: null,
    status: "needs_input",
  };
  question.status = deriveQuestionStatus(draft, question);
  draft.questions.push(question);
  touch(project, input.now);
  return question;
}

function requirePaperStudy(draft: StoreState, projectId: string, sha256?: string): PaperStudy {
  const paper = draft.paperStudies?.find((study) => study.projectId === projectId && (!sha256 || study.sha256 === sha256));
  if (!paper) throw new NotFoundError(sha256 ? "项目没有这份 PDF" : "项目没有已入库的 PDF");
  return paper;
}

function normalizePaperPages(paper: PaperSource): PaperSource {
  const pageSources: PaperPageSource[] = paper.pages.map((text, index) =>
    paper.pageSources?.[index] ?? (text.trim() ? "text" : "pending"));
  return {
    ...clone(paper),
    pageSources,
    pageErrors: paper.pages.map((_, index) => paper.pageErrors?.[index] ?? ""),
    pageRegions: paper.pages.map((_, index) => clone(paper.pageRegions?.[index] ?? [])),
  };
}

function storePaperFile(draft: StoreState, projectId: string, file: PaperFileInput): void {
  if (!/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error("PDF 文件 SHA-256 无效");
  if (!(file.bytes instanceof Uint8Array) || !file.bytes.byteLength) throw new Error("PDF 原文件为空");
  const files = draft.paperFiles ??= [];
  const existing = files.find((item) => item.projectId === projectId && item.sha256 === file.sha256);
  if (existing) {
    if (existing.filename !== file.filename) throw new ConflictError("paper_file_conflict", "同一文件指纹对应不同文件名");
    return;
  }
  files.push({ projectId, filename: file.filename, sha256: file.sha256, bytes: clone(file.bytes) });
}

function paperEvidenceKind(value: unknown): PaperEvidenceKind {
  if (!PAPER_EVIDENCE_KINDS.includes(value as PaperEvidenceKind)) {
    throw new StorageError("invalid_paper_evidence", "证据类别无效");
  }
  return value as PaperEvidenceKind;
}

function paperEvidenceNote(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 500) {
    throw new StorageError("invalid_paper_evidence", "证据说明不能为空且不能超过 500 个字符");
  }
  return value.trim();
}

function requireQuestion(draft: StoreState, questionId: string): Question {
  const question = draft.questions.find((item) => item.questionId === questionId);
  if (!question) throw new NotFoundError(`问题不存在: ${questionId}`);
  return question;
}

function researchState(draft: StoreState): ResearchRecordState {
  return draft.researchRecords ??= { notes: [], items: [], results: [] };
}

function questionResearchSources(draft: StoreState, questionId: string): ResearchSource[] {
  const sources: ResearchSource[] = [];
  for (const study of draft.paperStudies ?? []) {
    for (const candidate of study.generation?.candidates ?? []) {
      if (candidate.questionId !== questionId) continue;
      candidate.citations.forEach((citation, index) => {
        sources.push({
          sourceId: `${candidate.id}:${index + 1}`,
          title: study.title,
          filename: study.filename,
          paperSha256: study.sha256,
          page: citation.page,
          quote: citation.quote,
        });
      });
    }
  }
  return sources;
}

function requiredResearchText(value: string, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new StorageError("invalid_research_record", `${label}不能为空`);
  if (text.length > max) throw new StorageError("invalid_research_record", `${label}不能超过 ${max} 字符`);
  return text;
}

function researchSourceIds(value: string[] | undefined, sources: ResearchSource[]): string[] {
  const input = value ?? [];
  if (!Array.isArray(input) || input.some((id) => typeof id !== "string" || !id)) {
    throw new StorageError("invalid_research_record", "引文来源格式无效");
  }
  const ids = [...new Set(input)];
  const known = new Set(sources.map((source) => source.sourceId));
  const foreign = ids.find((id) => !known.has(id));
  if (foreign) {
    throw new StorageError("invalid_source", `引文来源不属于当前问题或项目，不能关联: ${foreign}`);
  }
  return ids;
}

function verificationDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StorageError("invalid_research_record", "验证日期必须使用 YYYY-MM-DD 格式");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new StorageError("invalid_research_record", "验证日期不是有效日历日期");
  }
  return value;
}

function verificationItemStatus(value: VerificationItemStatus): VerificationItemStatus {
  if (value !== "pending" && value !== "in_progress" && value !== "recorded") {
    throw new StorageError("invalid_research_record", "待验证事项状态无效");
  }
  return value;
}

function verificationConclusion(value: VerificationConclusion): VerificationConclusion {
  if (value !== "supported" && value !== "not_supported" && value !== "insufficient") {
    throw new StorageError("invalid_research_record", "验证结论无效");
  }
  return value;
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
      return backend.transact(actor, (draft) => clone(insertProject(draft, name, now, projectId)));
    },

    async importPaper(actor, { name, paper, now, projectId, file }) {
      if (!/^[a-f0-9]{64}$/i.test(paper.sha256)) throw new Error("PDF 文件 SHA-256 无效");
      if (file && file.sha256 !== paper.sha256) throw new ConflictError("paper_file_mismatch", "原 PDF 与入库文件指纹不一致");
      if (!paper.pages.some((page) => page.trim()) && !file) throw new Error("PDF 没有可入库的文字");
      const normalized = normalizePaperPages(paper);
      return backend.transact(actor, (draft) => {
        const project = projectId ? requireProject(draft, projectId) : insertProject(draft, name, now);
        const studies = draft.paperStudies ??= [];
        const existing = studies.find((study) => study.projectId === project.projectId && study.sha256 === paper.sha256);
        if (!existing) {
          studies.push({ ...normalized, projectId: project.projectId, generation: null });
          touch(project, now);
        } else {
          existing.pageSources ??= normalized.pageSources;
          existing.pageErrors ??= normalized.pageErrors;
          existing.pageRegions ??= normalized.pageRegions;
        }
        if (file) storePaperFile(draft, project.projectId, { ...file, projectId: project.projectId });
        return clone(project);
      });
    },

    async attachPaperFile(actor, projectId, file) {
      return backend.transact(actor, (draft) => {
        requireProject(draft, projectId);
        requirePaperStudy(draft, projectId, file.sha256);
        storePaperFile(draft, projectId, { ...file, projectId });
        return clone(draft.paperFiles?.find((item) => item.projectId === projectId && item.sha256 === file.sha256) as PaperFileBytes);
      });
    },

    async getPaperFile(actor, projectId, sha256) {
      const state = await backend.read(actor);
      requireProject(state, projectId);
      return clone(state.paperFiles?.find((item) => item.projectId === projectId && (!sha256 || item.sha256 === sha256)) ?? null);
    },

    async updatePaperPageOcr(actor, { projectId, sha256, now, update }) {
      return backend.transact(actor, (draft) => {
        const project = requireProject(draft, projectId);
        const study = requirePaperStudy(draft, projectId, sha256);
        if (!Number.isSafeInteger(update.page) || update.page < 1 || update.page > study.pages.length) {
          throw new StorageError("invalid_page", "OCR 页码超出 PDF 页数");
        }
        const index = update.page - 1;
        study.pageSources ??= study.pages.map((text) => text.trim() ? "text" : "pending");
        study.pageErrors ??= study.pages.map(() => "");
        study.pageRegions ??= study.pages.map(() => []);
        if (update.ok) {
          const text = update.text.trim();
          if (!text) throw new StorageError("empty_ocr", "OCR 未识别到文字");
          study.pages[index] = text;
          study.pageSources[index] = "ocr";
          study.pageErrors[index] = "";
          study.pageRegions[index] = clone(update.regions);
        } else {
          const error = update.error.trim();
          if (!error) throw new StorageError("invalid_ocr_error", "缺少 OCR 失败原因");
          study.pageSources[index] = "failed";
          study.pageErrors[index] = error;
        }
        touch(project, now);
        return clone(study);
      });
    },

    async listPaperStudies(actor, projectId) {
      const state = await backend.read(actor);
      requireProject(state, projectId);
      return clone(state.paperStudies?.filter((study) => study.projectId === projectId) ?? []);
    },

    async getPaperStudy(actor, projectId, sha256) {
      const state = await backend.read(actor);
      requireProject(state, projectId);
      return clone(state.paperStudies?.find((study) => study.projectId === projectId && (!sha256 || study.sha256 === sha256)) ?? null);
    },

    async savePaperCandidates(actor, projectId, generation, sha256) {
      return backend.transact(actor, (draft) => {
        const study = requirePaperStudy(draft, projectId, sha256);
        if (!study.generation?.candidates.length) {
          study.generation = {
            model: generation.model,
            candidates: clone(generation.candidates).map((candidate) => ({
              ...candidate,
              id: crypto.randomUUID(),
              questionId: null,
            })),
          };
        }
        return clone(study);
      });
    },

    async acceptPaperCandidate(actor, input) {
      const rawClaim = input.question.trim();
      if (!rawClaim || rawClaim.length > 300) throw new Error("请填写 1 到 300 字符的研究问题");
      return backend.transact(actor, (draft) => {
        const project = requireProject(draft, input.projectId);
        let accepted: { candidate: PaperCandidate & { id: string; questionId: string | null } } | null = null;
        for (const study of draft.paperStudies ?? []) {
          if (study.projectId !== project.projectId) continue;
          const candidate = study.generation?.candidates.find(({ id }) => id === input.candidateId);
          if (candidate) {
            accepted = { candidate };
            break;
          }
        }
        if (!accepted) throw new NotFoundError("候选问题不存在");
        const { candidate } = accepted;
        if (candidate.questionId) {
          const existing = draft.questions.find((question) => question.questionId === candidate.questionId);
          if (!existing || existing.projectId !== project.projectId) throw new NotFoundError("已确认的研究问题不存在");
          return clone(existing);
        }
        const question = insertQuestion(draft, project, {
          questionId: crypto.randomUUID(), rawClaim, confirmedClaim: null, now: input.now,
        });
        candidate.questionId = question.questionId;
        return clone(question);
      });
    },

    async listPaperEvidence(actor, questionId) {
      const state = await backend.read(actor);
      requireQuestion(state, questionId);
      return clone((state.paperEvidence ?? [])
        .filter((evidence) => evidence.questionId === questionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    },

    async addPaperEvidence(actor, input) {
      const kind = paperEvidenceKind(input.kind);
      const note = paperEvidenceNote(input.note);
      return backend.transact(actor, (draft) => {
        const question = requireQuestion(draft, input.questionId);
        if (question.projectId !== input.projectId) throw new StorageError("cross_project_evidence", "问题不属于指定项目");
        const paper = requirePaperStudy(draft, input.projectId, input.paperSha256);
        const citation = verifyPaperQuote(paper, input.page, input.quote);
        const now = input.now;
        const evidence: PaperEvidence = {
          evidenceId: crypto.randomUUID(),
          projectId: input.projectId,
          questionId: input.questionId,
          paperSha256: paper.sha256,
          page: citation.page,
          quote: citation.quote,
          kind,
          note,
          createdAt: now,
          updatedAt: now,
        };
        (draft.paperEvidence ??= []).push(evidence);
        touch(requireProject(draft, input.projectId), now);
        return clone(evidence);
      });
    },

    async updatePaperEvidence(actor, input) {
      const kind = paperEvidenceKind(input.kind);
      const note = paperEvidenceNote(input.note);
      return backend.transact(actor, (draft) => {
        requireQuestion(draft, input.questionId);
        const evidence = draft.paperEvidence?.find((item) => item.evidenceId === input.evidenceId && item.questionId === input.questionId);
        if (!evidence) throw new NotFoundError("研究证据不存在");
        evidence.kind = kind;
        evidence.note = note;
        evidence.updatedAt = input.now;
        touch(requireProject(draft, evidence.projectId), input.now);
        return clone(evidence);
      });
    },

    async removePaperEvidence(actor, input) {
      return backend.transact(actor, (draft) => {
        const question = requireQuestion(draft, input.questionId);
        const evidence = draft.paperEvidence?.find((item) => item.evidenceId === input.evidenceId && item.questionId === input.questionId);
        if (!evidence) throw new NotFoundError("研究证据不存在");
        draft.paperEvidence = draft.paperEvidence!.filter((item) => item.evidenceId !== evidence.evidenceId);
        touch(requireProject(draft, question.projectId), input.now);
      });
    },

    async getQuestionResearch(actor, questionId) {
      const state = await backend.read(actor);
      requireQuestion(state, questionId);
      const records = state.researchRecords ?? { notes: [], items: [], results: [] };
      const items = records.items.filter((item) => item.questionId === questionId);
      const itemIds = new Set(items.map((item) => item.itemId));
      return clone({
        sources: questionResearchSources(state, questionId),
        notes: records.notes
          .filter((note) => note.questionId === questionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        results: records.results.filter((result) => itemIds.has(result.itemId)),
      });
    },

    async saveResearchNote(actor, input) {
      const body = requiredResearchText(input.body, "笔记正文", 10_000);
      return backend.transact(actor, (draft) => {
        const question = requireQuestion(draft, input.questionId);
        const records = researchState(draft);
        const sourceIds = researchSourceIds(input.sourceIds, questionResearchSources(draft, question.questionId));
        let note: ResearchNote;
        if (input.noteId) {
          const existing = records.notes.find((item) => item.noteId === input.noteId);
          if (!existing || existing.questionId !== question.questionId) throw new NotFoundError("阅读笔记不存在");
          existing.body = body;
          existing.sourceIds = sourceIds;
          existing.updatedAt = input.now;
          note = existing;
        } else {
          note = {
            noteId: crypto.randomUUID(),
            questionId: question.questionId,
            body,
            sourceIds,
            createdAt: input.now,
            updatedAt: input.now,
          };
          records.notes.push(note);
        }
        touch(requireProject(draft, question.projectId), input.now);
        return clone(note);
      });
    },

    async saveVerificationItem(actor, input) {
      const questionText = requiredResearchText(input.question, "待验证问句", 500);
      const method = requiredResearchText(input.method, "验证方法", 2_000);
      const criteria = requiredResearchText(input.criteria, "判断依据", 2_000);
      const status = verificationItemStatus(input.status ?? "pending");
      return backend.transact(actor, (draft) => {
        const question = requireQuestion(draft, input.questionId);
        const records = researchState(draft);
        let item: VerificationItem;
        if (input.itemId) {
          const existing = records.items.find((entry) => entry.itemId === input.itemId);
          if (!existing || existing.questionId !== question.questionId) throw new NotFoundError("待验证事项不存在");
          existing.question = questionText;
          existing.method = method;
          existing.criteria = criteria;
          existing.status = status;
          existing.updatedAt = input.now;
          item = existing;
        } else {
          let noteId: string | null = input.noteId || null;
          let sourceIds: string[];
          if (noteId) {
            const note = records.notes.find((entry) => entry.noteId === noteId);
            if (!note || note.questionId !== question.questionId) throw new NotFoundError("来源笔记不存在");
            sourceIds = [...note.sourceIds];
          } else {
            sourceIds = researchSourceIds(input.sourceIds, questionResearchSources(draft, question.questionId));
          }
          item = {
            itemId: crypto.randomUUID(),
            questionId: question.questionId,
            question: questionText,
            method,
            criteria,
            status,
            noteId,
            sourceIds,
            createdAt: input.now,
            updatedAt: input.now,
          };
          records.items.push(item);
        }
        touch(requireProject(draft, question.projectId), input.now);
        return clone(item);
      });
    },

    async appendVerificationResult(actor, input) {
      const observation = requiredResearchText(input.observation, "实际观察", 5_000);
      const basis = requiredResearchText(input.basis, "验证依据", 5_000);
      const verifiedOn = verificationDate(input.verifiedOn);
      const conclusion = verificationConclusion(input.conclusion);
      return backend.transact(actor, (draft) => {
        const question = requireQuestion(draft, input.questionId);
        const records = researchState(draft);
        const item = records.items.find((entry) => entry.itemId === input.itemId);
        if (!item || item.questionId !== question.questionId) throw new NotFoundError("待验证事项不存在");
        const result: VerificationResult = {
          resultId: crypto.randomUUID(),
          itemId: item.itemId,
          observation,
          basis,
          verifiedOn,
          conclusion,
          createdAt: input.now,
        };
        records.results.push(result);
        item.status = "recorded";
        item.updatedAt = input.now;
        touch(requireProject(draft, question.projectId), input.now);
        return clone(result);
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
        const itemIds = new Set(
          draft.researchRecords?.items.filter((item) => questionIds.has(item.questionId)).map((item) => item.itemId) ?? [],
        );
        draft.projects = draft.projects.filter((p) => p.projectId !== projectId);
        if (draft.paperStudies) draft.paperStudies = draft.paperStudies.filter((study) => study.projectId !== projectId);
        if (draft.paperFiles) draft.paperFiles = draft.paperFiles.filter((file) => file.projectId !== projectId);
        if (draft.paperEvidence) draft.paperEvidence = draft.paperEvidence.filter((evidence) => evidence.projectId !== projectId && !questionIds.has(evidence.questionId));
        draft.questions = draft.questions.filter((q) => !questionIds.has(q.questionId));
        draft.runs = draft.runs.filter((r) => r.projectId !== projectId);
        draft.revisions = draft.revisions.filter((r) => !questionIds.has(r.questionId));
        draft.jobs = draft.jobs.filter((j) => !questionIds.has(j.questionId));
        draft.analyses = draft.analyses.filter((a) => !questionIds.has(a.questionId));
        draft.jobEvents = draft.jobEvents.filter((e) => !jobIds.has(e.jobId));
        if (draft.researchRecords) {
          draft.researchRecords.notes = draft.researchRecords.notes.filter((note) => !questionIds.has(note.questionId));
          draft.researchRecords.items = draft.researchRecords.items.filter((item) => !questionIds.has(item.questionId));
          draft.researchRecords.results = draft.researchRecords.results.filter((result) => !itemIds.has(result.itemId));
        }
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
        const project = requireProject(draft, input.projectId);
        return clone(insertQuestion(draft, project, input));
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

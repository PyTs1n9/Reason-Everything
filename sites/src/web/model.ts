/**
 * 前端视图模型纯函数（可离线单测；DOM 逻辑在 web/assets/study.js）。
 */

import type { ProjectSummary } from "../experiment/storage.ts";
import type { ClaimSpec, TrainingRun } from "../experiment/types.ts";
import type { EvidencePackage } from "../experiment/evidence.ts";

/** 按项目名过滤（大小写不敏感、去空格）；空查询返回原列表顺序。 */
export function filterProjects(list: readonly ProjectSummary[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((p) => p.name.toLowerCase().includes(q));
}

/** 按研究领域筛选；空领域表示全部，缺少类型映射的项目不会被归入其他领域。 */
export function filterProjectsByType(
  list: readonly ProjectSummary[],
  types: Readonly<Record<string, string>>,
  selectedType: string,
): ProjectSummary[] {
  const selected = selectedType.trim();
  if (!selected) return [...list];
  return list.filter((project) => types[project.projectId] === selected);
}

// ---------- 项目类型标签（卡 13；Project 存储契约冻结，标签仅存浏览器本机） ----------

/** 新建项目可选类型字典（界面固定选项，不进存储契约）。 */
export const PROJECT_TYPES = ["计算机科学", "人工智能", "数学", "生物学", "医学", "经济学", "其他"] as const;

/** 规范化类型：去空格后不在字典内（含空串）一律归「其他」。 */
export function normalizeProjectType(raw: string): string {
  const value = raw.trim();
  return (PROJECT_TYPES as readonly string[]).includes(value) ? value : "其他";
}

/**
 * 解析本机类型映射（localStorage JSON，属浏览器边界数据）：
 * 损坏、非对象、数组或非字符串值一律剔除，绝不带病返回。
 */
export function parseProjectTypes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** 更改本机项目类别：保留其他项目，未知类别归「其他」，不改输入映射。 */
export function changeProjectType(
  types: Readonly<Record<string, string>>,
  projectId: string,
  rawType: string,
): Record<string, string> {
  return { ...types, [projectId]: normalizeProjectType(rawType) };
}

export interface QuestionFormProfile {
  type: string;
  guideTitle: string;
  guideIntro: string;
  checklist: readonly string[];
  boundary: string;
  claimPlaceholder: string;
  scopeTitle: string;
  targetScopeLabel: string;
  bothScopeLabel: string;
  targetScopeHint: string;
  bothScopeHint: string;
  targetConditionLabel: string;
}

const QUESTION_FORM_PROFILES: Record<string, QuestionFormProfile> = {
  计算机科学: {
    type: "计算机科学",
    guideTitle: "算法实验设计",
    guideIntro: "先写清可复现的实验条件，再判断数据增强是否带来稳定提升。",
    checklist: ["固定模型、评测集与随机种子", "基线只改变增强开关", "确认学习率来自数据且单位一致"],
    boundary: "当前分析器比较增强开关与准确率；缺少严格配对条件时会保留缺测并建议补跑。",
    claimPlaceholder: "例如：在 ResNet18 与 CIFAR-10 上，数据增强使准确率提高了 2 个百分点",
    scopeTitle: "实验验证范围",
    targetScopeLabel: "目标学习率",
    bothScopeLabel: "两档都验证",
    targetScopeHint: "只检查目标运行所在学习率的一档对照。",
    bothScopeHint: "对数据中的两档学习率逐档检查，不合并结论。",
    targetConditionLabel: "目标学习率（数据中的取值）",
  },
  人工智能: {
    type: "人工智能",
    guideTitle: "模型实验设计",
    guideIntro: "先固定数据划分、模型与评测口径，再判断数据增强是否带来可复现的提升。",
    checklist: ["隔离训练、验证与测试集，避免数据泄漏", "固定模型、评测集与随机种子", "基线只改变增强开关并确认学习率一致"],
    boundary: "当前分析器比较增强开关与准确率；单次结果不代表统计显著性，跨数据集结论需分别验证。",
    claimPlaceholder: "例如：在 ResNet18 与 CIFAR-10 上，数据增强使测试集准确率提高了 2 个百分点",
    scopeTitle: "模型验证范围",
    targetScopeLabel: "目标学习率",
    bothScopeLabel: "两档都验证",
    targetScopeHint: "只检查目标运行所在学习率的一档对照。",
    bothScopeHint: "对数据中的两档学习率逐档检查，不合并不同学习率的结论。",
    targetConditionLabel: "目标学习率（数据中的取值）",
  },
  数学: {
    type: "数学",
    guideTitle: "论证与数值实验",
    guideIntro: "区分解析论证、数值实验和反例；导入结果时保持同一问题定义与计算精度。",
    checklist: ["明确命题与适用假设", "说明数值精度和收敛标准", "用反例检查结论边界"],
    boundary: "当前表格分析只处理准确率与增强开关，不能替代数学证明或符号推导。",
    claimPlaceholder: "例如：在固定初值与容差下，该数值方法使目标函数收敛所需迭代减少",
    scopeTitle: "验证范围",
    targetScopeLabel: "目标条件（lr）",
    bothScopeLabel: "两档条件逐档（lr）",
    targetScopeHint: "只检查目标运行对应的一个实验条件。",
    bothScopeHint: "分别检查两档实验条件，避免用一档结果代替全称结论。",
    targetConditionLabel: "目标实验条件（lr 列取值）",
  },
  生物学: {
    type: "生物学",
    guideTitle: "生物实验设计",
    guideIntro: "先核对样本、批次、对照与检测指标，避免把技术重复当作独立样本。",
    checklist: ["明确样本单位与独立重复数", "记录批次、处理条件与对照", "确认主要检测指标和缺失值"],
    boundary: "当前表格分析不识别生物学显著性；统计检验和实验设计仍需单独核对。",
    claimPlaceholder: "例如：在相同培养条件下，处理组的目标蛋白表达高于对照组",
    scopeTitle: "实验验证范围",
    targetScopeLabel: "目标实验条件（lr）",
    bothScopeLabel: "两档实验条件逐档（lr）",
    targetScopeHint: "只检查目标运行对应的一个实验条件。",
    bothScopeHint: "分别检查两档条件，保留各档独立的证据与缺口。",
    targetConditionLabel: "目标实验条件（lr 列取值）",
  },
  医学: {
    type: "医学",
    guideTitle: "临床研究设计",
    guideIntro: "先核对研究设计、研究对象、对照和结局，不把模型准确率直接当作临床疗效。",
    checklist: ["研究设计：随机对照、队列或病例对照", "研究对象：入排标准、样本量与亚组", "结局指标：主要/次要终点、随访时间与缺失值"],
    boundary: "当前矩阵仅支持可严格配对的表格实验；不满足条件时请先保存草稿，或从 PDF 候选问题进入原文证据研究。",
    claimPlaceholder: "例如：在特定入排标准下，干预组的主要结局优于对照组",
    scopeTitle: "研究验证范围",
    targetScopeLabel: "目标研究条件（lr）",
    bothScopeLabel: "两档研究条件逐档（lr）",
    targetScopeHint: "只检查目标运行对应的一个可配对条件。",
    bothScopeHint: "逐档核对两档条件；不同人群或终点不得直接合并。",
    targetConditionLabel: "目标研究条件（lr 列取值）",
  },
  经济学: {
    type: "经济学",
    guideTitle: "经济研究设计",
    guideIntro: "核对识别策略、样本期间、对照组与结局变量，区分相关关系与因果效应。",
    checklist: ["明确识别策略与反事实对照", "固定样本期间和处理组定义", "检查异质性、缺失值与稳健性"],
    boundary: "当前表格分析不代替因果识别或统计推断，结论只覆盖已严格配对的数据。",
    claimPlaceholder: "例如：在相同样本期间内，政策处理使目标结局提高了指定幅度",
    scopeTitle: "验证范围",
    targetScopeLabel: "目标识别条件（lr）",
    bothScopeLabel: "两档识别条件逐档（lr）",
    targetScopeHint: "只检查目标运行对应的一个实验条件。",
    bothScopeHint: "分别检查两档条件，避免跨期间或跨样本拼接证据。",
    targetConditionLabel: "目标实验条件（lr 列取值）",
  },
  其他: {
    type: "其他",
    guideTitle: "研究设计核对",
    guideIntro: "先明确问题、对照和结局，再导入能够严格配对的实验数据。",
    checklist: ["明确研究问题与主张边界", "固定对照条件和测量口径", "记录样本、缺失值与适用条件"],
    boundary: "当前分析器固定比较增强开关与准确率；其他研究设计请先保存草稿或使用论文证据路径。",
    claimPlaceholder: "例如：在相同条件下，目标处理使主要指标提高了 2 个百分点",
    scopeTitle: "验证范围",
    targetScopeLabel: "目标条件（lr）",
    bothScopeLabel: "两档条件逐档（lr）",
    targetScopeHint: "只检查目标运行对应的一个实验条件。",
    bothScopeHint: "分别检查两档条件，保留各档独立的证据与缺口。",
    targetConditionLabel: "目标实验条件（lr 列取值）",
  },
};

/** 按项目类别生成录入提示；范围值仍只使用冻结契约的 target_lr / both_lrs。 */
export function buildQuestionFormProfile(rawType: string): QuestionFormProfile {
  const profile = QUESTION_FORM_PROFILES[normalizeProjectType(rawType)] ?? QUESTION_FORM_PROFILES["其他"]!;
  return { ...profile, checklist: [...profile.checklist] };
}

// ---------- 工作台统计 / 搜索高亮 / 置顶排序（卡 15） ----------

export interface DashboardStats {
  projectCount: number;
  questionCount: number;
  /** updatedAt 落在 (now-7d, now] 内的项目数。 */
  weekUpdated: number;
}

/** KPI 统计：项目数、研究问题总数、近 7 天更新数；坏时间戳不计入更新数。 */
export function computeDashboardStats(projects: readonly ProjectSummary[], now: string): DashboardStats {
  const nowMs = Date.parse(now);
  let questionCount = 0;
  let weekUpdated = 0;
  for (const project of projects) {
    questionCount += project.questionCount;
    const updatedMs = Date.parse(project.updatedAt);
    if (Number.isNaN(nowMs) || Number.isNaN(updatedMs)) continue;
    if (updatedMs > nowMs - 7 * 24 * 60 * 60 * 1000 && updatedMs <= nowMs) weekUpdated += 1;
  }
  return { projectCount: projects.length, questionCount, weekUpdated };
}

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** 名称按查询词（大小写不敏感、trim）切分为高亮/非高亮片段；空查询或无匹配返回单段原文。 */
export function highlightMatches(name: string, query: string): HighlightSegment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text: name, hit: false }];
  const lower = name.toLowerCase();
  const segments: HighlightSegment[] = [];
  let index = 0;
  for (;;) {
    const at = lower.indexOf(q, index);
    if (at < 0) break;
    if (at > index) segments.push({ text: name.slice(index, at), hit: false });
    segments.push({ text: name.slice(at, at + q.length), hit: true });
    index = at + q.length;
  }
  if (segments.length === 0) return [{ text: name, hit: false }];
  if (index < name.length) segments.push({ text: name.slice(index), hit: false });
  return segments;
}

/** 置顶项目（本机 UI 元数据）优先，两组各自按更新时间倒序；坏时间戳按最早处理。 */
export function sortProjects(
  list: readonly ProjectSummary[],
  pinnedIds: ReadonlySet<string>,
): ProjectSummary[] {
  const byUpdatedDesc = (a: ProjectSummary, b: ProjectSummary): number => {
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  };
  return [
    ...list.filter((p) => pinnedIds.has(p.projectId)).sort(byUpdatedDesc),
    ...list.filter((p) => !pinnedIds.has(p.projectId)).sort(byUpdatedDesc),
  ];
}

/** 项目类型 → 色板 class 后缀（字典外随 normalizeProjectType 归「其他」）。 */
export function typeColorClass(type: string): string {
  switch (normalizeProjectType(type)) {
    case "计算机科学":
      return "type-cs";
    case "人工智能":
      return "type-ai";
    case "数学":
      return "type-math";
    case "生物学":
      return "type-bio";
    case "医学":
      return "type-med";
    case "经济学":
      return "type-econ";
    default:
      return "type-other";
  }
}

const CARD_FEATHER_PALETTES = [
  ["#79b995", "#b7a6e8", "#e6c88f"],
  ["#78c5bd", "#8fb4e5", "#e4b4c7"],
  ["#d2ad72", "#ca9fb6", "#9dc3a7"],
  ["#8ac7a6", "#77b7c9", "#c5b5e6"],
] as const;

export interface CardFeatherVariant {
  id: string;
  colors: readonly [string, string, string];
  x: number;
  y: number;
  scale: number;
  rotate: number;
  angle: number;
  glowX: number;
  glowY: number;
}

/** 按项目身份生成稳定的配色、位置与光晕参数，避免搜索重绘时装饰跳动。 */
export function cardFeatherVariant(seed: string): CardFeatherVariant {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return {
    id: unsigned.toString(36),
    colors: CARD_FEATHER_PALETTES[unsigned % CARD_FEATHER_PALETTES.length],
    x: 12 + ((unsigned >>> 3) % 12),
    y: 10 + ((unsigned >>> 7) % 12),
    scale: 0.9 + ((unsigned >>> 11) % 15) / 100,
    rotate: -4 + ((unsigned >>> 15) % 9),
    angle: 112 + ((unsigned >>> 19) % 17),
    glowX: 22 + ((unsigned >>> 23) % 66),
    glowY: 12 + ((unsigned >>> 27) % 38),
  };
}

/** PDF 题名：元数据优先，退回首页首行；均无则空串（不猜题名）。 */
export function extractPaperTitle(input: { metaTitle?: string; firstPageText?: string }): string {
  const meta = (input.metaTitle ?? "").trim();
  if (meta) return meta.slice(0, 500);
  const line = (input.firstPageText ?? "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ? line.slice(0, 500) : "";
}

// ---------- 顶栏保存模式信息（卡 18：「本机保存」点击弹层） ----------

export interface SaveModeInfoRow {
  label: string;
  value: string;
}

export interface SaveModeInfo {
  rows: SaveModeInfoRow[];
  note: string;
}

export function buildSaveModeInfo(input: {
  adapterLabel: string;
  dbName: string;
  projectCount: number;
  questionCount: number;
  libraryPath?: string;
  paperCount?: number;
  modelKeyPath?: string;
}): SaveModeInfo {
  return {
    rows: [
      { label: "存储方式", value: `${input.adapterLabel}（IndexedDB）` },
      { label: "数据库", value: input.dbName },
      {
        label: "当前数据",
        value: `${input.projectCount} 个项目 · ${input.questionCount} 个研究问题`,
      },
      { label: "本地知识库", value: input.libraryPath || "未选择（点下方按钮设置）" },
      {
        label: "PDF 原件",
        value: input.paperCount === undefined || !input.libraryPath ? "未选择文件夹" : `${input.paperCount} 篇（papers/）`,
      },
      { label: "模型密钥", value: input.modelKeyPath || "未选择文件夹" },
      { label: "云端同步", value: "未接入" },
    ],
    note: "项目与分析仍只保存在当前浏览器，不跨设备同步；清除浏览器站点数据会丢失项目与分析。所选文件夹长期保存 PDF 原件与加密模型密钥，更换浏览器后可取回 PDF 重新入库。",
  };
}

// ---------- 侧栏树（卡 13：知识库 → 项目文件夹 → 问题文档） ----------

export interface SideTreeQuestion {
  questionId: string;
  label: string;
}

export interface SideTreeNode {
  projectId: string;
  name: string;
  questions: SideTreeQuestion[];
}

/**
 * 组装侧栏树节点：项目为文件夹、问题为文档。
 * 保持输入顺序（项目=更新倒序由调用方保证），空问题项目保留为空文件夹。
 */
export function buildSideTree(
  projects: readonly ProjectSummary[],
  questionsByProject: Readonly<Record<string, readonly { questionId: string; rawClaim: string }[]>>,
): SideTreeNode[] {
  return projects.map((project) => ({
    projectId: project.projectId,
    name: project.name,
    questions: (questionsByProject[project.projectId] ?? []).map((question) => ({
      questionId: question.questionId,
      label: question.rawClaim.trim() ? question.rawClaim : "(未填主张)",
    })),
  }));
}

/** 更新时间 → 展示串 "MM-DD HH:mm"（真实时间，本地时区）。 */
export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 从运行集合提取去重、升序的学习率选项（仅数值；unknown 跳过）。 */
export function deriveLrOptions(runs: readonly TrainingRun[]): number[] {
  const values = new Set<number>();
  for (const run of runs) {
    const lr = run.config.lr;
    if (typeof lr === "number" && Number.isFinite(lr)) values.add(lr);
  }
  return [...values].sort((a, b) => a - b);
}

/** 录入表单缺项（按提交顺序）；返回中文缺项列表，空数组=可提交。 */
export interface EntryFormState {
  rawClaim: string;
  dataText: string;
  baselineRunId: string;
  targetRunId: string;
  scope: "target_lr" | "both_lrs" | "";
  targetLr: number | null;
}

export function evaluateEntryMissing(state: EntryFormState): string[] {
  const missing: string[] = [];
  if (!state.rawClaim.trim()) missing.push("主张原句");
  if (!state.dataText.trim()) missing.push("训练数据（CSV/TSV）");
  if (!state.targetRunId) missing.push("目标运行");
  if (!state.baselineRunId) missing.push("基线运行");
  if (!state.scope) missing.push("问题范围");
  if (state.scope === "target_lr" && state.targetLr === null) missing.push("目标学习率");
  return missing;
}

/** cellId（cell:项目:因素:指标:学习率:开关）→ 可读标签；格式不符原样返回。仅显示层使用。 */
export function describeCellId(cellId: string): string {
  const parts = cellId.split(":");
  if (parts.length !== 6 || parts[0] !== "cell") return cellId;
  const aug = parts[5] === "on" ? "增强开" : parts[5] === "off" ? "增强关" : parts[5];
  return `${parts[4]}/${aug}`;
}

/** 把文本中的 cellId 全部替换为可读标签；不改存储文本，仅显示层使用。 */
export function humanizeCellIds(text: string): string {
  return String(text).replace(
    /cell:[^:\s：]+:[^:\s：]+:[^:\s：]+:[^:\s：]+:[^:\s：]+/g,
    (id) => describeCellId(id),
  );
}

/** 问题状态 → 文字 + 形状（状态不得只靠颜色）。 */
export function statusGlyph(status: string): { glyph: string; text: string } {
  switch (status) {
    case "needs_input":
      return { glyph: "◇", text: "待补充" };
    case "waiting_for_run":
      return { glyph: "◆", text: "待补跑" };
    case "reviewable":
      return { glyph: "●", text: "可分析" };
    default:
      return { glyph: "○", text: status };
  }
}

/** 模型输出状态 → 文字 + 形状。 */
export function modelGlyph(status: string): { glyph: string; text: string } {
  switch (status) {
    case "ready":
      return { glyph: "●", text: "分析已生成" };
    case "failed":
      return { glyph: "▲", text: "分析失败" };
    case "unavailable":
      return { glyph: "○", text: "AI 未接通" };
    default:
      return { glyph: "◇", text: "分析未生成" };
  }
}

// ---------- 问题详情：实验对照矩阵（读同一份 revision 数据，配对/算术一律走卡 04 引擎） ----------

export type MatrixCellState = "measured" | "suggested" | "empty";

export interface MatrixCell {
  /** 选择键：`lr|augmentation`。 */
  key: string;
  lr: number;
  augmentation: string;
  state: MatrixCellState;
  runId: string | null;
  accuracy: number | null;
  /** 范围内格子的 cellId（与证据编号互链；范围外为 null）。 */
  cellId: string | null;
}

export interface QuestionMatrix {
  /** 学习率升序。 */
  lrs: number[];
  cells: MatrixCell[];
  fixedConditions: { model: string; evalSplit: string; seed: string };
}

function equalNumber(a: CellLike, b: number): boolean {
  return typeof a === "number" && Number.isFinite(a) && a === b;
}

type CellLike = string | number | "unknown";

/** 固定条件展示串（仅取值，不做计算）。 */
export function formatAccuracy(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}

/**
 * 由「同一份 revision 的 claim + runs + 卡 04 证据包」生成矩阵模型。
 * - 范围内格子：状态以卡 04 引擎输出为准（measured/requested/missing→建议或未跑）；
 * - 范围外格子：按 (lr, augmentation) 原样取快照运行（点开可见配置与来源）；
 * - UI 不做任何配对或算术。
 */
export function buildQuestionMatrix(
  claim: ClaimSpec,
  runs: readonly TrainingRun[],
  pkg: EvidencePackage,
): QuestionMatrix {
  const lrs = [...new Set(claim.learningRates)].sort((a, b) => a - b);
  const anchor = runs.find((r) => r.runId === claim.targetRunId) ?? runs[0] ?? null;
  const targetLr =
    anchor && typeof claim.targetRunId === "string"
      ? (runs.find((r) => r.runId === claim.targetRunId)?.config.lr ?? null)
      : null;

  const pkgByKey = new Map<string, (typeof pkg.cells)[number]>();
  for (const cell of pkg.cells) pkgByKey.set(`${cell.lr}|${String(cell.augmentation)}`, cell);
  const suggestedCellIds = new Set(pkg.suggestions.map((s) => s.cellId));

  const cells: MatrixCell[] = [];
  for (const lr of lrs) {
    const inScope = claim.scope === "both_lrs" ? true : equalNumber(targetLr, lr);
    for (const augmentation of ["off", "on"]) {
      const key = `${lr}|${augmentation}`;
      const pkgCell = pkgByKey.get(key);
      if (inScope && pkgCell) {
        if (pkgCell.status === "measured" && pkgCell.runId !== null && pkgCell.accuracy !== null) {
          cells.push({
            key,
            lr,
            augmentation,
            state: "measured",
            runId: pkgCell.runId,
            accuracy: pkgCell.accuracy,
            cellId: pkgCell.cellId,
          });
        } else if (pkgCell.status === "requested" || suggestedCellIds.has(pkgCell.cellId)) {
          cells.push({ key, lr, augmentation, state: "suggested", runId: null, accuracy: null, cellId: pkgCell.cellId });
        } else {
          cells.push({ key, lr, augmentation, state: "empty", runId: null, accuracy: null, cellId: pkgCell.cellId });
        }
        continue;
      }
      const raw = runs.find(
        (r) => equalNumber(r.config.lr, lr) && String(r.config.augmentation) === augmentation,
      );
      if (raw) {
        cells.push({
          key,
          lr,
          augmentation,
          state: "measured",
          runId: raw.runId,
          accuracy: raw.metrics.accuracy,
          cellId: null,
        });
      } else {
        cells.push({ key, lr, augmentation, state: "empty", runId: null, accuracy: null, cellId: null });
      }
    }
  }

  return {
    lrs,
    cells,
    fixedConditions: {
      model: anchor ? String(anchor.config.model) : "—",
      evalSplit: anchor ? String(anchor.config.evalSplit) : "—",
      seed: anchor ? String(anchor.config.seed) : "—",
    },
  };
}

// ---------- 论文页排版（卡 22）：把 PDF 逐行文字还原成可读段落 ----------

export type PaperBlockKind = "title" | "heading" | "meta" | "body";

export interface PaperBlock {
  kind: PaperBlockKind;
  text: string;
}

/** 期刊页眉/摘要标签等版式行：不并入正文段落。 */
const PAPER_META_LINE =
  /^(?:\d{4}\s*年|第\s*\d+\s*卷|第\s*\d+\s*期|Vol\.|No\.|ISSN|DOI|中图法分类号|文献标识码|文章编号|收稿日期|基金项目|作者简介|Journal of|Proceedings|中国.*(?:学报|期刊|杂志)$|（[^）]{6,}）$|[\u4e00-\u9fa5]{1,4}(?:\s+[\u4e00-\u9fa5]{1,4}){1,4}$|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$)/i;

/** 章节标题：1 引言 / 2.1 相关工作 / 一、方法 / （一）结论 / 第 3 章。 */
const PAPER_HEADING_LINE =
  /^(?:第\s*[一二三四五六七八九十百\d]+\s*[章节篇]|[一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十\d]+）|\d+(?:\.\d+){0,3}\s+[^\d\s])/;

const PAPER_SENTENCE_END = /[。！？!?…”’"']$/;
const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

function codePointLen(text: string): number {
  return Array.from(text).length;
}

/** 合并同一段内的折行：中文直接相连，英文补空格，连字符保留。 */
export function joinPaperLines(lines: readonly string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim().replace(/\s{2,}/g, " ");
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    const prev = Array.from(out).at(-1) ?? "";
    const next = Array.from(line)[0] ?? "";
    if (prev === "-" && /[A-Za-z0-9]/.test(next)) {
      out += line;
      continue;
    }
    const noSpace =
      CJK_CHAR.test(prev) ||
      CJK_CHAR.test(next) ||
      /[，。！？；：、）】》”’…]/.test(prev) ||
      /^[，。！？；：、）】》”’]/.test(line);
    out += noSpace ? line : ` ${line}`;
  }
  return out;
}

/**
 * 页文本 → 段落块。空行必断段；正文行以句末标点收尾且明显短于本页中位行宽时断段，
 * 避免把整栏并成一块。页眉、章节标题各自成块，阅读页据此分层排版。
 */
export function paragraphizePage(text: string, options: { firstPage?: boolean } = {}): PaperBlock[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim());

  const blocks: PaperBlock[] = [];
  let body: string[] = [];
  let metaLines: string[] = [];
  let blankBefore = false;
  const pushBody = (text: string) => {
    const points = Array.from(text);
    if (points.length <= 460) {
      blocks.push({ kind: "body", text });
      return;
    }
    // 无段落信息的长栏：按句末切成 300 字左右的阅读块，不硬造原文没有的分段。
    const sentences = text.match(/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/g) ?? [text];
    let chunk = "";
    for (const sentence of sentences) {
      if (chunk && Array.from(chunk + sentence).length > 300) {
        blocks.push({ kind: "body", text: chunk });
        chunk = sentence;
      } else {
        chunk += sentence;
      }
    }
    if (chunk) blocks.push({ kind: "body", text: chunk });
  };
  const flushMeta = () => {
    if (metaLines.length === 0) return;
    blocks.push({ kind: "meta", text: metaLines.join(" · ") });
    metaLines = [];
  };
  const flush = () => {
    if (body.length === 0) return;
    pushBody(joinPaperLines(body));
    body = [];
  };

  for (const line of lines) {
    if (!line) {
      flush();
      blankBefore = true;
      continue;
    }
    if (PAPER_META_LINE.test(line)) {
      flush();
      metaLines.push(line.replace(/\s{2,}/g, " "));
      blankBefore = false;
      continue;
    }
    if (PAPER_HEADING_LINE.test(line)) {
      flush();
      flushMeta();
      blocks.push({ kind: "heading", text: line.replace(/\s{2,}/g, " ") });
      blankBefore = false;
      continue;
    }
    flushMeta();
    // 摘要与关键词即使没有空行也各成一段；中文正文后的英文题名/作者同理。
    const prevLine = body.at(-1) ?? "";
    const asciiFrontMatter =
      /[\u4e00-\u9fff]/.test(prevLine) &&
      !/[\u4e00-\u9fff]/.test(line) &&
      /^[A-Z][A-Za-z0-9 ,.&'’\-]+$/.test(line);
    if (body.length > 0 && (blankBefore || asciiFrontMatter || /^(?:摘\s*要|关键词|Abstract|Key\s*words)[:：]/.test(line))) flush();
    body.push(line);
    blankBefore = false;
  }
  flush();
  flushMeta();

  if (options.firstPage) {
    const pick = blocks.slice(0, 6).find((block) =>
      block.kind === "body" &&
      codePointLen(block.text) >= 6 &&
      codePointLen(block.text) <= 90 &&
      !PAPER_SENTENCE_END.test(block.text) &&
      !/^(?:摘\s*要|关键词|Abstract|Key\s*words|参\s*考\s*文\s*献)/i.test(block.text),
    );
    if (pick) {
      const at = blocks.indexOf(pick);
      blocks[at] = { ...pick, kind: "title" };
      // 标题之后的英文题名、作者、单位属于版头，不当作正文段落；英文摘要保持正文。
      for (let i = at + 1; i < Math.min(blocks.length, at + 12); i++) {
        const block = blocks[i]!;
        if (block.kind === "heading") break;
        if (block.kind !== "body") continue;
        if (/^(?:摘\s*要|关键词|Abstract|Key\s*words|参\s*考\s*文\s*献)[:：]?/i.test(block.text)) continue;
        if (!/[\u3400-\u9fff]/.test(block.text)) blocks[i] = { ...block, kind: "meta" };
      }
    }
  }
  return blocks;
}

/** 阅读进度用的字数：汉字按字、拉丁按词。 */
export function countPaperChars(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[.．][0-9]+)?/g) ?? []).length;
  return cjk + latin;
}

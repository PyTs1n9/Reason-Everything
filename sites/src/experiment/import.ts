/**
 * 实验导入纯函数链：解析 → 表头映射 → 校验/归一化 → 导入预览 → 配置差异。
 * 全程无 I/O：预览不写库，确认与持久化由后续卡负责。
 *
 * 解析：UTF-8 BOM、CRLF/LF、尾部空行、CSV 引号、引号内分隔符、"" 转义；
 * 分隔符可显式指定，缺省按首行是否含制表符在 CSV / TSV（Excel 粘贴）间选择。
 *
 * 映射：明确的中英文别名才自动认列；同一语义出现两个候选列 → needs_mapping，
 * 绝不静默取第一列。未知列原样保留（unmapped），用户确认角色后才参与核验：
 * 确认为 config 进 extras（参与匹配），确认为 metadata 归入元数据，ignored 丢弃。
 *
 * 数学：0.01 与 1e-2 数值相同（Number 归一）。accuracy 默认按百分数列读
 * （80% / 80 / 80.00 都是 80）；0.8 表示 80% 必须显式选 ratio 模式换算，
 * 不靠猜。空值、NaN、Infinity、越界 → 拒绝并报行、列。
 * 缺必要配置的行保存为不完整记录（unknown），不能参加严格配对。
 */

import type {
  Cell,
  RunConfig,
  RunMetadata,
  SourceKind,
  TrainingRun,
} from "./types.ts";
import {
  cellAt,
  compareAccuracy,
  configColumns,
  formatDeltaPp,
  isStrictlyPairable,
  toHundredths,
  validateAccuracy,
  validateRun,
} from "./runs.ts";

export type Delimiter = "," | "\t";

export interface ParsedTable {
  delimiter: Delimiter;
  header: string[];
  /** 数据行（不含表头），单元格已 trim；尾部/中间空行已剔除。 */
  rows: string[][];
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}

/** 解析 CSV / TSV 文本。引号内分隔符与换行、"" 转义按 RFC 4180 处理。 */
export function parseTable(text: string, delimiter?: Delimiter): ParsedTable {
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const dlv = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === dlv) {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      endRow();
      i += src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const header = (nonEmpty[0] ?? []).map((h) => h.trim());
  const dataRows = nonEmpty.slice(1).map((r) => r.map((c) => c.trim()));
  return { delimiter: dlv, header, rows: dataRows };
}

// ---------- 表头映射 ----------

export type FieldName =
  | "runId"
  | "model"
  | "evalSplit"
  | "seed"
  | "lr"
  | "augmentation"
  | "optimizer"
  | "epochs"
  | "accuracy"
  | "experimentNo"
  | "note"
  | "importedAt";

const FIELD_ALIASES: Record<FieldName, string[]> = {
  runId: ["runid", "run_id", "run-id", "run id", "运行编号", "运行id"],
  model: ["model", "模型"],
  evalSplit: ["evalsplit", "eval_split", "eval split", "eval-split", "评测集", "评估集", "数据划分"],
  seed: ["seed", "种子", "随机种子"],
  lr: ["lr", "learning_rate", "learning rate", "learning-rate", "学习率"],
  augmentation: ["augmentation", "aug", "增强", "数据增强", "增强开关"],
  optimizer: ["optimizer", "优化器"],
  epochs: ["epochs", "epoch", "轮数", "训练轮数"],
  accuracy: ["accuracy", "acc", "准确率", "正确率"],
  experimentNo: ["experimentno", "experiment_no", "experiment no", "实验编号"],
  note: ["note", "notes", "备注", "注释"],
  importedAt: ["importedat", "imported_at", "import time", "导入时间"],
};

const ROLE_BY_FIELD: Record<FieldName, ColumnRole> = {
  runId: "runId",
  model: "config",
  evalSplit: "config",
  seed: "config",
  lr: "config",
  augmentation: "config",
  optimizer: "config",
  epochs: "config",
  accuracy: "metric",
  experimentNo: "metadata",
  note: "metadata",
  importedAt: "metadata",
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]/g, "");
}

const FIELD_CANDIDATES: Map<string, FieldName[]> = (() => {
  const map = new Map<string, FieldName[]>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FieldName, string[]][]) {
    for (const alias of aliases) {
      const key = normHeader(alias);
      const list = map.get(key) ?? [];
      if (!list.includes(field)) list.push(field);
      map.set(key, list);
    }
  }
  return map;
})();

export type ColumnRole =
  | "runId"
  | "config"
  | "metric"
  | "metadata"
  | "unknown"
  | "ignored";

export interface ColumnMapping {
  index: number;
  header: string;
  field: FieldName | null;
  role: ColumnRole;
  status: "mapped" | "ambiguous" | "unknown" | "ignored";
  /** 该表头命中的字段（歧义时多于一个）。 */
  candidates: FieldName[];
}

export interface HeaderConflict {
  field: FieldName;
  headers: string[];
}

export interface MapHeadersResult {
  status: "ok" | "needs_mapping";
  columns: ColumnMapping[];
  conflicts: HeaderConflict[];
}

export interface MapHeadersOptions {
  /** 审核映射的纯函数参数：表头 → 指定字段或 "ignored"。 */
  overrides?: Record<string, FieldName | "ignored">;
  /** 未知列的角色确认：config / metadata / ignored；未确认保持 unknown。 */
  unknownRoles?: Record<string, "config" | "metadata" | "ignored">;
}

export function mapHeaders(
  header: string[],
  options: MapHeadersOptions = {},
): MapHeadersResult {
  const overrides = options.overrides ?? {};
  const unknownRoles = options.unknownRoles ?? {};

  const columns: ColumnMapping[] = header.map((h, index) => {
    const override = overrides[h];
    if (override === "ignored") {
      return { index, header: h, field: null, role: "ignored", status: "ignored", candidates: [] };
    }
    if (override) {
      return {
        index,
        header: h,
        field: override,
        role: ROLE_BY_FIELD[override],
        status: "mapped",
        candidates: [override],
      };
    }
    const candidates = FIELD_CANDIDATES.get(normHeader(h)) ?? [];
    if (candidates.length === 1) {
      const field = candidates[0]!;
      return { index, header: h, field, role: ROLE_BY_FIELD[field], status: "mapped", candidates };
    }
    if (candidates.length > 1) {
      return { index, header: h, field: null, role: "unknown", status: "ambiguous", candidates };
    }
    const confirmed = unknownRoles[h];
    if (confirmed === "ignored") {
      return { index, header: h, field: null, role: "ignored", status: "ignored", candidates: [] };
    }
    if (confirmed === "config" || confirmed === "metadata") {
      return { index, header: h, field: null, role: confirmed, status: "mapped", candidates: [] };
    }
    return { index, header: h, field: null, role: "unknown", status: "unknown", candidates: [] };
  });

  const byField = new Map<FieldName, string[]>();
  for (const col of columns) {
    if (col.status === "mapped" && col.field) {
      const list = byField.get(col.field) ?? [];
      list.push(col.header);
      byField.set(col.field, list);
    }
  }
  const conflicts: HeaderConflict[] = [];
  for (const [field, headers] of byField) {
    if (headers.length > 1) conflicts.push({ field, headers });
  }
  for (const col of columns) {
    if (col.status === "ambiguous") {
      for (const field of col.candidates) {
        if (!conflicts.some((c) => c.field === field && c.headers.includes(col.header))) {
          conflicts.push({ field, headers: [col.header] });
        }
      }
    }
  }

  const status: MapHeadersResult["status"] = conflicts.length > 0 ? "needs_mapping" : "ok";
  return { status, columns, conflicts };
}

// ---------- 校验 / 归一化 ----------

export interface RowError {
  /** 1 起的数据行号；0 表示表级错误（缺整列等）。 */
  row: number;
  column: string;
  message: string;
}

export interface BuildOptions {
  projectId: string;
  source: SourceKind;
  importedAt: string;
  /** 默认 percent（80 / 80% / 80.00 都是 80）；0.8→80 必须显式选 ratio。 */
  accuracyUnit?: "percent" | "ratio";
  overrides?: Record<string, FieldName | "ignored">;
  unknownRoles?: Record<string, "config" | "metadata" | "ignored">;
}

export interface BuiltRow {
  run: TrainingRun;
  /** 必要配置齐全、可参加严格配对。 */
  complete: boolean;
}

export interface BuildRunsResult {
  ok: boolean;
  mapping: MapHeadersResult;
  rows: BuiltRow[];
  errors: RowError[];
  /** 未确认角色的未知列原样保留。 */
  unmapped: Array<{ header: string; values: string[] }>;
}

function parseAccuracyCell(
  raw: string,
  unit: "percent" | "ratio",
): { ok: true; value: number } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "准确率为空" };
  let numericText = text;
  if (unit === "percent" && (text.endsWith("%") || text.endsWith("％"))) {
    numericText = text.slice(0, -1).trim();
  }
  const value = Number(numericText);
  if (Number.isNaN(value)) return { ok: false, message: `准确率不是数字: ${text}` };
  if (!Number.isFinite(value)) return { ok: false, message: `准确率不是有限数: ${text}` };
  if (unit === "ratio") {
    if (value < 0 || value > 1) {
      return { ok: false, message: `比例模式要求 0–1，收到: ${text}` };
    }
    const percent = Math.round(value * 10000) / 100;
    const err = validateAccuracy(percent);
    return err ? { ok: false, message: err } : { ok: true, value: percent };
  }
  const err = validateAccuracy(value);
  return err ? { ok: false, message: err } : { ok: true, value };
}

function numericOrUnknown(raw: string): Cell | "invalid" {
  const text = raw.trim();
  if (text === "") return "unknown";
  const value = Number(text);
  if (!Number.isFinite(value)) return "invalid";
  return value;
}

function stringOrUnknown(raw: string): Cell {
  const text = raw.trim();
  return text === "" ? "unknown" : text;
}

/** 按映射把解析后的表构造成运行记录；行级错误逐条报行、列。 */
export function buildRuns(table: ParsedTable, options: BuildOptions): BuildRunsResult {
  const mapping = mapHeaders(table.header, options);
  const errors: RowError[] = [];
  const rows: BuiltRow[] = [];

  if (mapping.status !== "ok") {
    return { ok: false, mapping, rows, errors, unmapped: [] };
  }

  const fieldCol = new Map<FieldName, number>();
  const confirmedConfigCols: number[] = [];
  const unknownMetaCols: number[] = [];
  const unknownCols: number[] = [];
  for (const col of mapping.columns) {
    if (col.status === "ignored") continue;
    if (col.field) fieldCol.set(col.field, col.index);
    else if (col.role === "config") confirmedConfigCols.push(col.index);
    else if (col.role === "metadata") unknownMetaCols.push(col.index);
    else unknownCols.push(col.index);
  }

  if (!fieldCol.has("runId")) {
    errors.push({ row: 0, column: "runId", message: "缺少 runId 列" });
  }
  if (!fieldCol.has("accuracy")) {
    errors.push({ row: 0, column: "accuracy", message: "缺少 accuracy 列" });
  }
  if (errors.length > 0) {
    return { ok: false, mapping, rows, errors, unmapped: [] };
  }

  const cellOf = (row: string[], field: FieldName): string => {
    const index = fieldCol.get(field);
    if (index === undefined) return "";
    return row[index] ?? "";
  };

  table.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    if (row.length > table.header.length) {
      errors.push({
        row: rowNumber,
        column: table.header[table.header.length - 1] ?? "#",
        message: `单元格数 ${row.length} 超过表头列数 ${table.header.length}`,
      });
      return;
    }

    const runId = cellOf(row, "runId").trim();
    if (!runId) {
      errors.push({ row: rowNumber, column: "runId", message: "runId 为空" });
      return;
    }

    const accuracy = parseAccuracyCell(cellOf(row, "accuracy"), options.accuracyUnit ?? "percent");
    if (!accuracy.ok) {
      errors.push({ row: rowNumber, column: "accuracy", message: accuracy.message });
      return;
    }

    const seed = numericOrUnknown(cellOf(row, "seed"));
    if (seed === "invalid") {
      errors.push({ row: rowNumber, column: "seed", message: `seed 不是数字: ${cellOf(row, "seed")}` });
      return;
    }
    const lr = numericOrUnknown(cellOf(row, "lr"));
    if (lr === "invalid") {
      errors.push({ row: rowNumber, column: "lr", message: `lr 不是数字: ${cellOf(row, "lr")}` });
      return;
    }

    const config: RunConfig = {
      model: stringOrUnknown(cellOf(row, "model")),
      evalSplit: stringOrUnknown(cellOf(row, "evalSplit")),
      seed,
      lr,
      augmentation: stringOrUnknown(cellOf(row, "augmentation")),
    };

    const optimizerRaw = cellOf(row, "optimizer").trim();
    if (optimizerRaw !== "") config.optimizer = optimizerRaw;
    if (fieldCol.has("epochs")) {
      const epochsRaw = cellOf(row, "epochs").trim();
      if (epochsRaw !== "") {
        const epochs = numericOrUnknown(epochsRaw);
        if (epochs === "invalid") {
          errors.push({ row: rowNumber, column: "epochs", message: `epochs 不是数字: ${epochsRaw}` });
          return;
        }
        config.epochs = epochs;
      }
    }

    const extras: Record<string, Cell> = {};
    for (const index of confirmedConfigCols) {
      const header = table.header[index] ?? `col${index}`;
      const raw = row[index] ?? "";
      if (raw.trim() === "") continue;
      const asNumber = Number(raw.trim());
      extras[header] = Number.isFinite(asNumber) && raw.trim() !== "" ? asNumber : raw.trim();
    }
    if (Object.keys(extras).length > 0) config.extras = extras;

    const metadata: RunMetadata = { importedAt: options.importedAt };
    const experimentNo = cellOf(row, "experimentNo").trim();
    if (experimentNo) metadata.experimentNo = experimentNo;
    const noteParts: string[] = [];
    const noteCell = cellOf(row, "note").trim();
    if (noteCell) noteParts.push(noteCell);
    for (const index of unknownMetaCols) {
      const raw = (row[index] ?? "").trim();
      if (raw !== "") noteParts.push(`${table.header[index] ?? `col${index}`}=${raw}`);
    }
    if (noteParts.length > 0) metadata.note = noteParts.join("; ");

    const run: TrainingRun = {
      runId,
      projectId: options.projectId,
      config,
      source: options.source,
      metrics: { accuracy: accuracy.value },
      metadata,
    };
    const structureErrors = validateRun(run);
    if (structureErrors.length > 0) {
      for (const message of structureErrors) {
        errors.push({ row: rowNumber, column: "run", message });
      }
      return;
    }
    rows.push({ run, complete: isStrictlyPairable(config) });
  });

  const unmapped = unknownCols.map((index) => ({
    header: table.header[index] ?? `col${index}`,
    values: table.rows.map((row) => row[index] ?? ""),
  }));

  return { ok: errors.length === 0, mapping, rows, errors, unmapped };
}

// ---------- 导入预览 ----------

export interface ImportConflict {
  runId: string;
  existing: TrainingRun;
  incoming: TrainingRun;
}

export interface ImportPreview {
  mapping: MapHeadersResult;
  /** 新增且配置完整的记录。 */
  added: TrainingRun[];
  /** 新增但缺必要配置的记录：可保存，不能严格配对。 */
  incomplete: TrainingRun[];
  /** 相同 runId、相同内容（去重；元数据不参与内容判定）。 */
  duplicates: TrainingRun[];
  /** 相同 runId、不同内容：阻止整批提交，不覆盖旧实验。 */
  conflicts: ImportConflict[];
  errors: RowError[];
  unmapped: Array<{ header: string; values: string[] }>;
  /** true 时整批不可提交（映射未定、行错误或冲突）。 */
  blocking: boolean;
}

export interface PreviewOptions extends BuildOptions {
  existingRuns: readonly TrainingRun[];
}

function canonicalConfig(config: RunConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(config).sort()) {
    if (key === "extras") continue;
    out[key] = (config as Record<string, Cell>)[key];
  }
  if (config.extras) {
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(config.extras).sort()) extras[key] = config.extras[key];
    out.extras = extras;
  }
  return out;
}

/** 内容 = source + 规范配置 + 整数化准确率；实验编号/备注/导入时间不参与。 */
export function runContentKey(run: TrainingRun): string {
  return JSON.stringify({
    source: run.source,
    config: canonicalConfig(run.config),
    accuracy: toHundredths(run.metrics.accuracy),
  });
}

/** 纯函数预览：分类新增/重复/冲突/缺配置，确认前不写库。 */
export function previewImport(text: string, options: PreviewOptions): ImportPreview {
  const table = parseTable(text);
  const built = buildRuns(table, options);
  const projectExisting = options.existingRuns.filter((r) => r.projectId === options.projectId);
  const byId = new Map(projectExisting.map((r) => [r.runId, r]));

  const added: TrainingRun[] = [];
  const incomplete: TrainingRun[] = [];
  const duplicates: TrainingRun[] = [];
  const conflicts: ImportConflict[] = [];
  const seen = new Map<string, TrainingRun>();

  for (const { run, complete } of built.rows) {
    const prior = byId.get(run.runId) ?? seen.get(run.runId);
    if (prior) {
      if (runContentKey(prior) === runContentKey(run)) duplicates.push(run);
      else conflicts.push({ runId: run.runId, existing: prior, incoming: run });
      continue;
    }
    seen.set(run.runId, run);
    if (complete) added.push(run);
    else incomplete.push(run);
  }

  const blocking =
    built.mapping.status !== "ok" || built.errors.length > 0 || conflicts.length > 0;

  return {
    mapping: built.mapping,
    added,
    incomplete,
    duplicates,
    conflicts,
    errors: built.errors,
    unmapped: built.unmapped,
    blocking,
  };
}

// ---------- 配置差异 ----------

export interface ConfigDiffItem {
  field: string;
  oldValue: Cell;
  newValue: Cell;
}

/**
 * 用解析后的规范配置比较两条记录：返回字段、原值、新值（含未知项）。
 * 只比较训练配置列——准确率、运行名与元数据不算配置差异。
 * 未知项不写成一致：凡不能确认相等的都列出。
 */
export function diffRunConfigs(a: TrainingRun, b: TrainingRun): ConfigDiffItem[] {
  const keys = new Set([...configColumns(a.config), ...configColumns(b.config)]);
  const items: ConfigDiffItem[] = [];
  for (const key of keys) {
    const oldValue = cellAt(a.config, key) ?? "unknown";
    const newValue = cellAt(b.config, key) ?? "unknown";
    const equal =
      oldValue !== "unknown" && newValue !== "unknown" && oldValue === newValue;
    if (!equal) items.push({ field: key, oldValue, newValue });
  }
  return items;
}

export interface AccuracyObservation {
  direction: "提高" | "下降" | "未变";
  /** 如 "+2.00"。 */
  deltaPp: string;
  detail: string;
}

/** 观测差（百分点），整数化计算；与配置差异分开呈现。 */
export function observeAccuracyDelta(target: TrainingRun, baseline: TrainingRun): AccuracyObservation {
  const direction = compareAccuracy(target.metrics.accuracy, baseline.metrics.accuracy);
  const deltaH = toHundredths(target.metrics.accuracy) - toHundredths(baseline.metrics.accuracy);
  return {
    direction,
    deltaPp: formatDeltaPp(deltaH),
    detail: `${target.runId}=${target.metrics.accuracy} vs ${baseline.runId}=${baseline.metrics.accuracy} → ${direction} ${formatDeltaPp(deltaH)} 个百分点`,
  };
}

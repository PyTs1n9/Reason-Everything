// 表里有据 · 研究界面（卡 09）：外框 + 项目列表 + 项目内问题列表 + 新问题/数据录入。
// 纯 JS（无类型标注）；业务走正式服务动作；持久化 = IndexedDB「本机保存」。
import { createIndexedDBBackend, LOCAL_STORAGE_LABEL } from "./gen/src/experiment/storage-indexeddb.js";
import { createDataService } from "./gen/src/experiment/storage.js";
import { createWorkflowService } from "./gen/src/workflow/service.js";
import { buildEvidencePackage } from "./gen/src/experiment/evidence.js";
import { validateAccuracy } from "./gen/src/experiment/runs.js";
import { buildFactRegistry } from "./gen/src/agent/facts.js";
import {
  PROJECT_TYPES,
  buildQuestionMatrix,
  buildSideTree,
  computeDashboardStats,
  deriveLrOptions,
  describeCellId,
  evaluateEntryMissing,
  extractPaperTitle,
  filterProjects,
  formatAccuracy,
  formatUpdatedAt,
  highlightMatches,
  humanizeCellIds,
  modelGlyph,
  normalizeProjectType,
  parseProjectTypes,
  sortProjects,
  statusGlyph,
  typeColorClass,
  buildSaveModeInfo,
} from "./gen/src/web/model.js";
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  parseSidebarWidth,
  sidebarWidthFromKey,
} from "./gen/src/web/sidebar.js";
import { createLiteratureClient } from "./gen/src/web/literature.js";
import { extractPaperPages, generatePaperCandidates, PAPER_MODEL_PATH } from "./gen/src/web/paper-study.js";
import { locateInRegions, locateInTextItems } from "./gen/src/web/paper-locate.js";
import {
  pagesNeedingOcr,
  paperPageSource,
  readOcrRequest,
  requestPaperOcr,
  toPaperRegions,
} from "./gen/src/web/paper-ocr.js";

const DB_NAME = "agentflow-study";
const ACTOR = { userId: "local" };

const backend = createIndexedDBBackend(indexedDB, DB_NAME);
const data = createDataService(backend);
const wfDeps = { storage: data, agent: null, now: () => new Date().toISOString() };
const wf = createWorkflowService(wfDeps);
// 验收驱动口：仅允许注入模型适配器（wfDeps.agent 生产恒为 null=未接通），供离线 mock 驱动 UI 验收；
// 注入的输出以 provider=mock 标识展示，不冒充真实模型输出。
globalThis.__agentflow = { wfDeps };

const main = document.getElementById("main");
const topbarBack = document.getElementById("topbarBack");
const shell = document.querySelector(".shell");
const sidebar = document.getElementById("sidebar");
const navBtn = document.getElementById("navBtn");
const sidebarResizer = document.getElementById("sidebarResizer");
// ---------- 顶栏「本机保存」弹层（卡 18） ----------

const saveModeBtn = document.getElementById("saveMode");
const saveModePop = document.getElementById("saveModePop");
saveModeBtn.textContent = LOCAL_STORAGE_LABEL;

function closeSaveModePop(restoreFocus = false) {
  if (saveModePop.hidden) return;
  saveModePop.hidden = true;
  saveModeBtn.setAttribute("aria-expanded", "false");
  if (restoreFocus) saveModeBtn.focus();
}

async function openSaveModePop() {
  saveModePop.hidden = false;
  saveModeBtn.setAttribute("aria-expanded", "true");
  clear(saveModePop);
  saveModePop.append(h("p", { class: "aux", text: "读取中…" }));
  try {
    const projects = await wf.listProjects(ACTOR);
    const questionCount = projects.reduce((sum, project) => sum + project.questionCount, 0);
    const info = buildSaveModeInfo({
      adapterLabel: LOCAL_STORAGE_LABEL,
      dbName: DB_NAME,
      projectCount: projects.length,
      questionCount,
    });
    if (saveModePop.hidden) return;
    clear(saveModePop);
    const facts = h("dl");
    for (const row of info.rows) facts.append(h("dt", { text: row.label }), h("dd", { text: row.value }));
    saveModePop.append(facts, h("p", { class: "aux save-pop-note", text: info.note }));
  } catch (error) {
    if (saveModePop.hidden) return;
    clear(saveModePop);
    saveModePop.append(
      h("p", { class: "field-error", text: `读取失败：${error && error.message ? error.message : String(error)}` }),
    );
  }
}

saveModeBtn.addEventListener("click", () => {
  if (saveModePop.hidden) void openSaveModePop();
  else closeSaveModePop();
});

document.addEventListener("click", (event) => {
  if (saveModePop.hidden) return;
  if (saveModeBtn.contains(event.target) || saveModePop.contains(event.target)) return;
  closeSaveModePop();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !saveModePop.hidden) {
    event.preventDefault();
    closeSaveModePop(true);
  }
});

// ---------- 小工具 ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }
  return node;
}

function badge(status) {
  const { glyph, text } = statusGlyph(status);
  const shapeClass =
    status === "reviewable" ? "badge-reviewable" : status === "waiting_for_run" ? "badge-waiting" : "badge-needs";
  return h("span", { class: `badge ${shapeClass}` }, h("span", { class: "shape", "aria-hidden": "true", text: glyph }), text);
}

function modelBadge(status) {
  const { glyph, text } = modelGlyph(status);
  return h("span", { class: "badge" }, h("span", { class: "shape", "aria-hidden": "true", text: glyph }), text);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function shortId(id) {
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

// ---------- 轻提示 / 计数动画 / 本机 UI 元数据（卡 15） ----------

let toastTimer = null;

/** 右下角轻提示（role=status）；新提示替换旧提示。 */
function toast(message, kind = "") {
  if (toastTimer) clearTimeout(toastTimer);
  for (const node of [...document.querySelectorAll(".toast")]) node.remove();
  const node = h("div", { class: kind ? `toast toast-${kind}` : "toast", role: "status", text: message });
  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

/** 数字 count-up；降低动效偏好或 ≤0 直接显示终值。 */
function countUp(node, target) {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || target <= 0) {
    node.textContent = String(target);
    return;
  }
  const start = performance.now();
  const duration = 600;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    node.textContent = String(Math.round(target * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = String(target);
  };
  requestAnimationFrame(tick);
}

const PINNED_KEY = "agentflow-pinned-projects";
const PAPER_IMPORTS_KEY = "agentflow-paper-imports";

/** 置顶项目 ID 集合（UI 元数据，仅存本机 localStorage）。 */
function loadPinnedIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
    const list = Array.isArray(parsed) ? parsed : [];
    return new Set(list.filter((item) => typeof item === "string" && item));
  } catch {
    // localStorage 不可用/坏数据：置顶降级为无
    return new Set();
  }
}

function savePinnedIds(ids) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
  } catch {
    // 存不下只影响置顶保持
  }
}

/** 导入来源元数据（PDF/文献；projectId → 记录，界面溯源用，不入业务存储契约）。 */
function savePaperImport(projectId, record) {
  try {
    const raw = localStorage.getItem(PAPER_IMPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const map = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    map[projectId] = record;
    localStorage.setItem(PAPER_IMPORTS_KEY, JSON.stringify(map));
  } catch {
    // 存不下只影响溯源展示
  }
}

function readLegacyPaperImport(projectId) {
  const raw = localStorage.getItem(PAPER_IMPORTS_KEY);
  if (!raw) return null;
  const entry = JSON.parse(raw)?.[projectId];
  return entry?.source === "pdf" && entry.sha256 ? entry : null;
}

/** 删除项目时清理本机 UI 元数据（置顶/类型标签/导入溯源），业务存储契约不动。 */
function removeProjectLocalMeta(projectId) {
  const pinned = loadPinnedIds();
  if (pinned.delete(projectId)) savePinnedIds(pinned);
  try {
    const types = loadProjectTypes();
    if (projectId in types) {
      delete types[projectId];
      localStorage.setItem(PROJECT_TYPES_KEY, JSON.stringify(types));
    }
    const raw = localStorage.getItem(PAPER_IMPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && projectId in parsed) {
      delete parsed[projectId];
      localStorage.setItem(PAPER_IMPORTS_KEY, JSON.stringify(parsed));
    }
  } catch {
    // 清不掉只影响本机元数据，业务删除已完成
  }
}

async function sha256hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let pdfLibPromise = null;

/** 懒加载 vendored pdf.js（依赖冻结沿用既有 vendor，零新增依赖）。 */
function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("./vendor/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
      return lib;
    });
    pdfLibPromise.catch(() => {
      pdfLibPromise = null;
    });
  }
  return pdfLibPromise;
}

/** 弹窗通用行为：嵌套遮罩居中、Escape/遮罩关闭、Tab 焦点限制（卡 13 修复版式）。 */
function attachModalBehavior(overlay, modal, close) {
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = modal.querySelectorAll("button, input, select, textarea, a[href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  overlay.append(modal);
  document.body.append(overlay);
}

// ---------- 路由 ----------

function parseRoute() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "project" && parts[1]) return { view: "project", projectId: parts[1], page: Number(parts[2]) || 0 };
  if (parts[0] === "new" && parts[1]) return { view: "newQuestion", projectId: parts[1] };
  if (parts[0] === "question" && parts[1]) return { view: "question", questionId: parts[1] };
  return { view: "projects" };
}

let currentProjectId = null;

async function render() {
  const route = parseRoute();
  topbarBack.hidden = route.view !== "project";
  closeNav();
  closeSaveModePop();
  clear(main);
  try {
    if (route.view === "projects") await renderProjects();
    else if (route.view === "project") {
      currentProjectId = route.projectId;
      await renderProject(route.projectId, route.page);
    } else if (route.view === "newQuestion") {
      currentProjectId = route.projectId;
      await renderNewQuestion(route.projectId);
    } else if (route.view === "question") {
      await renderQuestion(route.questionId);
    }
  } catch (error) {
    main.append(
      h("div", { class: "notice notice-error", role: "alert", text: `加载失败：${error && error.message ? error.message : String(error)}` }),
    );
  }
  await renderSidebar(route);
}

// ---------- 侧栏（卡 13：知识库 → 项目文件夹 → 问题文档 的树状导航） ----------

/** 折叠状态存内存：刷新回到全展开（导航状态非业务数据）。 */
const collapsedProjectIds = new Set();

async function renderSidebar(route) {
  const nav = document.getElementById("sideNav");
  clear(nav);

  let activeProjectId = null;
  let activeQuestionId = null;
  if (route.view === "project" || route.view === "newQuestion") activeProjectId = route.projectId;
  if (route.view === "question") {
    activeQuestionId = route.questionId;
    const question = await data.getQuestion(ACTOR, route.questionId);
    if (question) activeProjectId = question.projectId;
  }
  // 当前项目所在文件夹默认展开，便于定位
  if (activeProjectId) collapsedProjectIds.delete(activeProjectId);

  const rootLink = h("a", { class: "side-link side-root", href: "#/", text: "📚 表里有据" });
  if (route.view === "projects") rootLink.setAttribute("aria-current", "page");
  nav.append(rootLink);

  const listBox = h("div", { class: "tree", role: "tree", "aria-label": "研究项目树" });
  nav.append(listBox);

  let tree;
  try {
    const projects = await wf.listProjects(ACTOR);
    const questionsByProject = {};
    for (const project of projects) {
      questionsByProject[project.projectId] = await data.listQuestions(ACTOR, project.projectId);
    }
    tree = buildSideTree(projects, questionsByProject);
  } catch (error) {
    listBox.append(
      h("p", { class: "aux tree-error", text: `导航加载失败：${error && error.message ? error.message : String(error)}` }),
    );
    return;
  }

  if (tree.length === 0) {
    listBox.append(h("p", { class: "aux tree-empty", text: "还没有研究项目" }));
    return;
  }

  for (const node of tree) {
    const expanded = !collapsedProjectIds.has(node.projectId);
    const childBox = h("div", { class: "tree-children", role: "group", hidden: !expanded });

    const toggle = h("button", {
      class: "tree-toggle",
      type: "button",
      "aria-expanded": String(expanded),
      "aria-label": `${expanded ? "折叠" : "展开"}项目 ${node.name}`,
      text: expanded ? "▾" : "▸",
    });
    const projectLink = h("a", {
      class: "side-link tree-project",
      href: `#/project/${node.projectId}`,
    }, "📁 ", node.name);
    if (activeProjectId === node.projectId) projectLink.setAttribute("aria-current", "page");

    toggle.addEventListener("click", () => {
      const nowExpanded = childBox.hidden;
      childBox.hidden = !nowExpanded;
      toggle.setAttribute("aria-expanded", String(nowExpanded));
      toggle.textContent = nowExpanded ? "▾" : "▸";
      toggle.setAttribute("aria-label", `${nowExpanded ? "折叠" : "展开"}项目 ${node.name}`);
      if (nowExpanded) collapsedProjectIds.delete(node.projectId);
      else collapsedProjectIds.add(node.projectId);
    });

    for (const question of node.questions) {
      const docLink = h("a", {
        class: "side-question tree-doc",
        href: `#/question/${question.questionId}`,
      }, "📄 ", question.label);
      if (activeQuestionId === question.questionId) docLink.setAttribute("aria-current", "page");
      childBox.append(docLink);
    }
    if (node.questions.length === 0) {
      childBox.append(h("span", { class: "aux tree-doc-empty", text: "暂无研究问题" }));
    }

    listBox.append(
      h("div", { class: "tree-node", role: "treeitem", "aria-expanded": String(expanded) },
        h("div", { class: "tree-row" }, toggle, projectLink),
        childBox,
      ),
    );
  }
}

// ---------- 视图 1：项目列表（卡 13/14：工作台面板 + 右上角搜索 + 居中新建弹窗 + 卡片网格） ----------

// Lucide 图标内联 SVG（ISC 许可图形，dependency 冻结不引 lucide-react，取其图标路径手绘内联）
const ICON_UPLOAD = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>';
const ICON_GLOBE = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
const ICON_PLUS = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const ICON_PIN = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const ICON_EDIT = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
const ICON_TRASH = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';

const ICON_PANEL_CLOSE = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 9-3 3 3 3"/></svg>';
const ICON_PANEL_OPEN = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m12 9 3 3-3 3"/></svg>';

/** 无搜索结果插画（内联 SVG，不引图形依赖）。 */
const ILLUSTRATION_EMPTY = '<svg viewBox="0 0 96 64" width="96" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="16" y="8" width="38" height="50" rx="4"/><line x1="24" y1="20" x2="46" y2="20"/><line x1="24" y1="28" x2="46" y2="28"/><line x1="24" y1="36" x2="38" y2="36"/><circle cx="66" cy="38" r="12"/><line x1="75" y1="47" x2="86" y2="58"/></svg>';

/** 载入等待骨架（3 张占位卡）。 */
function skeletonGrid() {
  const grid = h("div", { class: "project-grid", "aria-hidden": "true" });
  for (let i = 0; i < 3; i++) {
    grid.append(h("div", { class: "skeleton-card" },
      h("div", { class: "skeleton-bar skeleton-tag" }),
      h("div", { class: "skeleton-bar skeleton-name" }),
      h("div", { class: "skeleton-bar skeleton-meta" }),
    ));
  }
  return grid;
}

const PROJECT_TYPES_KEY = "agentflow-project-types";

/** 项目类型是界面元数据：Project 存储契约冻结（三字段），标签只存浏览器本机 localStorage。 */
function loadProjectTypes() {
  try {
    return parseProjectTypes(localStorage.getItem(PROJECT_TYPES_KEY));
  } catch {
    // localStorage 不可用（隐私模式等）：标签功能降级为「未分类」，列表本身不受影响
    return {};
  }
}

function saveProjectType(projectId, type) {
  const map = loadProjectTypes();
  map[projectId] = type;
  try {
    localStorage.setItem(PROJECT_TYPES_KEY, JSON.stringify(map));
  } catch {
    // 存不下只影响标签展示，不阻断创建流程
  }
}

async function renderProjects() {
  const searchInput = h("input", {
    type: "search",
    id: "projectSearch",
    name: "search",
    placeholder: "搜索项目（Ctrl K）",
    autocomplete: "off",
    "aria-label": "搜索项目，快捷键 Ctrl K",
  });
  const searchBox = h("div", { class: "search-box" },
    searchInput,
    h("kbd", { class: "search-kbd", "aria-hidden": "true", text: "Ctrl K" }),
  );
  const newProjectBtn = h("button", {
    class: "btn btn-primary btn-new-project",
    type: "button",
    id: "newProjectBtn",
  });
  newProjectBtn.insertAdjacentHTML("afterbegin", ICON_PLUS);
  newProjectBtn.append("新建项目");

  const importPdfBtn = h("button", { class: "btn btn-quiet", type: "button", id: "importPdfBtn" });
  importPdfBtn.insertAdjacentHTML("afterbegin", ICON_UPLOAD);
  importPdfBtn.append("导入 PDF");
  const fetchPaperBtn = h("button", { class: "btn btn-quiet", type: "button", id: "fetchPaperBtn" });
  fetchPaperBtn.insertAdjacentHTML("afterbegin", ICON_GLOBE);
  fetchPaperBtn.append("抓取文献");
  const pdfInput = h("input", {
    type: "file",
    id: "pdfFileInput",
    accept: "application/pdf,.pdf",
    hidden: true,
    "aria-hidden": "true",
    tabindex: "-1",
  });

  const kpiRow = h("div", { class: "kpi-row", id: "kpiRow", "aria-label": "工作台统计" });
  const hero = h("div", { class: "hero" },
    h("h1", { text: "研究项目" }),
    h("p", { class: "hero-sub", text: "记录实验归因主张，用对照证据回答「是不是真的」。" }),
    kpiRow,
    searchBox,
  );
  const panel = h("div", { class: "dash-panel" },
    h("div", { class: "quick-actions" }, importPdfBtn, fetchPaperBtn, newProjectBtn, pdfInput),
  );

  const gridHost = h("div", { id: "projectGridHost" });
  const emptyHost = h("div", { id: "projectEmptyHost" });
  const sectionTitle = h("h2", { class: "section-title", id: "recentTitle", text: "最近更新", hidden: true });
  main.append(hero, panel, sectionTitle, gridHost, emptyHost);

  let allProjects = [];
  let pinnedIds = loadPinnedIds();
  let flashProjectId = null;
  let enterGrid = true;

  let lastKpi = null;

  function renderKpis() {
    const stats = computeDashboardStats(allProjects, new Date().toISOString());
    const next = `${stats.projectCount}|${stats.questionCount}|${stats.weekUpdated}`;
    if (next === lastKpi) return;
    lastKpi = next;
    clear(kpiRow);
    for (const item of [
      { label: "项目", value: stats.projectCount },
      { label: "研究问题", value: stats.questionCount },
      { label: "近 7 天更新", value: stats.weekUpdated },
    ]) {
      const num = h("span", { class: "kpi-num", text: "0" });
      kpiRow.append(h("div", { class: "kpi" }, num, h("span", { class: "kpi-label", text: item.label })));
      countUp(num, item.value);
    }
  }

  function cardFor(project, index, animate) {
    const types = loadProjectTypes();
    const tag = types[project.projectId] ?? "未分类";
    const pinned = pinnedIds.has(project.projectId);
    const total = project.questionCount;
    const pending = project.pendingCount;
    const pct = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;

    const pinBtn = h("button", {
      class: "card-action",
      type: "button",
      "aria-pressed": String(pinned),
      "aria-label": `${pinned ? "取消置顶" : "置顶"}项目 ${project.name}`,
      title: pinned ? "取消置顶" : "置顶",
    });
    pinBtn.insertAdjacentHTML("afterbegin", ICON_PIN);
    pinBtn.addEventListener("click", () => {
      if (pinned) pinnedIds.delete(project.projectId);
      else pinnedIds.add(project.projectId);
      savePinnedIds(pinnedIds);
      toast(pinned ? `已取消置顶「${project.name}」` : `已置顶「${project.name}」`);
      updateGrid();
    });

    const renameBtn = h("button", {
      class: "card-action",
      type: "button",
      "aria-label": `重命名项目 ${project.name}`,
      title: "重命名",
    });
    renameBtn.insertAdjacentHTML("afterbegin", ICON_EDIT);
    renameBtn.addEventListener("click", async () => {
      openRenameProjectModal(project, renameBtn, async () => {
        allProjects = await wf.listProjects(ACTOR);
        await updateGrid();
        await renderSidebar(parseRoute());
      });
    });

    const deleteBtn = h("button", {
      class: "card-action card-action--danger",
      type: "button",
      "aria-label": `删除项目 ${project.name}`,
      title: "删除",
    });
    deleteBtn.insertAdjacentHTML("afterbegin", ICON_TRASH);
    deleteBtn.addEventListener("click", () => {
      openDeleteProjectModal(project, deleteBtn, async () => {
        allProjects = await wf.listProjects(ACTOR);
        await updateGrid();
        await renderSidebar(parseRoute());
      });
    });

    const nameNode = h("a", { class: "card-name", href: `#/project/${project.projectId}` },
      ...highlightMatches(project.name, searchInput.value).map((seg) =>
        seg.hit ? h("mark", { class: "card-hit", text: seg.text }) : seg.text),
    );

    return h("div", {
      class: animate ? "project-card project-card--enter" : "project-card",
      dataset: { projectId: project.projectId },
      style: `--card-i:${index}`,
    },
      h("div", { class: "card-top" },
        h("span", { class: `card-tag ${typeColorClass(tag)}`, text: tag }),
        h("div", { class: "card-actions" }, pinBtn, renameBtn, deleteBtn),
      ),
      nameNode,
      h("span", { class: "card-meta" },
        h("span", { class: "card-count", text: `研究问题 ${total}` }),
        h("span", { class: "card-pending", text: pending > 0 ? `待补跑 ${pending}` : "无待补跑" }),
        h("span", { class: "card-time", text: formatUpdatedAt(project.updatedAt) }),
      ),
      h("div", {
        class: "card-progress",
        role: "img",
        "aria-label": `研究问题 ${total} 个，其中待补跑 ${pending} 个`,
        title: `研究问题 ${total} 个，其中待补跑 ${pending} 个`,
      }, h("div", { class: "card-progress-bar", style: `width:${pct}%` })),
    );
  }

  async function updateGrid() {
    const query = searchInput.value;
    const list = sortProjects(filterProjects(allProjects, query), pinnedIds);
    clear(gridHost);
    clear(emptyHost);
    renderKpis();
    sectionTitle.hidden = allProjects.length === 0;

    if (allProjects.length === 0) {
      emptyHost.append(
        h("div", { class: "empty" },
          h("p", { text: "还没有研究项目" }),
          h("div", { class: "empty-actions" },
            h("button", { class: "btn btn-primary", type: "button", id: "emptyNewProject", text: "＋ 新建项目" }),
            h("button", { class: "btn", type: "button", id: "loadDemo", text: "载入演示项目" }),
          ),
        ),
      );
      document.getElementById("emptyNewProject").addEventListener("click", (event) => {
        openCreateProjectModal(event.currentTarget);
      });
      document.getElementById("loadDemo").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "载入中…";
        gridHost.append(skeletonGrid());
        try {
          const demo = await data.ensureDemoProject(ACTOR, new Date().toISOString());
          allProjects = await wf.listProjects(ACTOR);
          flashProjectId = demo.project.projectId;
          enterGrid = true;
          toast("演示项目已载入", "ok");
          await updateGrid();
          await renderSidebar(parseRoute());
        } catch (demoError) {
          clear(gridHost);
          toast(`载入失败：${demoError && demoError.message ? demoError.message : String(demoError)}`, "bad");
        } finally {
          // 按钮随空态/网格重绘被替换；若仍在 DOM 则恢复
          if (button.isConnected) {
            button.disabled = false;
            button.textContent = "载入演示项目";
          }
        }
      });
      return;
    }

    if (list.length === 0) {
      const illust = h("div", { class: "empty-illust", "aria-hidden": "true" });
      illust.insertAdjacentHTML("afterbegin", ILLUSTRATION_EMPTY);
      emptyHost.append(
        h("div", { class: "empty" },
          illust,
          h("p", { text: "没有匹配的项目" }),
        ),
      );
      return;
    }

    const grid = h("div", { class: "project-grid", id: "projectGrid" });
    const animate = enterGrid;
    enterGrid = false;
    list.forEach((project, index) => grid.append(cardFor(project, index, animate)));
    gridHost.append(grid);
    if (flashProjectId) {
      const node = grid.querySelector(`[data-project-id="${flashProjectId}"]`);
      flashProjectId = null;
      if (node) {
        node.classList.add("card-flash");
        setTimeout(() => node.classList.remove("card-flash"), 1400);
      }
    }
  }

  newProjectBtn.addEventListener("click", (event) => {
    openCreateProjectModal(event.currentTarget);
  });
  importPdfBtn.addEventListener("click", () => {
    pdfInput.click();
  });
  pdfInput.addEventListener("change", () => {
    const file = pdfInput.files && pdfInput.files[0];
    pdfInput.value = "";
    if (file) importPdfFile(file, importPdfBtn);
  });
  fetchPaperBtn.addEventListener("click", (event) => {
    openFetchPaperModal(event.currentTarget);
  });
  searchInput.addEventListener("input", () => {
    updateGrid();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && searchInput.value) {
      event.preventDefault();
      searchInput.value = "";
      updateGrid();
    }
  });

  allProjects = await wf.listProjects(ACTOR);
  await updateGrid();

  // Ctrl K：从其他视图跳回项目列表后聚焦搜索框
  if (pendingSearchFocus) {
    pendingSearchFocus = false;
    searchInput.focus();
    searchInput.select();
  }
}

/** 居中新建项目弹窗：项目名 + 项目类型；Escape/遮罩关闭，焦点限制在弹窗内。
 * options.prefillName 预填名称；options.paperMeta 创建成功后记入本机导入溯源（不入存储契约）。 */
function openCreateProjectModal(trigger, options = {}) {
  closeCreateProjectModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "projectModalOverlay" });
  const modal = h("div", {
    class: "modal",
    id: "projectModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "projectModalTitle",
    tabindex: "-1",
  });

  const nameInput = h("input", {
    type: "text",
    id: "newProjectName",
    name: "projectName",
    autocomplete: "off",
    placeholder: "如：数据增强归因",
    value: options.prefillName ?? "",
  });
  const typeSelect = h("select", { id: "newProjectType", name: "projectType" },
    ...PROJECT_TYPES.map((type) => h("option", { value: type, text: type })),
  );
  const error = h("p", { class: "field-error", id: "projectModalError", hidden: true });
  const confirmBtn = h("button", { class: "btn btn-primary", type: "button", id: "createProjectConfirm", text: "创建" });
  const cancelBtn = h("button", { class: "btn", type: "button", id: "createProjectCancel", text: "取消" });

  modal.append(
    h("h2", { id: "projectModalTitle", text: "新建项目" }),
    h("div", { class: "field" },
      h("label", { for: "newProjectName", text: "项目名" }),
      nameInput,
    ),
    h("div", { class: "field" },
      h("label", { for: "newProjectType", text: "项目类型" }),
      typeSelect,
    ),
    error,
    h("div", { class: "modal-actions" }, confirmBtn, cancelBtn),
  );

  createProjectModalState = { trigger, overlay, modal };

  const autoGenerate = options.paper ? paperGenerationChoice() : null;
  if (autoGenerate) modal.insertBefore(autoGenerate.label, error);

  confirmBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setAttribute("aria-invalid", "true");
      error.hidden = false;
      error.textContent = "请填写项目名";
      nameInput.focus();
      return;
    }
    nameInput.removeAttribute("aria-invalid");
    error.hidden = true;
    confirmBtn.disabled = true;
    try {
      const project = options.paper
        ? await data.importPaper(ACTOR, { name, paper: options.paper, now: new Date().toISOString(), file: options.paperFile })
        : await wf.createProject(ACTOR, name);
      saveProjectType(project.projectId, normalizeProjectType(typeSelect.value));
      if (options.paperMeta) savePaperImport(project.projectId, options.paperMeta);
      closeCreateProjectModal(false);
      location.hash = `#/project/${project.projectId}`;
      const ocrDone = options.ocrOptIn && options.paperFile
        ? startPaperOcr(project.projectId, options.paperFile.bytes, pagesNeedingOcr(options.paper), options.paper.sha256)
        : Promise.resolve();
      if (autoGenerate?.input.checked) {
        void ocrDone.then(async () => {
          const latest = await data.getPaperStudy(ACTOR, project.projectId);
          if (latest && paperHasReadableText(latest)) await startPaperGeneration(project.projectId, latest);
        }).catch((error) => toast(`生成失败：${error.message || String(error)}`, "bad"));
      }
    } catch (createError) {
      confirmBtn.disabled = false;
      error.hidden = false;
      error.textContent = `创建失败：${createError && createError.message ? createError.message : String(createError)}`;
    }
  });
  cancelBtn.addEventListener("click", () => closeCreateProjectModal());
  // 弹窗嵌套在遮罩内才受 flex 居中；仅点遮罩本体才关闭
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeCreateProjectModal();
  });

  const trap = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCreateProjectModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = modal.querySelectorAll("button, input, select, a[href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener("keydown", trap);

  // 弹窗必须是遮罩的子节点：遮罩是 fixed flex 容器，兄弟节点不受其居中约束
  overlay.append(modal);
  document.body.append(overlay);
  nameInput.focus();
}

let createProjectModalState = null;

function closeCreateProjectModal(restoreFocus = true) {
  const current = createProjectModalState;
  if (!current) return;
  current.overlay.remove();
  current.modal.remove();
  createProjectModalState = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

// ---------- 导入 PDF ----------

async function importPdfFile(file, trigger, restore = null) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast("只支持 PDF 文件", "bad");
    return;
  }
  if (trigger) trigger.disabled = true;
  toast(`正在本地解析：${file.name}`);
  try {
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256hex(buffer.slice(0));
    if (restore?.meta && sha256 !== restore.meta.sha256) throw new Error("请选择该项目当时导入的原始 PDF");
    const pdfjsLib = await loadPdfLib();
    const task = pdfjsLib.getDocument({
      data: buffer.slice(0),
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url).href,
    });
    let pages;
    let metaTitle = "";
    try {
      const pdf = await task.promise;
      const meta = await pdf.getMetadata();
      metaTitle = String(meta?.info?.Title ?? "").trim();
      pages = await extractPaperPages(pdf);
    } finally {
      await task.destroy();
    }
    const textChars = pages.reduce((sum, text) => sum + Array.from(text).length, 0);
    const title = restore?.meta?.title || extractPaperTitle({ metaTitle, firstPageText: pages[0] ?? "" });
    const paper = {
      filename: file.name,
      pages,
      sha256,
      title,
      pageSources: pages.map((text) => text.trim() ? "text" : "pending"),
      pageErrors: pages.map(() => ""),
      pageRegions: pages.map(() => []),
    };
    openImportResultModal({ file, bytes: new Uint8Array(buffer), paper, textChars, title, sha256, trigger, restore });
  } catch (error) {
    toast(`解析失败：${error && error.message ? error.message : String(error)}`, "bad");
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

function bindPdfImport(button, restore) {
  const input = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    if (file) void importPdfFile(file, button, restore);
  });
  return input;
}

let importModalState = null;

function openImportResultModal({ file, bytes, paper, textChars, title, sha256, trigger, restore }) {
  closeImportResultModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "importModalOverlay" });
  const modal = h("div", {
    class: "modal modal--wide",
    id: "importModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "importModalTitle",
    tabindex: "-1",
  });

  const titleInput = h("input", { type: "text", id: "importPaperTitle", value: title, maxlength: 500, autocomplete: "off" });
  const preview = h("p", {
    class: "import-preview",
    text: (paper.pages[0] ?? "").slice(0, 600) || "（首页无文本，可先保存原版后做 OCR）",
  });

  const copyBtn = h("button", { class: "btn", type: "button", id: "importCopyText", text: "复制首页文本" });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(paper.pages[0] ?? "");
      copyBtn.textContent = "已复制";
    } catch {
      copyBtn.textContent = "复制失败，请手动选取";
    }
    setTimeout(() => {
      copyBtn.textContent = "复制首页文本";
    }, 2000);
  });

  const pendingPages = pagesNeedingOcr(paper);
  const ocrOptIn = h("input", { type: "checkbox", id: "importPaperOcr", disabled: pendingPages.length === 0 });
  const ocrChoice = h("label", { class: "paper-opt-in", for: ocrOptIn.id }, ocrOptIn,
    pendingPages.length ? `发送 ${pendingPages.length} 页待识别内容到 OCR 服务（扫描页）` : "所有页面已有文字层，无需 OCR");
  const autoGenerate = restore ? paperGenerationChoice() : null;
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const useBtn = h("button", {
    class: "btn btn-primary", type: "button", id: "importUseTitle", text: restore ? "补录到当前项目" : "用 PDF 新建项目",
  });
  useBtn.addEventListener("click", async () => {
    const nextName = titleInput.value.trim() || file.name.replace(/\.pdf$/i, "");
    const nextPaper = { ...paper, title: nextName };
    const paperFile = { filename: file.name, sha256, bytes };
    if (restore) {
      useBtn.disabled = true;
      error.hidden = true;
      try {
        await data.importPaper(ACTOR, { name: nextName, paper: nextPaper, now: new Date().toISOString(), projectId: restore.projectId, file: paperFile });
        closeImportResultModal(false);
        const ocrDone = ocrOptIn.checked
          ? startPaperOcr(restore.projectId, bytes, pendingPages, sha256)
          : Promise.resolve();
        if (autoGenerate.input.checked) {
          void ocrDone.then(async () => {
            const latest = await data.getPaperStudy(ACTOR, restore.projectId);
            if (latest && paperHasReadableText(latest)) await startPaperGeneration(restore.projectId, latest);
          }).catch((saveError) => toast(`生成失败：${saveError.message || String(saveError)}`, "bad"));
        }
        if (parseRoute().projectId === restore.projectId) await render();
      } catch (saveError) {
        error.hidden = false;
        error.textContent = saveError.message;
        useBtn.disabled = false;
      }
      return;
    }
    closeImportResultModal(false);
    openCreateProjectModal(trigger, { prefillName: nextName, paper: nextPaper, paperFile, ocrOptIn: ocrOptIn.checked });
  });
  const closeBtn = h("button", { class: "btn", type: "button", id: "importClose", text: "关闭" });
  closeBtn.addEventListener("click", () => closeImportResultModal());

  modal.append(
    h("h2", { id: "importModalTitle", text: "PDF 已本地解析" }),
    h("dl", { class: "import-facts" },
      h("dt", { text: "文件" }),
      h("dd", { text: file.name }),
      h("dt", { text: "页数" }),
      h("dd", { text: String(paper.pages.length) }),
      h("dt", { text: "待 OCR" }),
      h("dd", { text: pendingPages.length ? `${pendingPages.length} 页` : "0 页" }),
      h("dt", { text: "字符数" }),
      h("dd", { text: String(textChars) }),
      h("dt", { text: "SHA-256" }),
      h("dd", { class: "mono", text: shortId(sha256) }),
    ),
    h("div", { class: "field" },
      h("label", { for: "importPaperTitle", text: "文献题名" }),
      titleInput,
    ),
    h("div", { class: "field" },
      h("span", { class: "aux", text: "首页预览 · 项目会保存各页的可提取文字" }),
      preview,
    ),
    ...(autoGenerate ? [autoGenerate.label] : []),
    ocrChoice,
    error,
    h("div", { class: "modal-actions" }, copyBtn, useBtn, closeBtn),
  );

  importModalState = { trigger, overlay };
  attachModalBehavior(overlay, modal, closeImportResultModal);
  titleInput.focus();
  titleInput.select();
}

function closeImportResultModal(restoreFocus = true) {
  const current = importModalState;
  if (!current) return;
  current.overlay.remove();
  importModalState = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

const paperOcrJobs = new Map();

async function renderPaperPageImage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 1800 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: context, viewport }).promise;
  return {
    page: pageNumber,
    image: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    rotation: page.rotate ?? 0,
  };
}

function startPaperOcr(projectId, bytes, pageNumbers, sha256) {
  const jobKey = `${projectId}:${sha256}`;
  const existing = paperOcrJobs.get(jobKey);
  if (existing?.running) return existing.promise;
  const pages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const job = { running: true, current: 0, total: pages.length, text: "正在准备 OCR…", error: "" };
  const onProject = () => parseRoute().view === "project" && parseRoute().projectId === projectId;
  const promise = (async () => {
    if (!pages.length) return;
    const pdfjsLib = await loadPdfLib();
    const task = pdfjsLib.getDocument({
      data: bytes.slice(),
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url).href,
    });
    try {
      const pdf = await task.promise;
      for (const page of pages) {
        job.current = page;
        job.text = `正在识别第 ${page} 页…`;
        if (onProject()) await render();
        try {
          const image = await renderPaperPageImage(pdf, page);
          const result = await requestPaperOcr(readOcrRequest(image));
          await data.updatePaperPageOcr(ACTOR, {
            projectId,
            sha256,
            now: new Date().toISOString(),
            update: { page, ok: true, text: result.text, regions: toPaperRegions(result) },
          });
        } catch (error) {
          await data.updatePaperPageOcr(ACTOR, {
            projectId,
            sha256,
            now: new Date().toISOString(),
            update: { page, ok: false, error: error.message || String(error) },
          });
        }
        if (onProject()) await render();
      }
      job.text = `OCR 完成：已处理 ${pages.length} 页`;
    } finally {
      await task.destroy();
    }
  })().catch((error) => {
    job.error = error.message || String(error);
    job.text = job.error;
  }).finally(() => {
    job.running = false;
    if (onProject()) void render();
  });
  job.promise = promise;
  paperOcrJobs.set(jobKey, job);
  return promise;
}

let pdfViewerState = null;

function closePdfViewer(restoreFocus = true) {
  const current = pdfViewerState;
  if (!current) return;
  current.closed = true;
  current.seq += 1;
  if (current.task) void current.task.destroy();
  current.overlay.remove();
  pdfViewerState = null;
  if (restoreFocus && current.trigger?.isConnected) current.trigger.focus();
}

async function openPdfViewer(paper, file, pageNumber, quote = null, trigger = null) {
  if (!file) {
    toast("请先补传原 PDF，才能查看原版页面", "bad");
    return false;
  }
  closePdfViewer(false);
  const overlay = h("div", { class: "modal-overlay pdf-overlay", id: "pdfViewerOverlay" });
  const modal = h("div", {
    class: "modal modal--pdf",
    id: "pdfViewer",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "pdfViewerTitle",
    tabindex: "-1",
  });
  const title = h("h2", { id: "pdfViewerTitle", text: paper.title || paper.filename });
  const precision = h("p", { class: "pdf-precision", id: "pdfPrecision", role: "status", text: "正在打开原版页面…" });
  const prev = h("button", { class: "btn", type: "button", id: "pdfPrev", text: "上一页" });
  const next = h("button", { class: "btn", type: "button", id: "pdfNext", text: "下一页" });
  const zoomOut = h("button", { class: "btn", type: "button", id: "pdfZoomOut", text: "−" });
  const zoomIn = h("button", { class: "btn", type: "button", id: "pdfZoomIn", text: "+" });
  const fit = h("button", { class: "btn", type: "button", id: "pdfFit", text: "适合宽度" });
  const close = h("button", { class: "btn", type: "button", id: "pdfClose", text: "关闭" });
  const toolbar = h("div", { class: "pdf-toolbar" }, prev, next, zoomOut, zoomIn, fit, close);
  const stage = h("div", { class: "pdf-stage", id: "pdfStage" });
  const pageHost = h("div", { class: "pdf-page", id: "pdfPage" });
  const canvas = h("canvas", { id: "pdfCanvas", "aria-label": "原版 PDF 页面" });
  const highlights = h("div", { class: "pdf-highlights", id: "pdfHighlights", "aria-hidden": "true" });
  const quoteBox = h("blockquote", { class: "pdf-quote", hidden: !quote, text: quote ?? "" });
  pageHost.append(canvas, highlights);
  stage.append(pageHost);
  modal.append(
    h("header", { class: "pdf-head" }, title, precision),
    toolbar,
    stage,
    quoteBox,
  );
  attachModalBehavior(overlay, modal, () => closePdfViewer());
  const state = {
    overlay,
    trigger,
    task: null,
    pdf: null,
    page: Math.min(paper.pages.length, Math.max(1, pageNumber)),
    quote,
    zoom: null,
    seq: 0,
    closed: false,
  };
  pdfViewerState = state;
  close.addEventListener("click", () => closePdfViewer());
  close.focus();

  const draw = async () => {
    if (!state.pdf || state.closed) return;
    const seq = ++state.seq;
    const page = await state.pdf.getPage(state.page);
    const base = page.getViewport({ scale: 1 });
    if (state.zoom === null) state.zoom = Math.min(2.5, Math.max(0.5, (stage.clientWidth - 48) / base.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: state.zoom * dpr });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    pageHost.style.width = canvas.style.width;
    pageHost.style.height = canvas.style.height;
    clear(highlights);
    precision.textContent = `第 ${state.page} / ${paper.pages.length} 页 · 正在渲染…`;
    const render = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
    await render.promise;
    if (state.closed || seq !== state.seq) return;
    let located = null;
    if (state.quote) {
      const source = paperPageSource(paper, state.page - 1);
      if (source === "ocr" && paper.pageRegions?.[state.page - 1]?.length) {
        located = locateInRegions(paper.pageRegions[state.page - 1], state.quote);
      } else {
        const content = await page.getTextContent();
        if (state.closed || seq !== state.seq) return;
        located = locateInTextItems(content.items, state.quote, viewport);
      }
      for (const rect of located.rects) {
        highlights.append(h("div", {
          class: "pdf-highlight",
          style: `left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%`,
        }));
      }
    }
    precision.textContent = `第 ${state.page} / ${paper.pages.length} 页${located ? ` · ${located.reason}` : " · 原版页面"}`;
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= paper.pages.length;
  };

  const redraw = () => {
    void draw().catch((error) => {
      if (!state.closed) precision.textContent = `原版页面渲染失败：${error.message || String(error)}`;
    });
  };

  prev.addEventListener("click", () => {
    if (state.page > 1) state.page -= 1;
    redraw();
  });
  next.addEventListener("click", () => {
    if (state.page < paper.pages.length) state.page += 1;
    redraw();
  });
  zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(0.4, (state.zoom ?? 1) - 0.2);
    redraw();
  });
  zoomIn.addEventListener("click", () => {
    state.zoom = Math.min(4, (state.zoom ?? 1) + 0.2);
    redraw();
  });
  fit.addEventListener("click", () => {
    state.zoom = null;
    redraw();
  });

  try {
    const pdfjsLib = await loadPdfLib();
    state.task = pdfjsLib.getDocument({
      data: file.bytes.slice(),
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url).href,
    });
    state.pdf = await state.task.promise;
    if (!state.closed) await draw();
  } catch (error) {
    if (!state.closed) precision.textContent = `原版页面打开失败：${error.message || String(error)}`;
  }
  return true;
}

// ---------- 卡片操作：重命名 ----------

let renameModalState = null;

function openRenameProjectModal(project, trigger, onRenamed) {
  closeRenameProjectModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "renameModalOverlay" });
  const modal = h("div", {
    class: "modal",
    id: "renameModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "renameModalTitle",
    tabindex: "-1",
  });

  const nameInput = h("input", {
    type: "text",
    id: "renameProjectInput",
    value: project.name,
    autocomplete: "off",
  });
  const error = h("p", { class: "field-error", id: "renameModalError", hidden: true });
  const confirmBtn = h("button", { class: "btn btn-primary", type: "button", text: "保存" });
  const cancelBtn = h("button", { class: "btn", type: "button", text: "取消" });

  modal.append(
    h("h2", { id: "renameModalTitle", text: "重命名项目" }),
    h("div", { class: "field" },
      h("label", { for: "renameProjectInput", text: "项目名" }),
      nameInput,
    ),
    error,
    h("div", { class: "modal-actions" }, confirmBtn, cancelBtn),
  );

  confirmBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setAttribute("aria-invalid", "true");
      error.hidden = false;
      error.textContent = "请填写项目名";
      nameInput.focus();
      return;
    }
    nameInput.removeAttribute("aria-invalid");
    error.hidden = true;
    confirmBtn.disabled = true;
    try {
      await data.renameProject(ACTOR, project.projectId, name, new Date().toISOString());
      closeRenameProjectModal(false);
      toast(`已重命名为「${name}」`, "ok");
      if (onRenamed) await onRenamed();
    } catch (renameError) {
      confirmBtn.disabled = false;
      error.hidden = false;
      error.textContent = `重命名失败：${renameError && renameError.message ? renameError.message : String(renameError)}`;
    }
  });
  cancelBtn.addEventListener("click", () => closeRenameProjectModal());

  renameModalState = { trigger, overlay };
  attachModalBehavior(overlay, modal, closeRenameProjectModal);
  nameInput.focus();
  nameInput.select();
}

function closeRenameProjectModal(restoreFocus = true) {
  const current = renameModalState;
  if (!current) return;
  current.overlay.remove();
  renameModalState = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

// ---------- 卡片操作：删除（二级确认，级联语义见 storage.deleteProject） ----------

let deleteModalState = null;

function openDeleteProjectModal(project, trigger, onDeleted) {
  closeDeleteProjectModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "deleteModalOverlay" });
  const modal = h("div", {
    class: "modal",
    id: "deleteModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "deleteModalTitle",
    tabindex: "-1",
  });

  const confirmBtn = h("button", {
    class: "btn btn-danger",
    type: "button",
    id: "deleteProjectConfirm",
    text: "确认删除",
  });
  const cancelBtn = h("button", { class: "btn", type: "button", id: "deleteProjectCancel", text: "取消" });
  const error = h("p", { class: "field-error", id: "deleteModalError", hidden: true });

  modal.append(
    h("h2", { id: "deleteModalTitle", text: "删除项目" }),
    h("p", {
      class: "modal-warn",
      text: `将删除项目「${project.name}」（研究问题 ${project.questionCount} 个），`
        + "并连带清除其下全部研究问题、实验记录与分析版本。此操作不可恢复。",
    }),
    error,
    h("div", { class: "modal-actions" }, confirmBtn, cancelBtn),
  );

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await data.deleteProject(ACTOR, project.projectId);
      removeProjectLocalMeta(project.projectId);
      closeDeleteProjectModal(false);
      toast(`已删除「${project.name}」`, "ok");
      if (onDeleted) await onDeleted();
    } catch (deleteError) {
      confirmBtn.disabled = false;
      error.hidden = false;
      error.textContent = `删除失败：${deleteError && deleteError.message ? deleteError.message : String(deleteError)}`;
    }
  });
  cancelBtn.addEventListener("click", () => closeDeleteProjectModal());

  deleteModalState = { trigger, overlay };
  attachModalBehavior(overlay, modal, closeDeleteProjectModal);
  cancelBtn.focus();
}

function closeDeleteProjectModal(restoreFocus = true) {
  const current = deleteModalState;
  if (!current) return;
  current.overlay.remove();
  deleteModalState = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

// ---------- 抓取文献（Crossref 公共 API，仅取元数据不取全文） ----------

let fetchModalState = null;

function openFetchPaperModal(trigger) {
  closeFetchPaperModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "fetchModalOverlay" });
  const modal = h("div", {
    class: "modal modal--wide",
    id: "fetchModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "fetchModalTitle",
    tabindex: "-1",
  });

  const client = createLiteratureClient((url, init) => fetch(url, init));
  const doiInput = h("input", {
    type: "text",
    id: "fetchDoi",
    autocomplete: "off",
    placeholder: "如 10.1234/abcde",
    "aria-label": "DOI",
  });
  const doiBtn = h("button", { class: "btn btn-primary", type: "button", id: "fetchDoiBtn", text: "按 DOI 抓取" });
  const queryInput = h("input", {
    type: "text",
    id: "fetchQuery",
    autocomplete: "off",
    placeholder: "标题关键词",
    "aria-label": "标题关键词",
  });
  const queryBtn = h("button", { class: "btn", type: "button", id: "fetchQueryBtn", text: "按标题检索" });
  const status = h("p", { class: "aux fetch-status", role: "status" });
  const results = h("div", { class: "fetch-results" });
  const closeBtn = h("button", { class: "btn", type: "button", id: "fetchClose", text: "关闭" });

  function fetchItem(info) {
    const useBtn = h("button", { class: "btn btn-primary", type: "button", text: "用此文献新建项目" });
    const item = h("div", { class: "fetch-item" },
      h("p", { class: "fetch-item-title", text: info.title }),
      h("p", { class: "aux", text: [info.authors, info.year, info.venue].filter(Boolean).join(" · ") || "（缺作者/年份/出处）" }),
      h("p", { class: "aux mono", text: info.doi ? `DOI ${info.doi}` : "无 DOI" }),
      h("div", { class: "suggestion-actions" }, useBtn),
    );
    useBtn.addEventListener("click", () => {
      closeFetchPaperModal(false);
      openCreateProjectModal(trigger, {
        prefillName: info.title,
        paperMeta: {
          source: "crossref",
          doi: info.doi,
          title: info.title,
          authors: info.authors,
          year: info.year,
          venue: info.venue,
        },
      });
    });
    return item;
  }

  async function runFetch(button, action) {
    button.disabled = true;
    status.classList.remove("fetch-error");
    status.textContent = "抓取中…";
    clear(results);
    try {
      const list = await action();
      for (const info of list) results.append(fetchItem(info));
      status.textContent = list.length > 0 ? `共 ${list.length} 条结果` : "没有找到匹配文献";
    } catch (error) {
      status.textContent = error && error.message ? error.message : String(error);
      status.classList.add("fetch-error");
    } finally {
      button.disabled = false;
    }
  }

  doiBtn.addEventListener("click", () => {
    runFetch(doiBtn, async () => [await client.fetchByDoi(doiInput.value)]);
  });
  queryBtn.addEventListener("click", () => {
    runFetch(queryBtn, () => client.searchByTitle(queryInput.value));
  });
  doiInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      doiBtn.click();
    }
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      queryBtn.click();
    }
  });
  closeBtn.addEventListener("click", () => closeFetchPaperModal());

  modal.append(
    h("h2", { id: "fetchModalTitle", text: "抓取文献" }),
    h("p", { class: "aux", text: "来源 Crossref 公共接口，仅获取文献元数据（题名/作者/年份/出处），不抓取全文。" }),
    h("div", { class: "parse-line" },
      h("div", { class: "field" },
        h("label", { for: "fetchDoi", text: "DOI 精确查询" }),
        doiInput,
      ),
      doiBtn,
    ),
    h("div", { class: "parse-line" },
      h("div", { class: "field" },
        h("label", { for: "fetchQuery", text: "标题关键词检索" }),
        queryInput,
      ),
      queryBtn,
    ),
    status,
    results,
    h("div", { class: "modal-actions" }, closeBtn),
  );

  fetchModalState = { trigger, overlay };
  attachModalBehavior(overlay, modal, closeFetchPaperModal);
  doiInput.focus();
}

function closeFetchPaperModal(restoreFocus = true) {
  const current = fetchModalState;
  if (!current) return;
  current.overlay.remove();
  fetchModalState = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

/** Ctrl K 全局快捷键：任意视图聚焦项目搜索（不在项目列表则先跳回）。 */
let pendingSearchFocus = false;

window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
  event.preventDefault();
  const input = document.getElementById("projectSearch");
  if (input) {
    input.focus();
    input.select();
    return;
  }
  pendingSearchFocus = true;
  if (location.hash === "#/" || location.hash === "") render();
  else location.hash = "#/";
});

// ---------- 视图 2：项目详情 ----------

function paperGenerationChoice() {
  const input = h("input", { type: "checkbox", checked: true });
  return { input, label: h("label", { class: "paper-opt-in" }, input, "自动生成研究问题（逐批将论文文字发送给模型服务）") };
}

function paperHasReadableText(paper) {
  return paper.pages.some((text, index) => {
    const source = paper.pageSources?.[index] ?? (text.trim() ? "text" : "pending");
    return (source === "text" || source === "ocr") && text.trim();
  });
}

const paperJobs = new Map();

async function requestPaperModel(input) {
  const response = await fetch(PAPER_MODEL_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(70_000),
  });
  if (response.status === 404 || response.status === 405 || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("站点的论文模型接口未接通，全文已保存在本机");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `论文模型请求失败（HTTP ${response.status}）`);
  if (typeof result.text !== "string" || typeof result.model !== "string") throw new Error("论文模型返回格式无效");
  return result;
}

async function startPaperGeneration(projectId, paper) {
  if (paperJobs.get(projectId)?.running) return;
  const job = { running: true, text: "正在准备论文文字…" };
  paperJobs.set(projectId, job);
  const onProject = () => parseRoute().view === "project" && parseRoute().projectId === projectId;
  try {
    const generate = async () => {
      const current = await data.getPaperStudy(ACTOR, projectId);
      if (current?.generation?.candidates.length) return;
      const generated = await generatePaperCandidates(current ?? paper, requestPaperModel, (batch) => {
        job.text = `模型正在阅读第 ${batch} 批论文文字…`;
        const status = document.getElementById("paperGenerationStatus");
        if (onProject() && status) status.textContent = job.text;
      });
      await data.savePaperCandidates(ACTOR, projectId, generated);
    };
    if (navigator.locks) await navigator.locks.request(`paper-model-${projectId}`, generate);
    else await generate();
    paperJobs.delete(projectId);
  } catch (error) {
    paperJobs.set(projectId, { running: false, text: error.message });
  }
  if (onProject()) await render();
}

function renderPaperEvidence(paper, candidate, storedFile = null) {
  const citations = h("ul", { class: "paper-citations" });
  for (const evidence of candidate.citations) {
    const sourceLink = h("a", { href: `#/project/${paper.projectId}/${evidence.page}`, text: `PDF 第 ${evidence.page} 页` });
    sourceLink.addEventListener("click", async (event) => {
      event.preventDefault();
      const file = storedFile ?? await data.getPaperFile(ACTOR, paper.projectId, paper.sha256);
      if (!file) {
        toast("请先补传原 PDF，才能查看原版页面", "bad");
        location.hash = `#/project/${paper.projectId}/${evidence.page}`;
        return;
      }
      await openPdfViewer(paper, file, evidence.page, evidence.quote, sourceLink);
    });
    citations.append(h("li", {}, sourceLink, h("blockquote", { text: evidence.quote })));
  }
  return [
    h("dl", { class: "import-facts" },
      h("dt", { text: "待检验主张" }), h("dd", { text: candidate.claim }),
      h("dt", { text: "研究价值" }), h("dd", { text: candidate.rationale }),
      h("dt", { text: "验证方法" }), h("dd", { text: candidate.verification }),
    ),
    citations,
  ];
}

function renderPaperOcrPanel(paper, file) {
  const needing = pagesNeedingOcr(paper);
  const counts = { text: 0, ocr: 0, pending: 0, failed: 0 };
  paper.pages.forEach((_, index) => {
    counts[paperPageSource(paper, index)] += 1;
  });
  const labels = { text: "文字层", ocr: "OCR", pending: "待识别", failed: "识别失败" };
  const job = paperOcrJobs.get(`${paper.projectId}:${paper.sha256}`);
  const reupload = h("button", { class: "btn", type: "button", text: "补传原 PDF" });
  const reuploadInput = bindPdfImport(reupload, { projectId: paper.projectId, meta: { sha256: paper.sha256, title: paper.title } });
  if (!file) {
    return h("section", { class: "ocr-panel", "aria-labelledby": "ocrPanelTitle" },
      h("div", { class: "ocr-panel-head" },
        h("div", {},
          h("h3", { id: "ocrPanelTitle", text: "原版与扫描识别" }),
          h("p", { class: "aux", text: "旧记录未保存 PDF 字节。补传同一原文件后可查看原版页面和精确高亮，已有问题与引文不会丢失。" }),
        ),
        h("div", { class: "empty-actions" }, reupload, reuploadInput),
      ),
    );
  }
  const runAll = h("button", {
    class: "btn btn-primary",
    type: "button",
    disabled: !needing.length || job?.running,
    text: job?.running ? "识别中…" : `识别全部待识别页（${needing.length}）`,
  });
  runAll.addEventListener("click", () => startPaperOcr(paper.projectId, file.bytes, needing, paper.sha256));
  const rows = h("ul", { class: "ocr-page-list" },
    ...paper.pages.map((_, index) => {
      const source = paperPageSource(paper, index);
      const error = paper.pageErrors?.[index] || "";
      const retry = h("button", {
        class: "btn btn-small",
        type: "button",
        disabled: source === "text" || source === "ocr" || job?.running,
        text: source === "failed" ? "重试" : "识别",
      });
      retry.addEventListener("click", () => startPaperOcr(paper.projectId, file.bytes, [index + 1], paper.sha256));
      return h("li", { class: `ocr-page-row is-${source}` },
        h("span", { class: "ocr-page-no", text: `第 ${index + 1} 页` }),
        h("span", { class: `status-badge is-${source}`, text: labels[source] }),
        error
          ? h("span", { class: "ocr-page-error", text: error })
          : h("span", { class: "ocr-page-detail", text: source === "text" ? "无需 OCR" : source === "ocr" ? "已保存识别文字与区域" : "尚未取得可用文字" }),
        retry,
      );
    }),
  );
  const status = h("p", {
    class: job?.error ? "field-error" : "aux",
    role: "status",
    text: job?.running ? `${job.text}（第 ${job.current} / ${job.total} 页）` : job?.error || job?.text || "仅发送没有可用文字层的页面；单页失败不会影响其他页。",
  });
  return h("section", { class: "ocr-panel", "aria-labelledby": "ocrPanelTitle" },
    h("div", { class: "ocr-panel-head" },
      h("div", {},
        h("h3", { id: "ocrPanelTitle", text: "原版与扫描识别" }),
        h("p", { class: "aux", text: `文字层 ${counts.text} · OCR ${counts.ocr} · 待识别 ${counts.pending} · 失败 ${counts.failed}` }),
      ),
      runAll,
    ),
    status,
    h("details", { class: "ocr-details", open: needing.length > 0 },
      h("summary", { text: "逐页状态与单页重试" }),
      rows,
    ),
    h("div", { class: "empty-actions" }, reupload, reuploadInput),
  );
}

function renderPaperStudy(paper, initialPage, file = null) {
  const statusLabels = { text: "文字层", ocr: "OCR", pending: "待识别", failed: "识别失败" };
  const readable = paper.pages.filter((text, index) => {
    const source = paperPageSource(paper, index);
    return (source === "text" || source === "ocr") && text.trim();
  }).length;
  const pagePicker = h("select", { "aria-label": "PDF 页码", id: "paperPage" },
    paper.pages.map((text, index) => h("option", {
      value: index + 1,
      text: `第 ${index + 1} 页 · ${statusLabels[paperPageSource(paper, index)]}${text.trim() ? "" : " · 无可读文字"}`,
    })),
  );
  const pageText = h("div", { class: "import-preview paper-page-text", tabindex: "0", "aria-label": "当前页正文" });
  const originalBtn = file ? h("button", { class: "btn", type: "button", text: "查看原版" }) : null;
  let currentPage = paper.pages[initialPage - 1] !== undefined ? initialPage : 1;
  originalBtn?.addEventListener("click", () => openPdfViewer(paper, file, currentPage, null, originalBtn));
  const job = paperJobs.get(paper.projectId);
  const generation = paper.generation;
  const candidates = h("section", { class: "panel paper-candidates", "aria-labelledby": "paperCandidatesTitle" },
    h("h2", { id: "paperCandidatesTitle", text: "候选研究问题" }),
  );
  const body = h("div", { class: "paper-study" },
    h("section", { class: "panel", "aria-labelledby": "paperStudyTitle" },
      h("h2", { id: "paperStudyTitle", text: "项目文献" }),
      h("h3", { text: paper.title }),
      h("p", { class: "aux", text: `${paper.filename} · ${readable}/${paper.pages.length} 页有可提取文字` }),
      renderPaperOcrPanel(paper, file),
      h("div", { class: "field paper-reader-actions", id: "paperReader" },
        h("label", { for: "paperPage", text: "查看正文" }),
        pagePicker,
        originalBtn,
      ),
      pageText,
    ),
    candidates,
  );
  const showPage = () => {
    currentPage = Number(pagePicker.value);
    const index = currentPage - 1;
    const source = paperPageSource(paper, index);
    const text = paper.pages[index] || "";
    if (text.trim() && (source === "text" || source === "ocr")) {
      pageText.textContent = text;
    } else if (source === "failed") {
      pageText.textContent = `这一页 OCR 失败：${paper.pageErrors?.[index] || "未取得可用文字"}。可在上方单页重试。`;
    } else if (source === "pending") {
      pageText.textContent = "这一页没有可用的文字层，尚未 OCR。可在上方识别本页或全部待识别页。";
    } else {
      pageText.textContent = "这一页没有可提取的文字层，可能是扫描页或纯图页。";
    }
    pageText.scrollTop = 0;
  };
  pagePicker.value = String(currentPage);
  pagePicker.addEventListener("change", showPage);
  showPage();

  if (!generation?.candidates.length) {
    const hasText = paperHasReadableText(paper);
    const message = job?.text ?? (generation ? "模型未找到有可核对证据的研究问题，可重新生成。" : hasText ? "可将论文文字发送给模型服务，生成带出处的问题草稿。" : "暂无可用于生成问题的文字，请先完成 OCR。");
    const status = h("p", { id: "paperGenerationStatus", role: "status", class: job && !job.running ? "field-error" : "aux", text: message });
    const generate = h("button", { class: "btn btn-primary", type: "button", disabled: job?.running || !hasText, text: job || generation ? "重新生成" : "生成研究问题" });
    generate.addEventListener("click", () => {
      generate.disabled = true;
      status.textContent = "正在准备论文文字…";
      void startPaperGeneration(paper.projectId, paper);
    });
    candidates.append(status, generate);
  } else {
    candidates.append(h("p", { class: "aux", text: `模型 ${generation.model} · 核对页码和原文后，可编辑并确认问题。` }));
    for (const candidate of generation.candidates) {
      const card = h("article", { class: "paper-candidate" }, h("h3", { text: candidate.question }), renderPaperEvidence(paper, candidate, file));
      if (candidate.questionId) {
        card.append(h("a", { class: "name-link", href: `#/question/${candidate.questionId}`, text: "打开已确认的问题" }));
      } else {
        const input = h("textarea", { maxlength: 300, rows: 2, id: `paper-question-${candidate.id}`, required: true });
        input.value = candidate.question;
        const confirm = h("button", { class: "btn btn-primary", type: "submit", text: "确认并创建问题" });
        const status = h("p", { class: "field-error", role: "status" });
        const form = h("form", { class: "field" }, h("label", { for: input.id, text: "研究问题（可修改）" }), input,
          h("div", { class: "empty-actions" }, confirm), status);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          confirm.disabled = true;
          status.textContent = "";
          try {
            const question = await data.acceptPaperCandidate(ACTOR, {
              projectId: paper.projectId, candidateId: candidate.id, question: input.value, now: new Date().toISOString(),
            });
            if (form.isConnected) location.hash = `#/question/${question.questionId}`;
          } catch (error) {
            status.textContent = error.message;
            confirm.disabled = false;
          }
        });
        card.append(form);
      }
      candidates.append(card);
    }
  }
  return body;
}

function renderLegacyPaper(projectId, meta) {
  const input = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const upload = h("button", { class: "btn", type: "button", text: "补传原 PDF" });
  upload.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    if (file) void importPdfFile(file, upload, { projectId, meta });
  });
  return h("section", { class: "panel" }, h("h2", { text: "项目文献" }),
    h("p", { class: "aux", text: `此项目只保存了 ${meta.filename} 的导入信息。补传原文件后可查看逐页正文和生成研究问题。` }), upload, input);
}

let projectRenderSeq = 0;

async function renderProject(projectId, page) {
  const seq = ++projectRenderSeq;
  const project = await data.getProject(ACTOR, projectId);
  if (!project) throw new Error(`项目不存在: ${projectId}`);
  const paper = await data.getPaperStudy(ACTOR, projectId);
  const paperFile = paper ? await data.getPaperFile(ACTOR, projectId, paper.sha256) : null;
  const legacy = paper ? null : readLegacyPaperImport(projectId);
  if (seq !== projectRenderSeq || parseRoute().view !== "project" || parseRoute().projectId !== projectId || parseRoute().page !== page) return;

  const nameHost = h("span", { id: "projectTitle", text: project.name });
  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("h1", {}, nameHost),
    ),
    h("div", { class: "empty-actions" },
      h("button", { class: "btn", type: "button", id: "renameProjectBtn", text: "改名" }),
      h("button", { class: "btn btn-primary", type: "button", id: "newQuestionBtn", text: "新建研究问题" }),
    ),
  );

  const renameRow = h("div", { class: "toolbar", hidden: true, id: "renameRow" },
    h("div", { class: "field search-field" },
      h("label", { for: "renameInput", text: "新的项目名" }),
      h("input", { type: "text", id: "renameInput", value: project.name, autocomplete: "off" }),
      h("p", { class: "field-error", id: "renameRowError", role: "alert", hidden: true }),
    ),
    h("div", { class: "empty-actions" },
      h("button", { class: "btn btn-primary", type: "button", id: "renameConfirm", text: "保存" }),
      h("button", { class: "btn", type: "button", id: "renameCancel", text: "取消" }),
    ),
  );

  const listHost = h("div", { id: "questionListHost" });
  main.append(head, renameRow, listHost);
  if (paper) listHost.before(renderPaperStudy(paper, page, paperFile), h("h2", { text: "已创建的研究问题" }));
  else if (legacy) listHost.before(renderLegacyPaper(projectId, legacy));
  if (page > 0 && paper) document.getElementById("paperPage").focus();

  document.getElementById("renameProjectBtn").addEventListener("click", () => {
    renameRow.hidden = false;
    const input = document.getElementById("renameInput");
    input.value = project.name;
    input.removeAttribute("aria-invalid");
    document.getElementById("renameRowError").hidden = true;
    input.focus();
  });
  document.getElementById("renameCancel").addEventListener("click", () => {
    renameRow.hidden = true;
  });
  document.getElementById("renameConfirm").addEventListener("click", async () => {
    const input = document.getElementById("renameInput");
    const errorNode = document.getElementById("renameRowError");
    const name = input.value.trim();
    if (!name) {
      input.setAttribute("aria-invalid", "true");
      errorNode.hidden = false;
      errorNode.textContent = "请填写项目名";
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    errorNode.hidden = true;
    // 改名走数据服务（工作流未封装改名动作，同一存储接口）
    const updated = await data.renameProject(ACTOR, projectId, name, new Date().toISOString());
    document.getElementById("projectTitle").textContent = updated.name;
    renameRow.hidden = true;
    await render();
  });

  document.getElementById("newQuestionBtn").addEventListener("click", () => {
    location.hash = `#/new/${projectId}`;
  });

  await updateQuestionList(projectId);

  async function updateQuestionList(targetId) {
    const host = listHost;
    const questions = await data.listQuestions(ACTOR, targetId);
    if (!host.isConnected) return;
    clear(host);
    if (questions.length === 0) {
      if (paper) {
        host.append(h("p", { class: "aux", text: "确认后的研究问题将显示在这里。" }));
        return;
      }
      host.append(
        h("div", { class: "empty" },
          h("p", { text: "该项目还没有研究问题" }),
          h("button", { class: "btn btn-primary", type: "button", id: "emptyNewQuestion", text: "新建研究问题" }),
        ),
      );
      document.getElementById("emptyNewQuestion").addEventListener("click", () => {
        location.hash = `#/new/${targetId}`;
      });
      return;
    }
    const table = h("table", { class: "data-table", id: "questionTable" },
      h("colgroup", {},
        h("col", { class: "q-col-sentence" }),
        h("col", { class: "q-col-status" }),
        h("col", { class: "q-col-version" }),
      ),
      h("thead", {},
        h("tr", {},
          h("th", { scope: "col", text: paper ? "研究问题" : "原句" }),
          h("th", { scope: "col", text: "当前状态" }),
          h("th", { scope: "col", text: "最后版本" }),
        ),
      ),
    );
    const tbody = h("tbody");
    for (const question of questions) {
      const fromPaper = paper?.generation?.candidates.some((candidate) => candidate.questionId === question.questionId);
      const openButton = h("button", {
        class: "name-link",
        type: "button",
        text: question.rawClaim || "(未填主张)",
        "aria-label": `打开问题 ${question.questionId}`,
        onclick: () => {
          location.hash = `#/question/${question.questionId}`;
        },
      });
      tbody.append(
        h("tr", { dataset: { questionId: question.questionId } },
          h("td", { class: "primary-cell" }, openButton),
          h("td", { "data-label": "状态" }, fromPaper ? "待研究" : badge(question.status)),
          h("td", {
            "data-label": "最后版本",
            text: question.currentRevisionId ? shortId(question.currentRevisionId) : "—",
          }),
        ),
      );
    }
    table.append(tbody);
    host.append(table);
  }
}

// ---------- 视图 3：新问题 / 数据录入 ----------

const entry = {
  projectId: null,
  rawClaim: "",
  dataMode: "",
  dataText: "",
  accuracyUnit: "percent",
  unknownRoles: {},
  preview: null,
  existingRuns: [],
  baselineRunId: "",
  targetRunId: "",
  scope: "",
  targetLr: null,
  expectedDeltaPp: "",
  clarifyingQuestion: "",
  parsedByModel: false,
  parseStatus: "",
  submitStatus: "",
  createdQuestionId: null,
  submitting: false,
};

function resetEntry(projectId) {
  Object.assign(entry, {
    projectId,
    rawClaim: "",
    dataMode: "",
    dataText: "",
    accuracyUnit: "percent",
    unknownRoles: {},
    preview: null,
    existingRuns: [],
    baselineRunId: "",
    targetRunId: "",
    scope: "",
    targetLr: null,
    expectedDeltaPp: "",
    clarifyingQuestion: "",
    parsedByModel: false,
    parseStatus: "",
    submitStatus: "",
    createdQuestionId: null,
    submitting: false,
  });
}

async function renderNewQuestion(projectId) {
  const project = await data.getProject(ACTOR, projectId);
  if (!project) throw new Error(`项目不存在: ${projectId}`);
  resetEntry(projectId);
  entry.existingRuns = await data.listRuns(ACTOR, projectId);

  const backLink = h("a", { class: "back-link back-link--follow", href: `#/project/${projectId}`, text: "← 返回项目" });
  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("h1", { text: "新建研究问题" }),
    ),
    h("span", { class: "aux", text: `项目：${project.name}` }),
  );

  // 主张
  const claimId = "claimInput";
  const claimError = h("p", { class: "field-error", id: "claimError", hidden: true });
  const parseStatus = h("p", { class: "aux", id: "parseStatus", role: "status" });
  const claimSection = h("section", { class: "form-section", "aria-labelledby": "claimTitle" },
    h("h2", { class: "form-section-title", id: "claimTitle", text: "主张" }),
    h("div", { class: "parse-line" },
      h("div", { class: "field" },
        h("label", { for: claimId, text: "主张原句" }),
        h("textarea", {
          id: claimId,
          name: "rawClaim",
          placeholder: "例如：数据增强使准确率提高了 2 个百分点",
          "aria-describedby": "claimError",
        }),
        claimError,
      ),
      h("button", { class: "btn", type: "button", id: "parseBtn", text: "模型解析" }),
    ),
    parseStatus,
    h("div", { class: "form-row" },
      h("div", { class: "field" },
        h("label", { for: "expectedDeltaInput", text: "增幅（可选，百分点）" }),
        h("input", { type: "number", id: "expectedDeltaInput", name: "expectedDeltaPp", step: "0.01", min: "0" }),
      ),
      h("div", { class: "field" },
        h("label", { for: "clarifyInput", text: "待追问（模型或人工填写）" }),
        h("input", { type: "text", id: "clarifyInput", name: "clarifyingQuestion", autocomplete: "off" }),
      ),
    ),
  );

  // 数据输入
  const pasteId = "pasteInput";
  const fileId = "fileInput";
  const dataSection = h("section", { class: "form-section", "aria-labelledby": "dataTitle" },
    h("h2", { class: "form-section-title", id: "dataTitle" }, "数据输入", h("span", { class: "req-badge", text: "必选" })),
    h("div", { class: "input-mode", role: "radiogroup", "aria-label": "数据输入方式" },
      h("label", {},
        h("input", { type: "radio", name: "dataMode", value: "paste", id: "modePaste" }),
        "粘贴 TSV/CSV",
      ),
      h("label", {},
        h("input", { type: "radio", name: "dataMode", value: "file", id: "modeFile" }),
        "上传 CSV 文件",
      ),
    ),
    h("p", { class: "choice-hint", id: "dataModeHint" }, "请选择输入方式（二选一）"),
    h("div", { class: "field", id: "pasteField", hidden: true },
      h("label", { for: pasteId, text: "粘贴表格文本（首行为表头）" }),
      h("textarea", {
        id: pasteId,
        name: "dataText",
        spellcheck: "false",
        placeholder: "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy",
      }),
    ),
    h("div", { class: "field", id: "fileField", hidden: true },
      h("label", { for: fileId, text: "选择 CSV 文件" }),
      h("input", { type: "file", id: fileId, accept: ".csv,text/csv,text/plain" }),
    ),
  );

  // 映射与单位预览
  const unitId = "unitSelect";
  const mappingHost = h("div", { id: "mappingHost" });
  const mappingSection = h("section", { class: "form-section", "aria-labelledby": "mappingTitle" },
    h("h2", { class: "form-section-title", id: "mappingTitle", text: "映射及单位预览" }),
    h("div", { class: "field", style: "max-width:320px" },
      h("label", { for: unitId, text: "准确率列单位" }),
      h("select", { id: unitId, name: "accuracyUnit" },
        h("option", { value: "percent", text: "百分数（0–100）" }),
        h("option", { value: "ratio", text: "比例（0–1，换算为百分数）" }),
      ),
    ),
    mappingHost,
  );

  // 运行选择
  const baselineId = "baselineSelect";
  const targetId = "targetSelect";
  const runSection = h("section", { class: "form-section", "aria-labelledby": "runTitle" },
    h("h2", { class: "form-section-title", id: "runTitle", text: "基线运行与目标运行" }),
    h("div", { class: "form-row" },
      h("div", { class: "field" },
        h("label", { for: baselineId, text: "基线运行（对照）" }),
        h("select", { id: baselineId, name: "baselineRunId" }, h("option", { value: "", text: "— 请选择 —" })),
      ),
      h("div", { class: "field" },
        h("label", { for: targetId, text: "目标运行" }),
        h("select", { id: targetId, name: "targetRunId" }, h("option", { value: "", text: "— 请选择 —" })),
      ),
    ),
  );

  // 范围
  const lrHost = h("div", { id: "lrHost" });
  const scopeSection = h("section", { class: "form-section", "aria-labelledby": "scopeTitle" },
    h("h2", { class: "form-section-title", id: "scopeTitle" }, "问题范围", h("span", { class: "req-badge", text: "必选" })),
    h("div", { class: "scope-row", role: "radiogroup", "aria-label": "问题范围" },
      h("label", {},
        h("input", { type: "radio", name: "scope", value: "target_lr", id: "scopeTarget" }),
        "目标学习率",
      ),
      h("label", {},
        h("input", { type: "radio", name: "scope", value: "both_lrs", id: "scopeBoth" }),
        "两档都验证",
      ),
    ),
    h("p", { class: "choice-hint", id: "scopeHint" }, "请选择验证范围（二选一）"),
    lrHost,
  );

  const submitStatus = h("p", { class: "aux", id: "submitStatus", role: "status" });
  const submitRow = h("div", { class: "submit-row" },
    h("button", { class: "btn btn-primary", type: "button", id: "submitEntry", text: "确认后开始分析" }),
    submitStatus,
  );

  const form = h("form", { class: "entry-form", id: "entryForm", novalidate: true },
    claimSection, dataSection, mappingSection, runSection, scopeSection, submitRow,
  );

  main.append(backLink, head, form);

  // ---- 事件 ----

  const claimInput = document.getElementById(claimId);
  claimInput.addEventListener("input", () => {
    entry.rawClaim = claimInput.value;
    entry.parsedByModel = false;
    claimInput.removeAttribute("aria-invalid");
    claimError.hidden = true;
  });

  document.getElementById("parseBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    entry.rawClaim = claimInput.value;
    if (!entry.rawClaim.trim()) {
      claimInput.setAttribute("aria-invalid", "true");
      claimError.hidden = false;
      claimError.textContent = "先填写主张原句";
      claimInput.focus();
      return;
    }
    button.disabled = true;
    parseStatus.textContent = "模型解析中…";
    try {
      const result = await wf.parseClaim(`req-parse-${Date.now()}`, entry.rawClaim);
      if (result.ok) {
        entry.parsedByModel = true;
        entry.clarifyingQuestion = result.output.clarifyingQuestion || "";
        entry.expectedDeltaPp = result.output.expectedDeltaPp === null ? "" : String(result.output.expectedDeltaPp);
        document.getElementById("expectedDeltaInput").value = entry.expectedDeltaPp;
        document.getElementById("clarifyInput").value = entry.clarifyingQuestion;
        parseStatus.textContent = `解析完成（来源：模型）。范围请在下方确认；追问：${entry.clarifyingQuestion || "无"}`;
      } else {
        entry.parsedByModel = false;
        parseStatus.textContent = `模型暂不可用（${result.error.code}），已切换手动确认；请核对下方范围与增幅。`;
      }
    } catch (error) {
      entry.parsedByModel = false;
      parseStatus.textContent = `解析失败：${error && error.message ? error.message : String(error)}；请手动确认。`;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("expectedDeltaInput").addEventListener("input", (event) => {
    entry.expectedDeltaPp = event.currentTarget.value;
  });
  document.getElementById("clarifyInput").addEventListener("input", (event) => {
    entry.clarifyingQuestion = event.currentTarget.value;
  });

  for (const radio of document.querySelectorAll('input[name="dataMode"]')) {
    radio.addEventListener("change", () => {
      entry.dataMode = document.querySelector('input[name="dataMode"]:checked').value;
      document.getElementById("pasteField").hidden = entry.dataMode !== "paste";
      document.getElementById("fileField").hidden = entry.dataMode !== "file";
      document.getElementById("dataModeHint").hidden = true;
    });
  }

  const pasteInput = document.getElementById(pasteId);
  pasteInput.addEventListener("input", () => {
    entry.dataText = pasteInput.value;
    schedulePreview();
  });
  document.getElementById(fileId).addEventListener("change", async (event) => {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) return;
    entry.dataText = await file.text();
    schedulePreview();
  });
  document.getElementById(unitId).addEventListener("change", (event) => {
    entry.accuracyUnit = event.currentTarget.value;
    runPreview();
  });

  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.addEventListener("change", () => {
      entry.scope = document.querySelector('input[name="scope"]:checked').value;
      document.getElementById("scopeHint").hidden = true;
      renderLrHost();
    });
  }

  document.getElementById(baselineId).addEventListener("change", (event) => {
    entry.baselineRunId = event.currentTarget.value;
  });
  document.getElementById(targetId).addEventListener("change", (event) => {
    entry.targetRunId = event.currentTarget.value;
    syncTargetLrDefault();
    renderLrHost();
  });

  document.getElementById("submitEntry").addEventListener("click", submitEntry);

  // 初始填充：即使未粘贴数据，也用项目已有运行填充学习率与运行选择
  rebuildRunOptions();
  renderLrHost();

  let previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 200);
  }

  async function runPreview() {
    if (!entry.dataText.trim()) {
      entry.preview = null;
      clear(mappingHost);
      rebuildRunOptions();
      return;
    }
    try {
      const preview = await wf.previewImport(ACTOR, {
        projectId,
        text: entry.dataText,
        accuracyUnit: entry.accuracyUnit,
        unknownRoles: entry.unknownRoles,
        importedAt: new Date().toISOString(),
      });
      entry.preview = preview;
      renderMapping(preview);
      rebuildRunOptions();
      renderLrHost();
    } catch (error) {
      clear(mappingHost);
      mappingHost.append(
        h("p", { class: "field-error", text: `预览失败：${error && error.message ? error.message : String(error)}` }),
      );
    }
  }

  function renderMapping(preview) {
    clear(mappingHost);
    const columns = preview.mapping.columns;
    const table = h("table", { class: "data-table mapping-table", id: "mappingTable" },
      h("thead", {},
        h("tr", {},
          h("th", { scope: "col", text: "列" }),
          h("th", { scope: "col", text: "映射" }),
          h("th", { scope: "col", text: "角色" }),
        ),
      ),
    );
    const tbody = h("tbody");
    for (const column of columns) {
      const roleCell =
        column.status === "unknown"
          ? (() => {
              const selectId = `role-${column.index}`;
              const select = h("select", { id: selectId, name: selectId, "aria-label": `列 ${column.header} 的角色` },
                h("option", { value: "", text: "— 待确认 —" }),
                h("option", { value: "config", text: "配置列" }),
                h("option", { value: "metadata", text: "元数据列" }),
              );
              select.value = entry.unknownRoles[column.header] || "";
              select.addEventListener("change", () => {
                const value = select.value;
                if (value) entry.unknownRoles[column.header] = value;
                else delete entry.unknownRoles[column.header];
                runPreview();
              });
              return select;
            })()
          : h("span", { text: column.field ? `${column.field}` : column.status === "ignored" ? "忽略" : "未识别" });
      tbody.append(
        h("tr", {},
          h("td", { text: column.header }),
          h("td", {}, roleCell),
          h("td", {
            text:
              column.status === "mapped"
                ? column.role === "config"
                  ? "配置"
                  : column.role === "metric"
                    ? "指标"
                    : column.role === "runId"
                      ? "编号"
                      : "元数据"
                : column.status === "ambiguous"
                  ? "需映射"
                  : "待确认",
          }),
        ),
      );
    }
    table.append(tbody);
    mappingHost.append(h("p", { class: "aux", text: `共 ${columns.length} 列；未知列需确认角色后才参与核验。` }), table);

    if (preview.mapping.status === "needs_mapping") {
      const items = preview.mapping.conflicts.map((c) => h("li", { text: `列「${c.headers.join("、")}」映射到同一字段 ${c.field}` }));
      mappingHost.append(h("div", { class: "notice notice-error", role: "alert" }, h("strong", { text: "映射冲突（保留你的原始输入）" }), h("ul", { class: "error-list" }, items)));
    }
    if (preview.errors.length > 0) {
      const items = preview.errors.map((e) =>
        h("li", { text: `行 ${e.row} · 列 ${e.column}：${e.message}` }),
      );
      mappingHost.append(h("div", { class: "notice notice-error", role: "alert" }, h("strong", { text: "数据错误" }), h("ul", { class: "error-list" }, items)));
    }
    if (preview.blocking === false && preview.mapping.status === "ok" && preview.errors.length === 0) {
      const summary = h("p", { class: "aux", text: `预览通过：新增 ${preview.added.length}，重复 ${preview.duplicates.length}，缺配置 ${preview.incomplete.length}，冲突 ${preview.conflicts.length}` });
      mappingHost.append(summary);
    }
  }

  /** 运行选项 = 项目已有运行 + 本次预览新增（同 runId 以预览为准）。 */
  function selectRuns() {
    const map = new Map();
    for (const run of entry.existingRuns) map.set(run.runId, run);
    if (entry.preview) {
      for (const run of [...entry.preview.added, ...entry.preview.incomplete]) map.set(run.runId, run);
    }
    return [...map.values()];
  }

  function previewRuns() {
    if (!entry.preview) return [];
    return [...entry.preview.added, ...entry.preview.incomplete];
  }

  function rebuildRunOptions() {
    const runs = selectRuns();
    for (const [selectId, key] of [
      [baselineId, "baselineRunId"],
      [targetId, "targetRunId"],
    ]) {
      const select = document.getElementById(selectId);
      const previous = entry[key];
      clear(select);
      select.append(h("option", { value: "", text: "— 请选择 —" }));
      for (const run of runs) {
        select.append(
          h("option", {
            value: run.runId,
            text: `${run.runId} · lr=${String(run.config.lr)} · aug=${String(run.config.augmentation)} · acc=${run.metrics.accuracy}`,
          }),
        );
      }
      select.value = runs.some((r) => r.runId === previous) ? previous : "";
      entry[key] = select.value;
    }
  }

  function lrOptions() {
    return deriveLrOptions(selectRuns());
  }

  function syncTargetLrDefault() {
    const options = lrOptions();
    if (entry.targetLr !== null && options.includes(entry.targetLr)) return;
    const targetRun = selectRuns().find((r) => r.runId === entry.targetRunId);
    if (targetRun && typeof targetRun.config.lr === "number") entry.targetLr = targetRun.config.lr;
    else if (options.length > 0) entry.targetLr = options[0];
    else entry.targetLr = null;
  }

  function renderLrHost() {
    clear(lrHost);
    const options = lrOptions();
    if (entry.scope === "target_lr") {
      if (options.length === 0) {
        lrHost.append(h("p", { class: "aux", text: "先粘贴数据以读取学习率取值。" }));
        return;
      }
      syncTargetLrDefault();
      const selectId = "targetLrSelect";
      const select = h("select", { id: selectId, name: "targetLr" });
      for (const lr of options) select.append(h("option", { value: String(lr), text: `lr = ${lr}` }));
      select.value = String(entry.targetLr);
      select.addEventListener("change", () => {
        entry.targetLr = Number(select.value);
      });
      lrHost.append(
        h("div", { class: "field", style: "max-width:320px" },
          h("label", { for: selectId, text: "目标学习率（数据中的取值）" }),
          select,
        ),
      );
    } else if (entry.scope === "both_lrs") {
      lrHost.append(
        h("p", { class: "aux", text: options.length > 0 ? `两档学习率：${options.join("、")}` : "先粘贴数据以读取学习率取值。" }),
      );
    }
  }

  async function submitEntry(event) {
    if (entry.submitting) return;
    const button = event.currentTarget;
    entry.rawClaim = claimInput.value;
    entry.expectedDeltaPp = document.getElementById("expectedDeltaInput").value;
    entry.clarifyingQuestion = document.getElementById("clarifyInput").value;

    if (!entry.rawClaim.trim()) {
      claimInput.setAttribute("aria-invalid", "true");
      claimError.hidden = false;
      claimError.textContent = "先填写主张原句";
      claimInput.focus();
      return;
    }

    entry.submitting = true;
    button.disabled = true;
    submitStatus.textContent = "提交中…";
    try {
      // 1) 先保存草稿（缺数据也落库为 needs_input）
      if (!entry.createdQuestionId) {
        const question = await wf.createQuestion(ACTOR, {
          projectId,
          rawClaim: entry.rawClaim,
        });
        entry.createdQuestionId = question.questionId;
      }

      const missing = evaluateEntryMissing({
        rawClaim: entry.rawClaim,
        dataText: entry.dataText,
        baselineRunId: entry.baselineRunId,
        targetRunId: entry.targetRunId,
        scope: entry.scope,
        targetLr: entry.scope === "target_lr" ? entry.targetLr : null,
      });
      // 输入方式是表单必选项（纯函数不感知 UI 模式，缺项在显示层补齐）
      if (!entry.dataMode) missing.unshift("数据输入方式");
      if (missing.length > 0) {
        submitStatus.textContent = `草稿已保存（${entry.createdQuestionId}）；还缺：${missing.join("、")}`;
        return;
      }

      const lrs = lrOptions();
      const learningRates =
        lrs.length >= 2 ? lrs : lrs.length === 1 ? [lrs[0], lrs[0]] : [entry.targetLr, entry.targetLr];

      // 2) 确认范围（模型解析或人工确认）
      const deltaText = entry.expectedDeltaPp.trim();
      const proposal = {
        factor: "augmentation",
        metric: "accuracy",
        scope: null,
        expectedDeltaPp: deltaText === "" ? null : Number(deltaText),
        clarifyingQuestion: entry.clarifyingQuestion,
      };
      const confirmed = await wf.confirmScope(ACTOR, {
        questionId: entry.createdQuestionId,
        proposal,
        source: entry.parsedByModel ? "model" : "manual",
        targetRunId: entry.targetRunId,
        baselineRunId: entry.baselineRunId,
        scope: entry.scope,
        learningRates,
      });
      if (!("question" in confirmed)) {
        submitStatus.textContent = `范围待补充：${confirmed.detail}`;
        return;
      }

      // 3) 提交数据
      const runs = previewRuns();
      if (runs.length > 0) {
        await wf.commitImport(ACTOR, { projectId, runs });
      }

      // 4) 开始分析
      const result = await wf.analyze(ACTOR, {
        requestId: `req-web-${Date.now()}`,
        questionId: entry.createdQuestionId,
      });
      if (result.gated) {
        submitStatus.textContent = `范围未确认：${result.reason}`;
        return;
      }
      submitStatus.textContent = `已开始分析：${result.status}`;
      location.hash = `#/question/${entry.createdQuestionId}`;
    } catch (error) {
      submitStatus.textContent = `提交失败：${error && error.message ? error.message : String(error)}`;
    } finally {
      entry.submitting = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  // 首次进入：若有数据则预览一次（刷新恢复场景）
  if (entry.dataText) runPreview();
}

// ---------- 视图 4：问题详情（卡 10） ----------

const qView = {
  questionId: null,
  revisionId: null,
  selectedKey: null,
  highlightKeys: [],
  selectedEvidenceId: null,
  statusText: "",
  statusIsError: false,
  autoSelectNewSuggested: null,
  projectIdForDrawer: null,
  drawer: null,
  parseDone: false,
  updateSteps: null,
};

const STEP_LABELS = [
  { kind: "parse", label: "解析主张" },
  { kind: "snapshot", label: "核对配置" },
  { kind: "rules", label: "查找对照" },
  { kind: "model", label: "模型分析" },
];
const STEP_TEXT = { pending: "待运行", running: "运行中", done: "完成", failed: "失败", unavailable: "未接通" };
const STEP_GLYPH = { pending: "○", running: "◐", done: "●", failed: "✕", unavailable: "○" };

function nodeStepState(node, events, parseDone) {
  if (node === "parse") return parseDone ? "done" : "pending";
  const evs = events.filter((e) => e.node === node);
  if (evs.some((e) => e.status === "failed")) return "failed";
  if (evs.some((e) => e.status === "completed")) return "done";
  if (evs.some((e) => e.status === "started")) return "running";
  return "pending";
}

/** 模型节点失败事件的如实区分：服务未配置=未接通（中性），其余=失败（红）。 */
function modelStepState(events) {
  const failed = [...events].reverse().find((e) => e.node === "model" && e.status === "failed");
  return failed && failed.summary.includes("模型服务不可用") ? "unavailable" : "failed";
}

/** 立即渲染真实等待/错误状态（不等分析结束才显示）。 */
function showStatus(text, isError = false) {
  qView.statusText = text;
  qView.statusIsError = isError;
  let node = document.getElementById("qStatus");
  if (!node) {
    node = h("div", { id: "qStatus", role: "status" });
    const stepsNode = document.getElementById("steps");
    if (stepsNode && stepsNode.isConnected) stepsNode.after(node);
    else main.append(node);
  }
  node.className = isError ? "notice notice-error" : "notice";
  node.textContent = text;
}

/** 异步操作期间按 job 事件刷新步骤行（运行中/失败等来自真实事件）。 */
function watchStepsWhile(questionId, promise) {
  const timer = setInterval(() => {
    wf.listJobs(ACTOR, questionId)
      .then(async (jobs) => {
        const latest = jobs.length > 0 ? jobs[jobs.length - 1] : null;
        const events = latest ? (await wf.getJob(ACTOR, latest.jobId)).events : [];
        if (qView.updateSteps) qView.updateSteps(events);
      })
      .catch((error) => {
        clearInterval(timer);
        showStatus(`节点状态刷新失败：${error && error.message ? error.message : String(error)}`, true);
      });
  }, 250);
  return promise.finally(() => clearInterval(timer));
}

function augLabel(augmentation) {
  return augmentation === "off" ? "关" : "开";
}

function cellKeyOf(lr, augmentation) {
  return `${lr}|${augmentation}`;
}

// ---------- 视图 4：问题详情与研究记录（卡 23） ----------

const RESEARCH_ITEM_STATUS = {
  pending: "待验证",
  in_progress: "进行中",
  recorded: "已记录结果",
};
const RESEARCH_CONCLUSION = {
  supported: "支持",
  not_supported: "不支持",
  insufficient: "证据不足",
};

function researchBadge(text, kind) {
  return h("span", { class: `research-badge research-badge--${kind}`, text });
}

function researchSourceLink(question, source, text, className = "") {
  const link = h("a", { class: className, href: `#/project/${question.projectId}/paper/${source.paperSha256}/${source.page}`, text });
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const paper = await data.getPaperStudy(ACTOR, question.projectId);
    const file = paper?.sha256 === source.paperSha256 ? await data.getPaperFile(ACTOR, question.projectId, paper.sha256) : null;
    if (!paper || paper.sha256 !== source.paperSha256 || !file) {
      toast("请先补传原 PDF，才能查看原版页面", "bad");
      location.hash = `#/project/${question.projectId}/${source.page}`;
      return;
    }
    await openPdfViewer(paper, file, source.page, source.quote, link);
  });
  return link;
}

function renderResearchSources(question, sources, sourceIds) {
  const selected = sourceIds.map((sourceId) => sources.find((source) => source.sourceId === sourceId)).filter(Boolean);
  if (selected.length === 0) return null;
  return h("ul", { class: "research-sources" },
    selected.map((source) => h("li", {},
      researchSourceLink(question, source, `${source.title} · PDF 第 ${source.page} 页`),
      h("blockquote", { text: source.quote }),
    )),
  );
}

function focusResearchTarget(kind, id) {
  const node = document.getElementById(`research-${kind}-${id}`);
  if (!node) return;
  node.scrollIntoView({ block: "center" });
  node.focus({ preventScroll: true });
}

function researchSourceOptions(sources, selectedIds) {
  if (sources.length === 0) {
    return h("p", { class: "aux", text: "当前问题没有可关联的引文；可先记录个人思考，之后再编辑补充。" });
  }
  const options = sources.map((source) => h("label", { class: "research-source-option" },
    h("input", { type: "checkbox", name: "researchSource", value: source.sourceId, checked: selectedIds.includes(source.sourceId) }),
    h("span", {},
      h("strong", { text: `${source.title} · PDF 第 ${source.page} 页` }),
      h("span", { class: "research-source-quote", text: source.quote }),
    ),
  ));
  return h("fieldset", { class: "research-source-picker" },
    h("legend", { text: "关联问题已有引文（可多选，也可不选）" }),
    options,
  );
}

function selectedSourceIds(form) {
  return [...form.querySelectorAll('input[name="researchSource"]:checked')].map((input) => input.value);
}

function openResearchModal({ title, trigger, fields, submitText, onSubmit, onSaved }) {
  const overlay = h("div", { class: "modal-overlay" });
  const modal = h("div", {
    class: "modal modal--research",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "researchModalTitle",
    tabindex: "-1",
  });
  const form = h("form", { class: "research-form" },
    h("h2", { id: "researchModalTitle", text: title }),
    h("div", { class: "research-modal-fields" }, fields),
    h("p", { class: "field-error", role: "alert", hidden: true }),
    h("div", { class: "modal-actions" },
      h("button", { class: "btn", type: "button", text: "取消" }),
      h("button", { class: "btn btn-primary", type: "submit", text: submitText }),
    ),
  );
  const error = form.querySelector(".field-error");
  const cancel = form.querySelector('button[type="button"]');
  const submit = form.querySelector('button[type="submit"]');
  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  };
  cancel.addEventListener("click", () => close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      const saved = await onSubmit();
      close(false);
      await onSaved(saved);
    } catch (saveError) {
      error.hidden = false;
      error.textContent = saveError && saveError.message ? saveError.message : String(saveError);
      submit.disabled = false;
    }
  });
  attachModalBehavior(overlay, modal, close);
  modal.append(form);
  (form.querySelector("textarea, input, select") ?? modal).focus();
}

function openResearchNoteModal(question, research, note, trigger, refresh) {
  const body = h("textarea", {
    id: "researchNoteBody",
    rows: 7,
    maxlength: 10_000,
    required: true,
    placeholder: "记录阅读观察、个人思考或待核对的条件…",
  });
  body.value = note?.body ?? "";
  const sourcePicker = researchSourceOptions(research.sources, note?.sourceIds ?? []);
  openResearchModal({
    title: note ? "编辑阅读笔记" : "新建阅读笔记",
    trigger,
    fields: [
      h("div", { class: "field" }, h("label", { for: body.id, text: "笔记正文" }), body),
      sourcePicker,
    ],
    submitText: "保存笔记",
    onSubmit: async () => {
      const sourceIds = selectedSourceIds(sourcePicker);
      return note
        ? data.saveResearchNote(ACTOR, { noteId: note.noteId, questionId: question.questionId, body: body.value, sourceIds, now: new Date().toISOString() })
        : data.saveResearchNote(ACTOR, { questionId: question.questionId, body: body.value, sourceIds, now: new Date().toISOString() });
    },
    onSaved: async (saved) => {
      await refresh();
      toast(note ? "阅读笔记已更新" : "阅读笔记已保存", "ok");
      focusResearchTarget("note", saved.noteId);
    },
  });
}

function openResearchItemModal(question, research, item, fromNote, trigger, refresh) {
  const questionInput = h("textarea", { id: "researchItemQuestion", rows: 2, maxlength: 500, required: true });
  questionInput.value = item?.question ?? fromNote?.body.slice(0, 500) ?? "";
  const method = h("textarea", { id: "researchItemMethod", rows: 3, maxlength: 2_000, required: true });
  method.value = item?.method ?? "";
  const criteria = h("textarea", { id: "researchItemCriteria", rows: 3, maxlength: 2_000, required: true });
  criteria.value = item?.criteria ?? "";
  const status = h("select", { id: "researchItemStatus", "aria-label": "事项状态" },
    Object.entries(RESEARCH_ITEM_STATUS).map(([value, text]) => h("option", { value, text })),
  );
  status.value = item?.status ?? "pending";
  const originNote = fromNote ?? research.notes.find((note) => note.noteId === item?.noteId) ?? null;
  const fields = [
    h("div", { class: "field" }, h("label", { for: questionInput.id, text: "待验证问句" }), questionInput),
    h("div", { class: "field" }, h("label", { for: method.id, text: "验证方法" }), method),
    h("div", { class: "field" }, h("label", { for: criteria.id, text: "判断依据" }), criteria),
    h("div", { class: "field" }, h("label", { for: status.id, text: "事项状态" }), status),
  ];
  if (originNote) {
    fields.push(h("div", { class: "research-origin" },
      h("strong", { text: "来源笔记" }),
      h("p", { text: originNote.body }),
      renderResearchSources(question, research.sources, originNote.sourceIds),
    ));
  }
  openResearchModal({
    title: item ? "编辑待验证事项" : fromNote ? "将笔记转为待验证事项" : "新建待验证事项",
    trigger,
    fields,
    submitText: "保存事项",
    onSubmit: async () => data.saveVerificationItem(ACTOR, {
      itemId: item?.itemId,
      questionId: question.questionId,
      noteId: !item && fromNote ? fromNote.noteId : undefined,
      question: questionInput.value,
      method: method.value,
      criteria: criteria.value,
      status: status.value,
      now: new Date().toISOString(),
    }),
    onSaved: async (saved) => {
      await refresh();
      toast(item ? "待验证事项已更新" : "待验证事项已保存", "ok");
      focusResearchTarget("item", saved.itemId);
    },
  });
}

function openVerificationResultModal(question, item, trigger, refresh) {
  const date = h("input", { type: "date", id: "researchResultDate", required: true });
  date.value = new Date().toISOString().slice(0, 10);
  const observation = h("textarea", { id: "researchResultObservation", rows: 4, maxlength: 5_000, required: true });
  const basis = h("textarea", { id: "researchResultBasis", rows: 4, maxlength: 5_000, required: true });
  const conclusion = h("select", { id: "researchResultConclusion", required: true },
    h("option", { value: "", text: "请选择结论" }),
    Object.entries(RESEARCH_CONCLUSION).map(([value, text]) => h("option", { value, text })),
  );
  openResearchModal({
    title: "记录验证结果",
    trigger,
    fields: [
      h("div", { class: "form-row" },
        h("div", { class: "field" }, h("label", { for: date.id, text: "验证日期" }), date),
        h("div", { class: "field" }, h("label", { for: conclusion.id, text: "结论" }), conclusion),
      ),
      h("div", { class: "field" }, h("label", { for: observation.id, text: "实际观察" }), observation),
      h("div", { class: "field" }, h("label", { for: basis.id, text: "验证依据" }), basis),
      h("p", { class: "aux", text: "每次保存新增一条验证记录，不会覆盖早先结果。" }),
    ],
    submitText: "保存验证结果",
    onSubmit: async () => data.appendVerificationResult(ACTOR, {
      questionId: question.questionId,
      itemId: item.itemId,
      observation: observation.value,
      basis: basis.value,
      verifiedOn: date.value,
      conclusion: conclusion.value,
      now: new Date().toISOString(),
    }),
    onSaved: async (saved) => {
      await refresh();
      toast("验证结果已保存", "ok");
      focusResearchTarget("result", saved.resultId);
    },
  });
}

async function renderResearchWorkspace(question, research) {
  const panel = h("section", { class: "panel research-panel", id: "researchPanel", "aria-labelledby": "researchTitle" });
  const notesHost = h("div", { class: "research-list", id: "researchNotes" });
  const itemsHost = h("div", { class: "research-list", id: "researchItems" });
  const refresh = async () => {
    if (!panel.isConnected) return;
    const latest = await data.getQuestionResearch(ACTOR, question.questionId);
    if (!panel.isConnected) return;
    panel.replaceWith(await renderResearchWorkspace(question, latest));
  };

  const newNote = h("button", { class: "btn btn-primary", type: "button", id: "newResearchNote", text: "新建阅读笔记" });
  newNote.addEventListener("click", () => openResearchNoteModal(question, research, null, newNote, refresh));
  const newItem = h("button", { class: "btn", type: "button", id: "newResearchItem", text: "新建待验证事项" });
  newItem.addEventListener("click", () => openResearchItemModal(question, research, null, null, newItem, refresh));

  panel.append(
    h("div", { class: "research-heading" },
      h("div", {},
        h("h2", { id: "researchTitle", text: "研究记录" }),
        h("p", { class: "aux", text: `阅读笔记 ${research.notes.length} · 待验证事项 ${research.items.length} · 验证结果 ${research.results.length}` }),
      ),
      h("div", { class: "research-actions" }, newNote, newItem),
    ),
    h("p", { class: "aux", text: "笔记可关联问题已有引文，也可记录无出处的个人思考；验证结果按保存顺序保留，可逐级追溯。" }),
    h("div", { class: "research-grid" },
      h("section", { class: "research-column", "aria-labelledby": "researchNotesTitle" },
        h("h3", { id: "researchNotesTitle", text: `阅读笔记（${research.notes.length}）` }),
        notesHost,
      ),
      h("section", { class: "research-column", "aria-labelledby": "researchItemsTitle" },
        h("h3", { id: "researchItemsTitle", text: `待验证事项（${research.items.length}）` }),
        itemsHost,
      ),
    ),
  );

  if (research.notes.length === 0) {
    notesHost.append(h("p", { class: "research-empty", text: "还没有阅读笔记。先记下观察、疑问或暂时没有引用的思考。" }));
  }
  for (const note of research.notes) {
    const edit = h("button", { class: "btn", type: "button", text: "编辑" });
    edit.addEventListener("click", () => openResearchNoteModal(question, research, note, edit, refresh));
    const convert = h("button", { class: "btn", type: "button", text: "转为事项" });
    convert.addEventListener("click", () => openResearchItemModal(question, research, null, note, convert, refresh));
    notesHost.append(h("article", {
      class: "research-card research-note",
      id: `research-note-${note.noteId}`,
      dataset: { noteId: note.noteId },
      tabindex: "-1",
    },
      h("div", { class: "research-card-head" },
        h("strong", { text: "阅读笔记" }),
        h("span", { class: "aux", text: `创建 ${formatUpdatedAt(note.createdAt)} · 更新 ${formatUpdatedAt(note.updatedAt)}` }),
      ),
      h("p", { class: "research-note-body", text: note.body }),
      renderResearchSources(question, research.sources, note.sourceIds),
      h("div", { class: "research-actions" }, edit, convert),
    ));
  }

  if (research.items.length === 0) {
    itemsHost.append(h("p", { class: "research-empty", text: "还没有待验证事项。可手动新建，或从一条阅读笔记转为事项。" }));
  }
  for (const item of research.items) {
    const edit = h("button", { class: "btn", type: "button", text: "编辑事项" });
    edit.addEventListener("click", () => openResearchItemModal(question, research, item, null, edit, refresh));
    const addResult = h("button", { class: "btn btn-primary", type: "button", text: "记录验证结果" });
    addResult.addEventListener("click", () => openVerificationResultModal(question, item, addResult, refresh));
    const note = research.notes.find((entry) => entry.noteId === item.noteId) ?? null;
    const results = research.results.filter((result) => result.itemId === item.itemId);
    const resultList = h("ol", { class: "research-results" });
    if (results.length === 0) {
      resultList.append(h("li", { class: "research-empty", text: "尚未记录验证结果。" }));
    }
    for (const result of results) {
      const trace = h("div", { class: "research-trace", "aria-label": "验证结果追溯" },
        h("button", { class: "btn", type: "button", text: "查看事项", onclick: () => focusResearchTarget("item", item.itemId) }),
      );
      if (note) {
        trace.append(h("button", { class: "btn", type: "button", text: "来源笔记", onclick: () => focusResearchTarget("note", note.noteId) }));
      }
      for (const sourceId of item.sourceIds) {
        const source = research.sources.find((entry) => entry.sourceId === sourceId);
        if (source) {
          trace.append(researchSourceLink(question, source, `原文第 ${source.page} 页`, "btn"));
        }
      }
      resultList.append(h("li", {
        class: `research-result research-result--${result.conclusion}`,
        id: `research-result-${result.resultId}`,
        dataset: { resultId: result.resultId },
        tabindex: "-1",
      },
        h("div", { class: "research-card-head" },
          researchBadge(RESEARCH_CONCLUSION[result.conclusion], result.conclusion),
          h("span", { class: "aux", text: `验证日期 ${result.verifiedOn} · 记录于 ${formatUpdatedAt(result.createdAt)}` }),
        ),
        h("p", {}, h("strong", { text: "实际观察：" }), result.observation),
        h("p", {}, h("strong", { text: "验证依据：" }), result.basis),
        trace,
      ));
    }
    const origin = note
      ? h("button", { class: "name-link", type: "button", text: "来源笔记", onclick: () => focusResearchTarget("note", note.noteId) })
      : h("span", { class: "aux", text: "手动事项，无来源笔记" });
    itemsHost.append(h("article", {
      class: "research-card research-item",
      id: `research-item-${item.itemId}`,
      dataset: { itemId: item.itemId },
      tabindex: "-1",
    },
      h("div", { class: "research-card-head" },
        researchBadge(RESEARCH_ITEM_STATUS[item.status], item.status),
        h("span", { class: "aux", text: `更新 ${formatUpdatedAt(item.updatedAt)}` }),
      ),
      h("h4", { class: "research-question", text: item.question }),
      h("dl", { class: "research-facts" },
        h("dt", { text: "验证方法" }), h("dd", { text: item.method }),
        h("dt", { text: "判断依据" }), h("dd", { text: item.criteria }),
      ),
      origin,
      renderResearchSources(question, research.sources, item.sourceIds),
      h("div", { class: "research-actions" }, edit, addResult),
      h("div", {}, h("strong", { text: `验证记录（${results.length}）` }), resultList),
    ));
  }
  return panel;
}

let renderSeq = 0;

async function renderQuestion(questionId) {
  const seq = ++renderSeq;
  clear(main);
  const question = await data.getQuestion(ACTOR, questionId);
  if (seq !== renderSeq) return;
  if (!question) throw new Error(`问题不存在: ${questionId}`);
  const project = await data.getProject(ACTOR, question.projectId);
  const paper = await data.getPaperStudy(ACTOR, question.projectId);
  const paperFile = paper ? await data.getPaperFile(ACTOR, question.projectId, paper.sha256) : null;
  const candidate = paper?.generation?.candidates.find((item) => item.questionId === questionId);
  if (seq !== renderSeq || parseRoute().questionId !== questionId) return;
  if (candidate) {
    const research = await data.getQuestionResearch(ACTOR, questionId);
    if (seq !== renderSeq || parseRoute().questionId !== questionId) return;
    const researchPanel = await renderResearchWorkspace(question, research);
    closeDrawer(false);
    main.append(
      h("a", { class: "back-link", href: `#/project/${question.projectId}`, text: "← 返回项目" }),
      h("h1", { class: "q-claim", text: question.rawClaim }),
      h("section", { class: "panel paper-candidate" },
        h("h2", { text: "研究线索与文献出处" }),
        h("p", { class: "aux", text: `${paper.title} · PDF 物理页码` }),
        renderPaperEvidence(paper, candidate, paperFile),
      ),
    );
    main.append(researchPanel);
    return;
  }

  const research = await data.getQuestionResearch(ACTOR, questionId);
  if (seq !== renderSeq || parseRoute().questionId !== questionId) return;
  const researchPanel = await renderResearchWorkspace(question, research);

  if (qView.questionId !== questionId) {
    closeDrawer(false);
    Object.assign(qView, {
      questionId,
      revisionId: null,
      selectedKey: null,
      highlightKeys: [],
      selectedEvidenceId: null,
      statusText: "",
      statusIsError: false,
      autoSelectNewSuggested: null,
    });
  }
  qView.projectIdForDrawer = question.projectId;

  const versions = await wf.listRevisions(ACTOR, questionId);
  const jobs = await wf.listJobs(ACTOR, questionId);

  if (qView.revisionId && !versions.some((v) => v.revisionId === qView.revisionId)) {
    qView.revisionId = null;
  }
  const current =
    versions.find((v) => v.revisionId === qView.revisionId) ?? versions[versions.length - 1] ?? null;
  if (current) qView.revisionId = current.revisionId;

  // 节点事件：优先正在运行的作业，其次当前查看版本的作业，最后最新作业
  const liveJob = jobs.find((j) => j.status === "queued" || j.status === "running") ?? null;
  const viewedJob = current ? (jobs.find((j) => j.revisionId === current.revisionId) ?? null) : null;
  const stepsJob = liveJob ?? viewedJob ?? (jobs.length > 0 ? jobs[jobs.length - 1] : null);
  const events = stepsJob ? (await wf.getJob(ACTOR, stepsJob.jobId)).events : [];

  // —— 顶部：返回项目 → 原主张（可换行）→ 范围/版本选择/分析状态 ——
  const scopeText = question.confirmedClaim
    ? question.confirmedClaim.scope === "both_lrs"
      ? `两档（${question.confirmedClaim.learningRates.join("、")}）`
      : "目标学习率"
    : "未明确（待澄清）";

  const meta = h("div", { class: "q-meta" },
    h("span", { class: "field-inline" }, h("strong", { text: "当前范围：" }), scopeText),
  );

  if (question.confirmedClaim && versions.length > 0) {
    const scopeSelect = h("select", { id: "scopeSelect", "aria-label": "更改问题范围" },
      h("option", { value: "both_lrs", text: "两档" }),
      h("option", { value: "target_lr", text: "目标学习率" }),
    );
    scopeSelect.value = question.confirmedClaim.scope;
    scopeSelect.addEventListener("change", () => doChangeScope(scopeSelect.value));
    meta.append(
      h("label", { class: "field-inline", for: "scopeSelect", text: "更改范围：" }),
      scopeSelect,
    );
  }

  if (versions.length > 0) {
    const versionSelect = h("select", { id: "versionSelect", "aria-label": "版本选择器" });
    versions.forEach((version, index) => {
      versionSelect.append(
        h("option", {
          value: version.revisionId,
          text: `V${index + 1} · ${shortId(version.revisionId)} · ${formatUpdatedAt(version.createdAt)}`,
        }),
      );
    });
    versionSelect.value = current.revisionId;
    versionSelect.addEventListener("change", () => {
      qView.revisionId = versionSelect.value;
      renderQuestion(questionId);
    });
    meta.append(h("label", { class: "field-inline", for: "versionSelect", text: "版本：" }), versionSelect);
  }

  meta.append(badge(question.status));
  if (current) meta.append(modelBadge(current.modelOutput));

  const head = h("div", { class: "q-header" },
    h("a", { class: "back-link", href: `#/project/${question.projectId}`, text: "← 返回项目" }),
    h("h1", { class: "q-claim", text: question.rawClaim || "(未填主张)" }),
    h("div", { class: "q-meta" },
      h("span", {
        class: "field-inline",
        id: "questionIdValue",
        title: question.questionId,
        text: `问题编号 ${shortId(question.questionId)}`,
      }),
    ),
    meta,
  );

  // —— 真实节点步骤（状态来自 job 事件，异步期间可原位刷新）——
  qView.parseDone = !!question.confirmedClaim;
  const steps = h("ol", { class: "steps", id: "steps", "aria-label": "分析节点" });
  const fillSteps = (stepEvents) => {
    clear(steps);
    for (const { kind, label } of STEP_LABELS) {
      let state = nodeStepState(kind, stepEvents, qView.parseDone);
      if (kind === "model" && state === "failed") state = modelStepState(stepEvents);
      steps.append(
        h("li", { class: `step step-${state}`, dataset: { node: kind } },
          h("span", { class: "glyph", "aria-hidden": "true", text: STEP_GLYPH[state] }),
          h("span", { text: `${label} · ${STEP_TEXT[state]}` }),
        ),
      );
    }
  };
  fillSteps(events);
  qView.updateSteps = fillSteps;

  if (seq !== renderSeq) return;
  main.append(head, steps);

  if (qView.statusText && seq === renderSeq) {
    main.append(
      h("div", {
        class: qView.statusIsError ? "notice notice-error" : "notice",
        id: "qStatus",
        role: "status",
        text: qView.statusText,
      }),
    );
  }

  // —— 问题未明确：主操作是回答澄清，不展示矩阵 ——
  if (!question.confirmedClaim) {
    if (seq !== renderSeq) return;
    main.append(renderClarifyPanel(question), researchPanel);
    return;
  }

  if (!current) {
    const startPanel = h("section", { class: "panel" },
      h("h2", { text: "开始分析" }),
      h("p", { class: "aux", text: "范围已确认，但还没有分析版本。" }),
      h("button", {
        class: "btn btn-primary",
        type: "button",
        id: "startAnalyze",
        text: "开始分析",
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          showStatus("正在分析…（读取快照 → 查找对照 → 请求模型，等待真实结果）");
          try {
            const result = await watchStepsWhile(
              questionId,
              wf.analyze(ACTOR, { requestId: `req-web-${Date.now()}`, questionId }),
            );
            if (result.gated) {
              showStatus(result.reason, true);
            } else {
              qView.revisionId = result.revisionId;
              showStatus(
                `分析完成（作业 ${result.job.jobId}），模型输出：${modelGlyph(result.modelOutput).text}`,
                result.modelOutput !== "ready",
              );
            }
          } catch (error) {
            showStatus(`分析失败：${error && error.message ? error.message : String(error)}`, true);
          }
          await renderQuestion(questionId);
        },
      }),
    );
    if (seq !== renderSeq) return;
    main.append(startPanel, researchPanel);
    return;
  }

  // —— 同一份 revision 数据渲染 ——
  const claim = current.inputSnapshot.claim;
  const runs = current.inputSnapshot.runs;
  const pkg = buildEvidencePackage(claim, runs, { projectId: question.projectId, questionId });
  const matrix = buildQuestionMatrix(claim, runs, pkg);
  const registry = buildFactRegistry(pkg, claim);

  // 矩阵面板
  const fixed = h("div", { class: "fixed-conditions", "aria-label": "固定条件" },
    h("span", { text: `模型 ${matrix.fixedConditions.model}` }),
    h("span", { text: `评测集 ${matrix.fixedConditions.evalSplit}` }),
    h("span", { text: `种子 ${matrix.fixedConditions.seed}` }),
  );
  const table = h("table", { class: "matrix", id: "matrixTable" },
    h("colgroup", {}, h("col", { class: "c-lr" }), h("col"), h("col")),
    h("thead", {},
      h("tr", {},
        h("th", { scope: "col", text: "学习率" }),
        h("th", { scope: "col", text: "增强关" }),
        h("th", { scope: "col", text: "增强开" }),
      ),
    ),
  );
  const tbody = h("tbody");
  const cellButtons = new Map();
  for (const lr of matrix.lrs) {
    const row = h("tr", {}, h("th", { scope: "row", text: String(lr) }));
    for (const augmentation of ["off", "on"]) {
      const cell = matrix.cells.find((c) => c.lr === lr && c.augmentation === augmentation);
      const key = cellKeyOf(lr, augmentation);
      const button = h("button", {
        type: "button",
        class: "cell-btn",
        dataset: { cellKey: key },
        "aria-pressed": "false",
        "aria-label": `学习率 ${lr}，增强${augLabel(augmentation)}，${cell.state === "measured" ? `实测 ${formatAccuracy(cell.accuracy)}` : cell.state === "suggested" ? "建议补跑" : "未跑"}`,
      });
      if (cell.state === "measured") {
        button.append(
          h("span", { class: "val", text: formatAccuracy(cell.accuracy) }),
          h("span", { class: "sub", text: cell.runId }),
        );
      } else if (cell.state === "suggested") {
        button.append(h("span", { class: "val suggested-text", text: "建议补跑" }), h("span", { class: "sub", text: "待补" }));
      } else {
        button.append(h("span", { class: "val muted", text: "未跑" }), h("span", { class: "sub", text: "—" }));
      }
      button.addEventListener("click", () => selectCell(key));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectCell(key);
        }
      });
      cellButtons.set(key, button);
      const td = h("td", { class: `state-${cell.state}`, dataset: { cellKey: key } }, button);
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);

  const matrixPanel = h("section", { class: "panel", id: "matrixPanel", "aria-labelledby": "matrixTitle" },
    h("h2", { id: "matrixTitle", text: "实验对照矩阵" }),
    fixed,
    pkg.unmetConditions.length > 0
      ? h("div", { class: "notice", role: "status" },
          h("strong", { text: "当前缺口" }),
          h("ul", { class: "error-list" }, pkg.unmetConditions.map((c) => h("li", { text: humanizeCellIds(c) }))),
        )
      : null,
    table,
  );

  // 当前证据面板
  const detailHost = h("div", { id: "evidenceDetail", class: "evidence-detail" });
  const evidenceList = h("ul", { class: "evidence-list", id: "evidenceList" });
  const evidenceButtons = new Map();
  for (const fact of registry.facts) {
    const item = h("button", {
      type: "button",
      class: "evidence-item",
      dataset: { factId: fact.factId },
      "aria-pressed": "false",
      text: factLabel(fact, pkg),
    });
    item.addEventListener("click", () => selectEvidence(fact.factId));
    evidenceButtons.set(fact.factId, item);
    evidenceList.append(h("li", {}, item));
  }
  const evidencePanel = h("section", { class: "panel", id: "evidencePanel", "aria-labelledby": "evidenceTitle" },
    h("h2", { id: "evidenceTitle", text: "当前证据" }),
    detailHost,
    evidenceList,
  );

  // AI 分析面板（规则解释与模型草稿清晰区分）
  const ruleBlock = h("div", { class: "rule-block" },
    h("strong", { text: "规则解释（确定性计算，非模型生成）" }),
    pkg.observation
      ? h("p", { class: "aux", text: `原始观察：${pkg.observation.targetRunId} 与 ${pkg.observation.baselineRunId} 观测差 ${pkg.observation.deltaPp} 个百分点（两次运行${pkg.observation.configDiff.map((d) => ` 同时改 ${d.field}`).join("")}）` })
      : h("p", { class: "aux", text: "原始观察：目标或基准运行缺失，无法给出观测差。" }),
    pkg.pairs.length > 0
      ? h("ul", { class: "plain-list" },
          pkg.pairs.map((p) => h("li", { text: `已配对差 lr=${p.lr}：${p.treatedRunId} vs ${p.controlRunId}，差 ${p.deltaPp} 个百分点` })),
        )
      : h("p", { class: "aux", text: "已配对差：尚无同条件配对（增强贡献未知）。" }),
    h("ul", { class: "plain-list" },
      current.conclusions.map((c) =>
        h("li", {
          text: `[${c.result}] ${c.ruleId.startsWith("cell@") ? `格 ${describeCellId(c.ruleId.slice(5))}` : humanizeCellIds(c.ruleId)}：${humanizeCellIds(c.detail)}`,
        }),
      ),
    ),
  );

  const analysis = await data.getAnalysis(ACTOR, current.revisionId);
  if (seq !== renderSeq) return;
  const modelEvent = [...events].reverse().find((e) => e.node === "model");
  const aiBody = h("div", { class: "ai-body", id: "aiBody" });

  if (current.modelOutput === "ready" && analysis) {
    const sections = [
      ["观察到什么", analysis.output.observation],
      ["能否归因", analysis.output.interpretation],
      ["下一步怎么做", analysis.output.nextAction],
    ];
    for (const [title, section] of sections) {
      const citations = h("div", { class: "citations", "aria-label": `${title} 的证据引用` },
        section.evidenceIds.map((id) =>
          h("button", {
            type: "button",
            class: "citation",
            text: shortId(id),
            "aria-label": `证据引用 ${id}`,
            onclick: () => selectEvidence(id),
          }),
        ),
      );
      aiBody.append(
        h("div", { class: "ai-block" },
          h("h3", { text: title }),
          h("p", { text: section.text }),
          citations,
        ),
      );
    }
    aiBody.append(
      h("div", { class: "ai-block" },
        h("h3", { text: "建议改写" }),
        h("p", { class: "aux", text: `学生原句：${question.rawClaim}` }),
        h("p", { text: analysis.output.revisedClaim.text }),
        h("div", { class: "citations" },
          analysis.output.revisedClaim.evidenceIds.map((id) =>
            h("button", { type: "button", class: "citation", text: shortId(id), "aria-label": `证据引用 ${id}`, onclick: () => selectEvidence(id) }),
          ),
        ),
      ),
    );
    aiBody.append(
      h("p", { class: "model-meta", text: `模型标识：${analysis.provider} · ${analysis.model} · ${analysis.promptVersion} · 作业 ${viewedJob ? viewedJob.jobId : "—"} · 生成于 ${formatUpdatedAt(analysis.createdAt)}` }),
    );
  } else {
    const unavailable = current.modelOutput === "unavailable";
    const reason = modelEvent && modelEvent.status === "failed" ? modelEvent.summary : `模型输出状态：${modelGlyph(current.modelOutput).text}`;
    aiBody.append(
      h("div", { class: unavailable ? "notice" : "notice notice-error", role: "status" },
        h("strong", { text: unavailable ? "AI 未接通（模型服务未配置）" : `AI 分析未完成（${modelGlyph(current.modelOutput).text}）` }),
        h("p", { text: reason }),
        h("p", { class: "aux", text: "矩阵与规则解释不受影响，可继续查看。" }),
      ),
      h("button", {
        class: "btn",
        type: "button",
        id: "retryModel",
        disabled: unavailable,
        text: "重试模型分析",
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          const viewedBefore = qView.revisionId;
          showStatus("已重新提交模型作业…（等待真实模型响应，矩阵不受影响）");
          try {
            // 新 requestId：同 requestId 是幂等重建，不会真的重试
            const retry = await watchStepsWhile(
              questionId,
              wf.analyze(ACTOR, { requestId: `req-retry-${Date.now()}`, questionId }),
            );
            if (retry.gated) {
              showStatus(retry.reason, true);
            } else if (qView.revisionId !== viewedBefore) {
              showStatus(`重试完成（作业 ${retry.job.jobId}，新版本已写入历史）；你查看的版本未变`);
            } else {
              qView.revisionId = retry.revisionId;
              showStatus(
                `重试完成（作业 ${retry.job.jobId}）：${retry.modelOutput === "ready" ? "模型分析已生成" : `模型仍不可用（${modelGlyph(retry.modelOutput).text}），见上方原因`}`,
                retry.modelOutput !== "ready",
              );
            }
          } catch (error) {
            showStatus(`重试失败：${error && error.message ? error.message : String(error)}`, true);
          }
          await renderQuestion(questionId);
        },
      }),
      unavailable ? h("p", { class: "aux", text: "模型服务未接通：需先在站点接入模型服务，重试才会生效。" }) : null,
    );
  }

  const aiPanel = h("section", { class: "panel", id: "aiPanel", "aria-labelledby": "aiTitle" },
    h("h2", { id: "aiTitle", text: "AI 分析" }),
    ruleBlock,
    aiBody,
  );

  // 下一组实验
  const nextBody = h("div", { id: "nextBody" });
  if (pkg.suggestions.length === 0) {
    nextBody.append(h("p", { class: "aux", text: "当前版本没有待补实验。" }));
  } else {
    for (const suggestion of pkg.suggestions) {
      const changeText = suggestion.change.length
        ? suggestion.change.map((c) => `${c.field}: ${String(c.from)} → ${String(c.to)}`).join("；")
        : "无需变更配置";
      nextBody.append(
        h("div", { class: "suggestion-card", dataset: { cellId: suggestion.cellId } },
          h("div", {}, h("strong", { text: "目标条件： " }), `lr=${suggestion.lr}，增强${augLabel(String(suggestion.augmentation))}`),
          h("div", {}, h("strong", { text: "唯一变更： " }), changeText),
          h("div", { class: "aux" }, `复制自 ${suggestion.copyFromRunId} · 以后与 ${suggestion.compareToRunId ?? `同档另一格 ${describeCellId(suggestion.cellId)}`} 比较`),
          h("div", { class: "suggestion-actions" },
            h("button", { class: "btn", type: "button", text: "复制补跑配置", onclick: (e) => copySuggestion(suggestion, e.currentTarget) }),
            h("button", { class: "btn", type: "button", text: "录入实测结果", onclick: (e) => openDrawer("backfill", suggestion, e.currentTarget) }),
            h("button", { class: "btn", type: "button", text: "导入新增记录", onclick: (e) => openDrawer("import", null, e.currentTarget) }),
          ),
        ),
      );
    }
  }
  const nextPanel = h("section", { class: "panel", id: "nextPanel", "aria-labelledby": "nextTitle" },
    h("h2", { id: "nextTitle", text: "下一组实验" }),
    nextBody,
  );

  const layout = h("div", { class: "q-layout" },
    h("div", { class: "q-col" }, matrixPanel, evidencePanel),
    h("div", { class: "q-col" }, aiPanel, nextPanel),
  );

  // 版本记录（主体之下）
  const versionList = h("div", { class: "version-list", id: "versionList" },
    [...versions].reverse().map((version, reverseIndex) => {
      const index = versions.length - reverseIndex;
      const isCurrent = version.revisionId === current.revisionId;
      const button = h("button", {
        type: "button",
        class: "btn",
        text: isCurrent ? "正在查看" : "查看",
        "aria-label": `查看 V${index}`,
        onclick: () => {
          qView.revisionId = version.revisionId;
          renderQuestion(questionId);
        },
      });
      return h("div", { class: "version-item", dataset: { revisionId: version.revisionId } },
        h("div", {}, h("strong", { text: `V${index} · ${shortId(version.revisionId)}` }), ` · 父版本 ${version.parentId ? shortId(version.parentId) : "无"} · ${formatUpdatedAt(version.createdAt)}`),
        h("div", {}, modelBadge(version.modelOutput), ` · 输入运行 ${version.inputSnapshot.runs.map((r) => r.runId).join("、") || "无"} · 结论 ${version.conclusions.length} 条`),
        isCurrent ? button : h("span", {}, button),
      );
    }),
  );
  const versionsPanel = h("section", { class: "panel", id: "versionsPanel", "aria-labelledby": "versionsTitle" },
    h("h2", { id: "versionsTitle", text: `版本记录（${versions.length}）` }),
    versionList,
  );

  if (seq !== renderSeq) return;
  main.append(layout, researchPanel, versionsPanel);

  // —— 选择交互（不整页重绘，保留焦点）——
  function applyCellClasses() {
    for (const [key, button] of cellButtons) {
      const selected = qView.selectedKey === key;
      const linked = qView.highlightKeys.includes(key);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const td = button.parentElement;
      td.classList.toggle("selected", selected);
      td.classList.toggle("linked", linked && !selected);
    }
    for (const [factId, item] of evidenceButtons) {
      item.setAttribute("aria-pressed", qView.selectedEvidenceId === factId ? "true" : "false");
    }
  }

  function updateEvidenceDetail() {
    clear(detailHost);
    if (qView.selectedEvidenceId) {
      const fact = registry.facts.find((f) => f.factId === qView.selectedEvidenceId);
      if (fact) {
        detailHost.append(
          h("p", { class: "detail-title", text: "证据说明" }),
          h("p", { text: factLabel(fact, pkg) }),
          h("p", { class: "aux" },
            "编号 ",
            h("span", { title: fact.factId, text: shortId(fact.factId) }),
            fact.cellId
              ? h("span", { title: fact.cellId, text: ` · 关联格 ${describeCellId(fact.cellId)}` })
              : "",
            fact.runIds && fact.runIds.length ? ` · 关联运行 ${fact.runIds.join("、")}` : "",
          ),
        );
        return;
      }
    }
    if (qView.selectedKey) {
      const [lrText, augText] = qView.selectedKey.split("|");
      const cell = matrix.cells.find((c) => String(c.lr) === lrText && c.augmentation === augText);
      if (cell) {
        if (cell.state === "measured" && cell.runId) {
          const run = runs.find((r) => r.runId === cell.runId);
          detailHost.append(
            h("p", { class: "detail-title", text: `实测格 lr=${cell.lr} · 增强${augLabel(cell.augmentation)}` }),
            run
              ? h("dl", { class: "detail-grid" },
                  h("dt", { text: "runId" }), h("dd", { text: run.runId }),
                  h("dt", { text: "准确率" }), h("dd", { text: formatAccuracy(run.metrics.accuracy) }),
                  h("dt", { text: "数据来源" }), h("dd", {}, sourceBadge(run.source)),
                  h("dt", { text: "模型" }), h("dd", { text: String(run.config.model) }),
                  h("dt", { text: "评测集" }), h("dd", { text: String(run.config.evalSplit) }),
                  h("dt", { text: "种子" }), h("dd", { text: String(run.config.seed) }),
                  h("dt", { text: "优化器" }), h("dd", { text: String(run.config.optimizer ?? "—") }),
                  h("dt", { text: "轮数" }), h("dd", { text: String(run.config.epochs ?? "—") }),
                  h("dt", { text: "学习率" }), h("dd", { text: String(run.config.lr) }),
                  h("dt", { text: "增强" }), h("dd", { text: String(run.config.augmentation) }),
                  h("dt", { text: "导入时间" }), h("dd", { text: run.metadata.importedAt }),
                )
              : h("p", { class: "aux", text: "原始行不在本版本快照中。" }),
            run ? h("pre", { class: "raw-row", text: JSON.stringify(run, null, 2) }) : null,
          );
        } else if (cell.state === "suggested" && cell.cellId) {
          const suggestion = pkg.suggestions.find((s) => s.cellId === cell.cellId);
          detailHost.append(
            h("p", { class: "detail-title", text: `待补格 lr=${cell.lr} · 增强${augLabel(cell.augmentation)}` }),
            suggestion
              ? h("dl", { class: "detail-grid" },
                  h("dt", { text: "复制运行" }), h("dd", { text: suggestion.copyFromRunId }),
                  h("dt", { text: "唯一变更" }), h("dd", { text: suggestion.change.map((c) => `${c.field}: ${String(c.from)} → ${String(c.to)}`).join("；") || "无需变更" }),
                  h("dt", { text: "固定条件" }), h("dd", { text: suggestion.keepConditions.map((c) => `${c.field}=${String(c.value)}`).join("，") }),
                  h("dt", { text: "以后比较" }), h("dd", { text: suggestion.compareToRunId ?? `同档另一格 ${describeCellId(suggestion.cellId)}` }),
                )
              : h("p", { class: "aux", text: "该格待确认配置（见缺口说明），暂不能生成补跑单。" }),
          );
        } else {
          detailHost.append(
            h("p", { class: "detail-title", text: `空格 lr=${cell.lr} · 增强${augLabel(cell.augmentation)}` }),
            h("p", { class: "aux", text: "未跑：本版本快照中没有该条件的运行，不显示任何推断值。" }),
          );
        }
        return;
      }
    }
    detailHost.append(h("p", { class: "aux", text: "选择矩阵格或右侧证据条目，在此查看配置、来源与说明。" }));
  }

  function selectCell(key) {
    qView.selectedKey = key;
    qView.highlightKeys = [];
    qView.selectedEvidenceId = null;
    applyCellClasses();
    updateEvidenceDetail();
  }

  function selectEvidence(factId) {
    const fact = registry.facts.find((f) => f.factId === factId);
    if (!fact) return;
    qView.selectedEvidenceId = factId;
    qView.selectedKey = null;
    qView.highlightKeys = evidenceTargetKeys(fact, pkg, matrix);
    applyCellClasses();
    updateEvidenceDetail();
    const first = qView.highlightKeys[0];
    if (first && cellButtons.get(first)) {
      cellButtons.get(first).scrollIntoView({ block: "nearest" });
    }
  }

  applyCellClasses();
  updateEvidenceDetail();

  // 范围变化后：自动选中新出现的建议格（高亮另一空格）
  if (qView.autoSelectNewSuggested) {
    const previous = qView.autoSelectNewSuggested;
    qView.autoSelectNewSuggested = null;
    const newly = matrix.cells.find((c) => c.state === "suggested" && !previous.has(c.key));
    if (newly && cellButtons.has(newly.key)) selectCell(newly.key);
  }

  async function doChangeScope(scope) {
    const viewedBefore = qView.revisionId;
    showStatus("正在更改范围并生成新版本…（读取快照 → 查找对照 → 请求模型）");
    try {
      const before = new Set(matrix.cells.filter((c) => c.state === "suggested").map((c) => c.key));
      const result = await watchStepsWhile(
        questionId,
        wf.changeScope(ACTOR, {
          questionId,
          scope,
          requestId: `req-scope-${Date.now()}`,
          expectedParentId: question.currentRevisionId,
        }),
      );
      if (result.gated) {
        showStatus(result.reason, true);
      } else if (qView.revisionId !== viewedBefore) {
        showStatus(`范围更改完成，新版本已写入历史；你查看的版本未变（作业 ${result.job.jobId}）`);
      } else {
        qView.revisionId = result.revisionId;
        qView.autoSelectNewSuggested = before;
        showStatus(`范围已改为「${scope === "both_lrs" ? "两档" : "目标学习率"}」，已生成新版本（作业 ${result.job.jobId}）`);
      }
    } catch (error) {
      showStatus(`范围更改失败：${error && error.message ? error.message : String(error)}`, true);
    }
    await renderQuestion(questionId);
  }
}

function sourceBadge(source) {
  return h("span", { class: "badge" },
    h("span", { class: "shape", "aria-hidden": "true", text: source === "demo" ? "◇" : "●" }),
    source === "demo" ? "演示" : "真实",
  );
}

function factLabel(fact, pkg) {
  switch (fact.kind) {
    case "cell-measured": {
      const cell = pkg.cells.find((c) => c.cellId === fact.cellId);
      const where = cell ? `${cell.lr}/${augLabel(String(cell.augmentation))}` : describeCellId(String(fact.cellId));
      return `格 ${where}：${String(fact.runId ?? fact.value)} 实测 ${formatAccuracy(Number(fact.value))}`;
    }
    case "cell-missing": {
      const cell = pkg.cells.find((c) => c.cellId === fact.cellId);
      const where = cell ? `${cell.lr}/${augLabel(String(cell.augmentation))}` : describeCellId(String(fact.cellId));
      return `格 ${where}：未测（缺测值为 null）`;
    }
    case "pair":
      return `配对差 lr=${pkg.pairs.find((p) => p.pairId === fact.factId)?.lr ?? "?"}：${(fact.runIds ?? []).join(" vs ")}，差 ${String(fact.value)} 个百分点`;
    case "action": {
      const text = humanizeCellIds(String(fact.value));
      return `补跑建议：${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`;
    }
    case "condition":
      return `缺口：${humanizeCellIds(String(fact.value))}`;
    case "run":
      return `运行 ${String(fact.value)}`;
    case "contribution":
      return `增强贡献 ${String(fact.value)} 个百分点`;
    case "number":
      return fact.factId === "fact:obs-delta"
        ? `原始观测差 ${String(fact.value)} 个百分点`
        : `主张增幅 ${String(fact.value)} 个百分点`;
    default:
      return `${fact.factId}: ${String(fact.value ?? "")}`;
  }
}

function evidenceTargetKeys(fact, pkg, matrix) {
  const keysOfRuns = (runIds) =>
    matrix.cells
      .filter((c) => c.runId && runIds.includes(c.runId))
      .map((c) => c.key);
  if (fact.cellId) {
    const cell = matrix.cells.find((c) => c.cellId === fact.cellId);
    return cell ? [cell.key] : [];
  }
  if (fact.kind === "pair") {
    const pair = pkg.pairs.find((p) => p.pairId === fact.factId);
    return pair ? keysOfRuns([pair.treatedRunId, pair.controlRunId]) : [];
  }
  if (fact.runIds && fact.runIds.length > 0) return keysOfRuns(fact.runIds);
  // 仅做引用→可视化链接（读证据包既有结构，不做配对/算术）：
  if (fact.factId === "fact:obs-delta" && pkg.observation) {
    return keysOfRuns([pkg.observation.targetRunId, pkg.observation.baselineRunId]);
  }
  if (fact.kind === "action") {
    const suggestion = pkg.suggestions.find((s) => s.suggestionId === fact.factId);
    const cell = suggestion ? matrix.cells.find((c) => c.cellId === suggestion.cellId) : null;
    return cell ? [cell.key] : [];
  }
  return [];
}

// ---------- 澄清面板（问题未明确时的主操作） ----------

function renderClarifyPanel(question) {
  const runs = [];
  const host = h("section", { class: "panel", id: "clarifyPanel", "aria-labelledby": "clarifyTitle" },
    h("h2", { id: "clarifyTitle", text: "回答澄清，确认范围" }),
    h("p", { class: "aux", text: "问题尚未明确。回答下面的范围问题后才会开始分析与矩阵。" }),
  );

  const datalistId = "clarifyRunIds";
  const baselineInput = h("input", { type: "text", id: "clarifyBaseline", list: datalistId, autocomplete: "off", placeholder: "如 R01" });
  const targetInput = h("input", { type: "text", id: "clarifyTarget", list: datalistId, autocomplete: "off", placeholder: "如 R02" });
  const scopeName = "clarifyScope";
  const lr1 = h("input", { type: "number", id: "clarifyLr1", step: "any", min: "0", placeholder: "如 0.001" });
  const lr2 = h("input", { type: "number", id: "clarifyLr2", step: "any", min: "0", placeholder: "如 0.01" });
  const status = h("p", { class: "aux", id: "clarifyStatus", role: "status" });

  data.listRuns(ACTOR, question.projectId).then((projectRuns) => {
    runs.push(...projectRuns);
    const options = h("datalist", { id: datalistId },
      projectRuns.map((r) => h("option", { value: r.runId })),
    );
    host.append(options);
    const lrs = deriveLrOptions(projectRuns);
    if (lrs.length >= 1) lr1.value = String(lrs[0]);
    if (lrs.length >= 2) lr2.value = String(lrs[1]);
    if (projectRuns.length === 0) {
      host.append(h("p", { class: "aux", text: "项目暂无运行记录：请手动填写 runId 与两档学习率。" }));
    }
  });

  host.append(
    h("div", { class: "form-row" },
      h("div", { class: "field" }, h("label", { for: "clarifyBaseline", text: "基线运行（对照）" }), baselineInput),
      h("div", { class: "field" }, h("label", { for: "clarifyTarget", text: "目标运行" }), targetInput),
    ),
    h("div", { class: "field", role: "radiogroup", "aria-label": "问题范围" },
      h("label", {}, h("input", { type: "radio", name: scopeName, value: "target_lr" }), "目标学习率"),
      h("label", {}, h("input", { type: "radio", name: scopeName, value: "both_lrs" }), "两档"),
    ),
    h("div", { class: "form-row" },
      h("div", { class: "field" }, h("label", { for: "clarifyLr1", text: "学习率一" }), lr1),
      h("div", { class: "field" }, h("label", { for: "clarifyLr2", text: "学习率二" }), lr2),
    ),
    h("div", { class: "submit-row" },
      h("button", { class: "btn btn-primary", type: "button", id: "clarifyConfirm", text: "确认范围并开始分析" }),
      status,
    ),
  );

  host.addEventListener("click", async (event) => {
    const button = event.target.closest("#clarifyConfirm");
    if (!button) return;
    button.disabled = true;
    status.textContent = "提交中…";
    try {
      const scopeInput = host.querySelector(`input[name="${scopeName}"]:checked`);
      const proposal = {
        factor: "augmentation",
        metric: "accuracy",
        scope: null,
        expectedDeltaPp: null,
        clarifyingQuestion: "",
      };
      const confirmed = await wf.confirmScope(ACTOR, {
        questionId: question.questionId,
        proposal,
        source: "manual",
        targetRunId: targetInput.value.trim(),
        baselineRunId: baselineInput.value.trim(),
        scope: scopeInput ? scopeInput.value : "",
        learningRates: [Number(lr1.value), Number(lr2.value)],
      });
      if (!("question" in confirmed)) {
        status.textContent = `${confirmed.detail}${confirmed.clarifyingQuestion ? ` 追问：${confirmed.clarifyingQuestion}` : ""}`;
        button.disabled = false;
        return;
      }
      const result = await wf.analyze(ACTOR, {
        requestId: `req-web-${Date.now()}`,
        questionId: question.questionId,
      });
      if (result.gated) {
        status.textContent = result.reason;
        button.disabled = false;
        return;
      }
      qView.revisionId = result.revisionId;
      qView.statusText = `范围已确认，分析状态：${result.status}`;
      qView.statusIsError = false;
      await renderQuestion(question.questionId);
    } catch (error) {
      status.textContent = `确认失败：${error && error.message ? error.message : String(error)}`;
      button.disabled = false;
    }
  });

  return host;
}

// ---------- 回填 / 导入抽屉 ----------

function openDrawer(mode, suggestion, trigger) {
  closeDrawer(false);
  const overlay = h("div", { class: "drawer-overlay", id: "drawerOverlay" });
  const drawer = h("aside", {
    class: "drawer",
    id: "drawer",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "drawerTitle",
    tabindex: "-1",
  });
  qView.drawer = { mode, suggestion, trigger };

  const status = h("p", { class: "aux", id: "drawerStatus", role: "status" });
  const error = h("p", { class: "field-error", id: "drawerError", hidden: true });

  if (mode === "backfill" && suggestion) {
    const runIdInput = h("input", { type: "text", id: "fillRunId", autocomplete: "off", placeholder: "如 R03" });
    const accuracyInput = h("input", { type: "number", id: "fillAccuracy", step: "0.01", min: "0", max: "100", placeholder: "必填，例如 81.8" });
    const demoInput = h("input", { type: "checkbox", id: "fillDemo" });
    const fixedInputs = suggestion.keepConditions.map((condition) => {
      const input = h("input", { type: "text", value: String(condition.value), dataset: { field: condition.field } });
      return { field: condition.field, input };
    });

    const demoBtn = h("button", { class: "btn", type: "button", id: "fillDemoBtn", text: "载入演示 R03（演示）" });
    const confirmBtn = h("button", { class: "btn btn-primary", type: "button", id: "drawerConfirm", text: "确认导入" });
    const cancelButton = h("button", { class: "btn", type: "button", id: "drawerCancel", text: "取消" });

    drawer.append(
      h("h2", { id: "drawerTitle", text: "录入实测结果（补跑回填）" }),
      h("p", { class: "aux", text: `目标格 lr=${suggestion.lr}，增强${augLabel(String(suggestion.augmentation))}；复制自 ${suggestion.copyFromRunId}，仅该条件为变更项。` }),
      h("div", { class: "field" }, h("label", { for: "fillRunId", text: "runId" }), runIdInput),
      h("div", { class: "field" }, h("label", { for: "fillAccuracy", text: "实测准确率（0–100，必填）" }), accuracyInput, error),
      h("div", { class: "field" },
        h("label", {}, demoInput, " 标记为演示数据（demo）"),
        demoBtn,
      ),
      h("div", { class: "field" },
        h("span", { class: "aux", text: "固定条件（可核对）：" }),
        ...fixedInputs.map(({ field, input }) =>
          h("div", { class: "field", style: "flex-direction:row;align-items:center;gap:8px" },
            h("label", { for: `fill-${field}`, text: field, style: "min-width:96px" }),
            Object.assign(input, { id: `fill-${field}` }),
          ),
        ),
      ),
      h("div", { class: "drawer-actions" }, confirmBtn, cancelButton),
      status,
    );

    demoBtn.addEventListener("click", () => {
      runIdInput.value = "R03";
      accuracyInput.value = "81.8";
      demoInput.checked = true;
      status.textContent = "已载入演示 R03（演示）；仍可修改后再确认。";
    });

    confirmBtn.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const runId = runIdInput.value.trim();
      const accuracyRaw = accuracyInput.value.trim();
      error.hidden = true;
      accuracyInput.removeAttribute("aria-invalid");
      runIdInput.removeAttribute("aria-invalid");

      if (!runId) {
        runIdInput.setAttribute("aria-invalid", "true");
        error.hidden = false;
        error.textContent = "请填写 runId";
        runIdInput.focus();
        return;
      }
      if (accuracyRaw === "") {
        accuracyInput.setAttribute("aria-invalid", "true");
        error.hidden = false;
        error.textContent = "实测准确率必须由你填写，不会默认任何数值";
        accuracyInput.focus();
        return;
      }
      const accuracy = Number(accuracyRaw);
      const accuracyError = validateAccuracy(accuracy);
      if (accuracyError) {
        accuracyInput.setAttribute("aria-invalid", "true");
        error.hidden = false;
        error.textContent = accuracyError;
        accuracyInput.focus();
        return;
      }

      const config = {};
      for (const { field, input } of fixedInputs) {
        const raw = input.value.trim();
        if (raw === "") continue;
        const numeric = Number(raw);
        config[field] = ["seed", "epochs", "lr"].includes(field) && Number.isFinite(numeric) ? numeric : raw;
      }
      config.lr = suggestion.lr;
      config.augmentation = suggestion.augmentation;

      const run = {
        runId,
        projectId: qView.projectIdForDrawer ?? undefined,
        config,
        source: demoInput.checked ? "demo" : "real",
        metrics: { accuracy },
        metadata: {
          importedAt: new Date().toISOString(),
          ...(demoInput.checked ? { note: "演示数据" } : {}),
        },
      };
      button.disabled = true;
      status.textContent = "提交中…（补入记录 → 重新分析，等待真实结果）";
      const questionIdAtOpen = qView.questionId;
      try {
        const result = await watchStepsWhile(
          questionIdAtOpen,
          wf.appendRunsAndReanalyze(ACTOR, {
            requestId: `req-fill-${Date.now()}`,
            questionId: questionIdAtOpen,
            runs: [run],
          }),
        );
        if (result.gated) {
          status.textContent = result.reason;
          button.disabled = false;
          return;
        }
        closeDrawer(false);
        if (qView.questionId === questionIdAtOpen) {
          qView.revisionId = result.revisionId;
          showStatus(`已回填 ${runId}，生成新版本（作业 ${result.job.jobId}）`);
          await renderQuestion(questionIdAtOpen);
          const select = document.getElementById("versionSelect");
          if (select) select.focus();
          else document.getElementById("main").focus();
        }
      } catch (err) {
        status.textContent = `导入失败：${err && err.message ? err.message : String(err)}`;
        button.disabled = false;
      }
    });
  } else {
    const textarea = h("textarea", { id: "importText", spellcheck: "false", placeholder: "runId,model,evalSplit,seed,lr,augmentation,optimizer,epochs,accuracy" });
    const previewStatus = h("p", { class: "aux", id: "importPreviewStatus", role: "status" });
    const previewBtn = h("button", { class: "btn", type: "button", id: "importPreview", text: "预览映射" });
    const confirmButton = h("button", { class: "btn btn-primary", type: "button", id: "drawerConfirm", text: "确认导入", disabled: true });
    const cancelButton = h("button", { class: "btn", type: "button", id: "drawerCancel", text: "取消" });
    drawer.append(
      h("h2", { id: "drawerTitle", text: "导入新增记录" }),
      h("div", { class: "field" }, h("label", { for: "importText", text: "粘贴 CSV/TSV（首行表头）" }), textarea),
      h("div", { class: "drawer-actions" }, previewBtn),
      previewStatus,
      h("div", { class: "drawer-actions" }, confirmButton, cancelButton),
      status,
    );

    let preview = null;
    previewBtn.addEventListener("click", async () => {
      previewStatus.textContent = "预览中…";
      try {
        preview = await wf.previewImport(ACTOR, {
          projectId: qView.projectIdForDrawer,
          text: textarea.value,
          importedAt: new Date().toISOString(),
        });
        if (preview.mapping.status !== "ok") {
          previewStatus.textContent = `映射冲突：${preview.mapping.conflicts.map((c) => c.headers.join("、")).join("；")}`;
          confirmButton.disabled = true;
          return;
        }
        const errorText = preview.errors.slice(0, 3).map((e) => `行${e.row}列${e.column}: ${e.message}`).join("；");
        previewStatus.textContent = `预览：新增 ${preview.added.length}，重复 ${preview.duplicates.length}，缺配置 ${preview.incomplete.length}，冲突 ${preview.conflicts.length}${preview.errors.length ? `；错误 ${errorText}` : ""}`;
        confirmButton.disabled = preview.blocking;
      } catch (err) {
        previewStatus.textContent = `预览失败：${err && err.message ? err.message : String(err)}`;
        confirmButton.disabled = true;
      }
    });

    confirmButton.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!preview || preview.blocking) return;
      const runsToCommit = [...preview.added, ...preview.incomplete];
      if (runsToCommit.length === 0) {
        status.textContent = "没有可导入的新记录";
        return;
      }
      button.disabled = true;
      status.textContent = "提交中…（补入记录 → 重新分析，等待真实结果）";
      const questionIdAtOpen = qView.questionId;
      try {
        const result = await watchStepsWhile(
          questionIdAtOpen,
          wf.appendRunsAndReanalyze(ACTOR, {
            requestId: `req-import-${Date.now()}`,
            questionId: questionIdAtOpen,
            runs: runsToCommit,
          }),
        );
        if (result.gated) {
          status.textContent = result.reason;
          button.disabled = false;
          return;
        }
        closeDrawer(false);
        if (qView.questionId === questionIdAtOpen) {
          qView.revisionId = result.revisionId;
          showStatus(`已导入 ${runsToCommit.length} 条记录，生成新版本（作业 ${result.job.jobId}）`);
          await renderQuestion(questionIdAtOpen);
          const select = document.getElementById("versionSelect");
          if (select) select.focus();
          else document.getElementById("main").focus();
        }
      } catch (err) {
        status.textContent = `导入失败：${err && err.message ? err.message : String(err)}`;
        button.disabled = false;
      }
    });
  }

  drawer.addEventListener("click", (event) => {
    if (event.target.closest("#drawerCancel")) closeDrawer();
  });
  overlay.addEventListener("click", () => closeDrawer());

  const trap = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = drawer.querySelectorAll("button, input, textarea, select, a[href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  drawer.addEventListener("keydown", trap);

  document.body.append(overlay, drawer);
  const initial = drawer.querySelector("input, textarea, button");
  if (initial) initial.focus();
}

function closeDrawer(restoreFocus = true) {
  const current = qView.drawer;
  if (!current) return;
  const overlay = document.getElementById("drawerOverlay");
  const drawer = document.getElementById("drawer");
  if (overlay) overlay.remove();
  if (drawer) drawer.remove();
  qView.drawer = null;
  if (restoreFocus && current.trigger && current.trigger.isConnected) current.trigger.focus();
}

async function copySuggestion(suggestion, button) {
  const text = suggestion.keepConditions
    .map((c) => `${c.field}=${String(c.value)}`)
    .concat(suggestion.change.map((c) => `${c.field}=${String(c.to)}`))
    .join(", ");
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败，配置见「唯一变更」";
  }
  setTimeout(() => {
    button.textContent = "复制补跑配置";
  }, 2000);
}

// ---------- 研究库侧栏 ----------

const desktopSidebarQuery = window.matchMedia("(min-width: 1200px)");
let sidebarWasDesktop = desktopSidebarQuery.matches;
let sidebarWidth = parseSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
let sidebarCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
let resizePointerId = null;
let resizeStartX = 0;
let resizeStartWidth = SIDEBAR_DEFAULT_WIDTH;
const sidebarTreeImage = sidebarResizer.querySelector(".sidebar-tree-image");
const sidebarLeafSource = sidebarResizer.querySelector(".sidebar-leaf-source");
const sidebarFeatherMarkImage = sidebarResizer.closest(".sidebar").querySelector(".sidebar-feather-mark-image");
const sidebarFeatherImage = sidebarResizer.closest(".sidebar").querySelector(".sidebar-feather-image");
const sidebarLeafLayer = document.getElementById("sidebarLeafLayer");
const sidebarReducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let sidebarLeafReady = false;
let sidebarFeatherReadyCount = 0;
let lastSidebarLeafAt = 0;

function loadSidebarArtwork(image, onLoad) {
  image.addEventListener("load", onLoad, { once: true });
  image.addEventListener("error", () => {
    image.hidden = true;
  }, { once: true });
  image.src = image.dataset.src;
}

function markSidebarFeatherReady() {
  sidebarFeatherReadyCount += 1;
  if (sidebarFeatherReadyCount === 2) shell.classList.add("sidebar-feather-ready");
}

function emitSidebarLeaves() {
  if (!sidebarLeafReady || sidebarReducedMotionQuery.matches || resizePointerId === null) return;
  const now = performance.now();
  if (now - lastSidebarLeafAt < 90 || sidebarLeafLayer.childElementCount >= 12) return;
  lastSidebarLeafAt = now;
  const bounds = shell.classList.contains("sidebar-tree-ready")
    ? sidebarTreeImage.getBoundingClientRect()
    : sidebarResizer.getBoundingClientRect();
  for (let index = 0; index < 2 && sidebarLeafLayer.childElementCount < 12; index += 1) {
    const leaf = sidebarLeafSource.cloneNode(true);
    const x = bounds.left + bounds.width * (0.32 + Math.random() * 0.36);
    const y = bounds.top + bounds.height * (0.06 + Math.random() * 0.14);
    leaf.hidden = false;
    leaf.removeAttribute("data-src");
    leaf.className = "sidebar-falling-leaf";
    leaf.style.setProperty("--leaf-x", `${x}px`);
    leaf.style.setProperty("--leaf-y", `${y}px`);
    leaf.style.setProperty("--leaf-drift", `${-36 + Math.random() * 144}px`);
    leaf.style.setProperty("--leaf-fall", `${120 + Math.random() * 140}px`);
    leaf.style.setProperty("--leaf-spin", `${-220 + Math.random() * 520}deg`);
    leaf.style.setProperty("--leaf-scale", (0.72 + Math.random() * 0.36).toFixed(2));
    leaf.addEventListener("animationend", () => leaf.remove(), { once: true });
    sidebarLeafLayer.append(leaf);
  }
}

function syncSidebarChrome() {
  const desktop = desktopSidebarQuery.matches;
  const drawerOpen = !desktop && sidebar.classList.contains("open");
  const visible = desktop ? !sidebarCollapsed : drawerOpen;
  const action = desktop ? (visible ? "收起" : "展开") : (visible ? "关闭" : "打开");
  shell.classList.toggle("sidebar-collapsed", desktop && sidebarCollapsed);
  sidebar.setAttribute("aria-hidden", String(!visible));
  navBtn.setAttribute("aria-expanded", String(visible));
  navBtn.setAttribute("aria-label", `${action}研究库`);
  navBtn.title = `${action}研究库`;
  navBtn.querySelector(".nav-btn-label").textContent = `${action}研究库`;
  navBtn.querySelector(".nav-btn-icon").innerHTML = visible ? ICON_PANEL_CLOSE : ICON_PANEL_OPEN;
  const canResize = desktop && !sidebarCollapsed;
  sidebarResizer.tabIndex = canResize ? 0 : -1;
  sidebarResizer.setAttribute("aria-disabled", String(!canResize));
}

function applySidebarWidth(width, persist = false) {
  sidebarWidth = clampSidebarWidth(width);
  shell.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  sidebarResizer.setAttribute("aria-valuenow", String(sidebarWidth));
  sidebarResizer.setAttribute("aria-valuetext", `${sidebarWidth} 像素`);
  if (persist && desktopSidebarQuery.matches) {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }
}

function closeNav(restoreFocus = false) {
  sidebar.classList.remove("open");
  syncSidebarChrome();
  if (restoreFocus) navBtn.focus();
}

navBtn.addEventListener("click", () => {
  if (desktopSidebarQuery.matches) {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.remove("open");
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  } else {
    sidebar.classList.toggle("open");
  }
  syncSidebarChrome();
});

function finishSidebarResize(pointerId, persist = true) {
  if (pointerId !== resizePointerId) return;
  resizePointerId = null;
  document.body.classList.remove("sidebar-resizing");
  if (sidebarResizer.hasPointerCapture(pointerId)) sidebarResizer.releasePointerCapture(pointerId);
  if (persist && desktopSidebarQuery.matches) {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }
}

sidebarResizer.addEventListener("pointerdown", (event) => {
  if (!desktopSidebarQuery.matches || sidebarCollapsed || resizePointerId !== null) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  resizePointerId = event.pointerId;
  resizeStartX = event.clientX;
  resizeStartWidth = sidebarWidth;
  sidebarResizer.focus({ preventScroll: true });
  sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("sidebar-resizing");
  emitSidebarLeaves();
});

sidebarResizer.addEventListener("pointermove", (event) => {
  if (event.pointerId !== resizePointerId) return;
  event.preventDefault();
  applySidebarWidth(resizeStartWidth + event.clientX - resizeStartX);
  emitSidebarLeaves();
});

sidebarResizer.addEventListener("pointerup", (event) => finishSidebarResize(event.pointerId));
sidebarResizer.addEventListener("pointercancel", (event) => finishSidebarResize(event.pointerId));
sidebarResizer.addEventListener("lostpointercapture", (event) => finishSidebarResize(event.pointerId, false));

sidebarResizer.addEventListener("keydown", (event) => {
  if (!desktopSidebarQuery.matches || sidebarCollapsed) return;
  const next = sidebarWidthFromKey(sidebarWidth, event.key);
  if (next === sidebarWidth) return;
  event.preventDefault();
  applySidebarWidth(next, true);
});

function syncSidebarViewport() {
  const desktop = desktopSidebarQuery.matches;
  if (sidebarWasDesktop && !desktop) sidebar.classList.remove("open");
  sidebarWasDesktop = desktop;
  syncSidebarChrome();
}

desktopSidebarQuery.addEventListener("change", syncSidebarViewport);
window.addEventListener("resize", syncSidebarViewport);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (resizePointerId !== null) {
    finishSidebarResize(resizePointerId);
  } else if (!desktopSidebarQuery.matches && sidebar.classList.contains("open")) {
    closeNav(true);
  }
});

window.addEventListener("blur", () => {
  if (resizePointerId !== null) finishSidebarResize(resizePointerId);
});

// 侧栏为动态渲染：链接点击（含树内导航）后收起移动端抽屉
document.getElementById("sideNav").addEventListener("click", (event) => {
  if (event.target.closest("a") && !desktopSidebarQuery.matches) closeNav(true);
});

loadSidebarArtwork(sidebarTreeImage, () => shell.classList.add("sidebar-tree-ready"));
loadSidebarArtwork(sidebarLeafSource, () => {
  sidebarLeafReady = true;
});
loadSidebarArtwork(sidebarFeatherMarkImage, markSidebarFeatherReady);
loadSidebarArtwork(sidebarFeatherImage, markSidebarFeatherReady);
sidebarReducedMotionQuery.addEventListener("change", (event) => {
  if (event.matches) sidebarLeafLayer.replaceChildren();
});

applySidebarWidth(sidebarWidth);
syncSidebarChrome();

// ---------- 拖放导入 PDF（与「导入 PDF」按钮同一条本地解析路径） ----------

const dropOverlay = h("div", {
  id: "dropOverlay",
  class: "drop-overlay",
  hidden: true,
  "aria-hidden": "true",
  text: "松开以导入 PDF",
});
document.body.append(dropOverlay);

window.addEventListener("dragover", (event) => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  dropOverlay.hidden = false;
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) dropOverlay.hidden = true;
});
window.addEventListener("drop", (event) => {
  dropOverlay.hidden = true;
  if (!event.dataTransfer) return;
  const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith(".pdf"));
  if (!file) return;
  event.preventDefault();
  importPdfFile(file, null);
});

window.addEventListener("hashchange", () => {
  render();
});

render();

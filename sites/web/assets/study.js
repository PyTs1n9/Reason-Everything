// 研论书屋 · 研究界面（卡 09）：外框 + 项目列表 + 项目内问题列表 + 新问题/数据录入。
// 纯 JS（无类型标注）；业务走正式服务动作；持久化 = IndexedDB「本机保存」。
import { createIndexedDBBackend, LOCAL_STORAGE_LABEL } from "./gen/src/experiment/storage-indexeddb.js";
import { createDataService } from "./gen/src/experiment/storage.js";
import { createWorkflowService } from "./gen/src/workflow/service.js";
import { buildEvidencePackage } from "./gen/src/experiment/evidence.js";
import { validateAccuracy } from "./gen/src/experiment/runs.js";
import { buildFactRegistry } from "./gen/src/agent/facts.js";
import {
  PROJECT_TYPES,
  buildQuestionFormProfile,
  buildQuestionMatrix,
  buildSideTree,
  changeProjectType,
  computeDashboardStats,
  deriveLrOptions,
  describeCellId,
  evaluateEntryMissing,
  extractPaperTitle,
  filterProjects,
  filterProjectsByType,
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
  cardFeatherVariant,
  countPaperChars,
  paragraphizePage,
} from "./gen/src/web/model.js";
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  parseSidebarWidth,
  sidebarWidthFromKey,
} from "./gen/src/web/sidebar.js";
import { codePointSlice, locate } from "./gen/src/core/grounding.js";
import {
  extractPaperPages,
  extractPaperTitleFromPage,
  generatePaperCandidates,
  verifyPaperQuote,
  PAPER_MODEL_PATH,
  readPdfMetadataTitle,
} from "./gen/src/web/paper-study.js";
import { locateInRegions, locateInTextItems } from "./gen/src/web/paper-locate.js";
import { pagesNeedingOcr, paperPageSource, readOcrRequest, requestPaperOcr, toPaperRegions } from "./gen/src/web/paper-ocr.js";
import { createAgentService } from "./gen/src/agent/service.js";
import { createSameOriginModelAdapter } from "./gen/src/web/model-adapter.js";
import { MODEL_CONFIG_PATH } from "./gen/src/web/model-config-path.js";
import { createLocalLibraryClient } from "./gen/src/web/local-library-client.js";

const DB_NAME = "agentflow-study";
const ACTOR = { userId: "local" };

const backend = createIndexedDBBackend(indexedDB, DB_NAME);
const data = createDataService(backend);
const wfDeps = { storage: data, agent: null, now: () => new Date().toISOString() };
const wf = createWorkflowService(wfDeps);
let localTokenPromise = null;

async function localToken() {
  if (!localTokenPromise) {
    localTokenPromise = fetch("/__agentflow_local.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("本机服务未启动，请先运行 node scripts/serve-web.mjs");
        const payload = await response.json();
        if (typeof payload.token !== "string" || !payload.token) throw new Error("本地服务身份信息无效");
        return payload.token;
      })
      .catch((error) => {
        localTokenPromise = null;
        throw error;
      });
  }
  return localTokenPromise;
}

async function setAgent(enabled) {
  wfDeps.agent = enabled
    ? createAgentService(createSameOriginModelAdapter(fetch), { timeoutMs: 70_000 })
    : null;
}

async function refreshAgent() {
  try {
    const snapshot = await modelConfigRequest("GET");
    await setAgent(Boolean(snapshot.activeServiceId));
    return snapshot;
  } catch {
    await setAgent(false);
    throw new Error("本地模型服务未启动，请先运行 node scripts/serve-web.mjs");
  }
}

async function modelConfigRequest(method, path = "", body) {
  const send = async (token) => fetch(`${MODEL_CONFIG_PATH}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-agentflow-local-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let response = await send(await localToken());
  if (response.status === 401) {
    localTokenPromise = null;
    response = await send(await localToken());
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `模型服务请求失败（HTTP ${response.status}）`);
  return payload;
}

const localLibrary = createLocalLibraryClient({
  getToken: (refresh = false) => {
    if (refresh) localTokenPromise = null;
    return localToken();
  },
});

// 验收驱动口：生产使用同源模型适配器；测试可注入 mock，输出始终标 mock。
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

let saveModeSeq = 0;

function closeSaveModePop(restoreFocus = false) {
  saveModeSeq++;
  if (saveModePop.hidden) return;
  saveModePop.hidden = true;
  saveModeBtn.setAttribute("aria-expanded", "false");
  if (restoreFocus) saveModeBtn.focus();
}

function libraryBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function archiveBrowserPdfs() {
  const projects = await wf.listProjects(ACTOR);
  const files = [];
  for (const project of projects) {
    const studies = await data.listPaperStudies(ACTOR, project.projectId);
    for (const study of studies) {
      const file = await data.getPaperFile(ACTOR, project.projectId, study.sha256);
      if (file) files.push(file);
    }
  }
  const failures = [];
  for (const file of files) {
    try {
      await localLibrary.savePaper(file);
    } catch (error) {
      failures.push(`${file.filename}：${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("；"));
  return files.length;
}

async function openSaveModePop() {
  const seq = ++saveModeSeq;
  saveModePop.hidden = false;
  saveModeBtn.setAttribute("aria-expanded", "true");
  clear(saveModePop);
  saveModePop.append(h("p", { class: "aux", text: "读取中…" }));
  try {
    const projects = await wf.listProjects(ACTOR);
    let library = null;
    let libraryError = null;
    try {
      library = await localLibrary.status();
    } catch (error) {
      libraryError = error.message;
    }
    if (saveModePop.hidden || seq !== saveModeSeq) return;
    const questionCount = projects.reduce((sum, project) => sum + project.questionCount, 0);
    const info = buildSaveModeInfo({
      adapterLabel: LOCAL_STORAGE_LABEL,
      dbName: DB_NAME,
      projectCount: projects.length,
      questionCount,
      libraryPath: library?.path,
      paperCount: library?.paperCount,
      modelKeyPath: library?.modelKeyFile,
    });
    clear(saveModePop);
    const facts = h("dl", { class: "save-mode-facts" });
    for (const row of info.rows) facts.append(h("dt", { text: row.label }), h("dd", { text: row.value }));
    const chooseBtn = h("button", {
      class: "btn btn-primary local-library-choose", type: "button", text: library?.configured ? "更改本地文件夹" : "选择本地文件夹",
      "aria-expanded": "false", "aria-controls": "localLibraryForm",
    });
    const pathInput = h("input", {
      type: "text", id: "localLibraryPath", value: library?.path ?? "", autocomplete: "off", spellcheck: "false",
      placeholder: "如：D:\\Research\\研论书屋", "aria-label": "本地知识库绝对路径",
    });
    const browseBtn = h("button", { class: "btn", type: "button", id: "localLibraryBrowse", text: "浏览…" });
    const formError = h("p", { class: "field-error", role: "alert", hidden: true });
    const formStatus = h("p", { class: "aux", role: "status", text: "PDF 原件存入 papers/，加密模型密钥存入 secrets/。" });
    const form = h("form", { class: "local-library-form", id: "localLibraryForm", hidden: true },
      h("label", { for: pathInput.id, text: "文件夹绝对路径" }),
      h("div", { class: "local-library-path-row" }, pathInput, browseBtn),
      h("p", { class: "aux", text: "路径只发送到本机 Node 服务。首次选择会迁移当前模型凭据，并归档浏览器中已有的 PDF 原件。" }),
      formStatus,
      formError,
      h("button", { class: "btn btn-primary", type: "submit", text: "保存到此文件夹" }),
    );
    const submit = form.querySelector("button[type=submit]");
    submit.id = "localLibrarySave";
    chooseBtn.addEventListener("click", () => {
      form.hidden = !form.hidden;
      chooseBtn.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) pathInput.focus();
    });
    browseBtn.addEventListener("click", async () => {
      browseBtn.disabled = true;
      formError.hidden = true;
      formStatus.textContent = "正在打开本机文件夹选择器…";
      try {
        const path = await localLibrary.browse();
        if (path) {
          pathInput.value = path;
          formStatus.textContent = "已选择文件夹，点击「保存到此文件夹」确认。";
        } else {
          formStatus.textContent = "已取消选择，可手动输入绝对路径。";
        }
      } catch (error) {
        formError.hidden = false;
        formError.textContent = error.message;
      } finally {
        browseBtn.disabled = false;
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      formError.hidden = true;
      browseBtn.disabled = true;
      submit.disabled = true;
      formStatus.textContent = "正在保存文件夹并归档现有 PDF…";
      try {
        const selected = await localLibrary.select(pathInput.value);
        pathInput.value = selected.path;
        const count = await archiveBrowserPdfs();
        formStatus.textContent = `已归档 ${count} 个浏览器 PDF 原件。`;
        await openSaveModePop();
        toast("本地知识库文件夹已保存", "ok");
      } catch (error) {
        formError.hidden = false;
        formError.textContent = error.message;
        formStatus.textContent = "可检查路径后重试；已有文件不会被覆盖。";
      } finally {
        browseBtn.disabled = false;
        submit.disabled = false;
      }
    });
    const paperList = h("div", { class: "local-library-papers", "aria-label": "本地知识库 PDF" });
    if (!library?.papers.length) {
      paperList.append(h("p", { class: "aux", text: libraryError ? "本地知识库暂不可读" : "还没有归档 PDF，导入后会自动保存。" }));
    } else {
      for (const paper of library.papers.slice(0, 20)) {
        const reuseBtn = h("button", { class: "btn btn-small", type: "button", text: "取回" });
        reuseBtn.addEventListener("click", async () => {
          closeSaveModePop();
          try {
            const blob = await localLibrary.readPaper(paper.sha256);
            await importPdfFile(new File([blob], paper.filename, { type: "application/pdf" }), saveModeBtn);
          } catch (error) {
            toast(`取回失败：${error.message}`, "bad");
          }
        });
        paperList.append(h("div", { class: "local-library-paper" },
          h("div", {},
            h("strong", { text: paper.filename }),
            h("span", { class: "aux", text: `${libraryBytes(paper.size)} · ${new Date(paper.savedAt).toLocaleDateString("zh-CN")}` }),
          ),
          reuseBtn,
        ));
      }
      if (library.papers.length > 20) paperList.append(h("p", { class: "aux", text: `仅显示最近 20 篇，共 ${library.papers.length} 篇。` }));
    }
    if (libraryError) saveModePop.append(h("p", { class: "field-error", text: `本地知识库读取失败：${libraryError}` }));
    saveModePop.append(facts, h("p", { class: "aux save-pop-note", text: info.note }), chooseBtn, form, paperList);
  } catch (error) {
    if (saveModePop.hidden || seq !== saveModeSeq) return;
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

/** 内联图标：SVG 字符串来自本文件常量，不接受外部输入。 */
function icon(svg) {
  const box = document.createElement("span");
  box.className = "icon-box";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = svg;
  return box;
}

function badge(status) {  const { glyph, text } = statusGlyph(status);
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
  if (parts[0] === "models") return { view: "models" };
  if (parts[0] === "project" && parts[1]) {
    if (parts[2] === "paper" && parts[3]) {
      return {
        view: "project",
        projectId: parts[1],
        paper: parts[3],
        page: Number(parts[4]) || 0,
        cite: parts[5] ? decodeURIComponent(parts[5]) : null,
      };
    }
    return {
      view: "project",
      projectId: parts[1],
      paper: parts[4] || null,
      page: Number(parts[2]) || 0,
      cite: parts[3] ? decodeURIComponent(parts[3]) : null,
    };
  }
  if (parts[0] === "new" && parts[1]) return { view: "newQuestion", projectId: parts[1] };
  if (parts[0] === "question" && parts[1]) return { view: "question", questionId: parts[1] };
  return { view: "projects" };
}

let currentProjectId = null;

async function render() {
  const route = parseRoute();
  document.body.dataset.view = route.view;
  topbarBack.hidden = route.view !== "project";
  closeNav();
  closeSaveModePop();
  cleanupPaperReader();
  clear(main);
  try {
    if (route.view === "projects") await renderProjects();
    else if (route.view === "models") await renderModels();
    else if (route.view === "project") {
      currentProjectId = route.projectId;
      await renderProject(route.projectId, route.page, route.cite, route.paper);
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

  const rootLink = h("a", { class: "side-link side-root", href: "#/" },
    icon(ICON_LIBRARY), h("span", { class: "side-name", text: "全部项目" }));
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
    const hasQuestions = node.questions.length > 0;
    const expanded = hasQuestions && !collapsedProjectIds.has(node.projectId);
    const childBox = h("div", { class: "tree-children", role: "group", hidden: !expanded });

    const toggle = hasQuestions
      ? h("button", {
        class: "tree-toggle",
        type: "button",
        "aria-expanded": String(expanded),
        "aria-label": `${expanded ? "折叠" : "展开"}项目 ${node.name}`,
        text: expanded ? "▾" : "▸",
      })
      : h("span", { class: "tree-toggle tree-toggle--empty", "aria-hidden": "true" });
    const projectLink = h("a", {
      class: "side-link tree-project",
      href: `#/project/${node.projectId}`,
    }, icon(ICON_FOLDER), h("span", { class: "side-name", text: node.name }));
    if (activeProjectId === node.projectId) projectLink.setAttribute("aria-current", "page");

    if (hasQuestions) {
      toggle.addEventListener("click", () => {
        const nowExpanded = childBox.hidden;
        childBox.hidden = !nowExpanded;
        toggle.setAttribute("aria-expanded", String(nowExpanded));
        toggle.textContent = nowExpanded ? "▾" : "▸";
        toggle.setAttribute("aria-label", `${nowExpanded ? "折叠" : "展开"}项目 ${node.name}`);
        if (nowExpanded) collapsedProjectIds.delete(node.projectId);
        else collapsedProjectIds.add(node.projectId);
      });
    }

    for (const question of node.questions) {
      const docLink = h("a", {
        class: "side-question tree-doc",
        href: `#/question/${question.questionId}`,
      }, icon(ICON_FILE), h("span", { class: "side-name", text: question.label }));
      if (activeQuestionId === question.questionId) docLink.setAttribute("aria-current", "page");
      childBox.append(docLink);
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
const ICON_LIBRARY = '<svg class="side-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/></svg>';
const ICON_FOLDER = '<svg class="side-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_FILE = '<svg class="side-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
const ICON_SLIDERS = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/></svg>';
const ICON_SEARCH = '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_CRYSTAL = '<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 7 6-7 14L5 8z"/><path d="m5 8 7 3 7-3M12 2v9"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
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

function persistProjectType(projectId, type) {
  const map = changeProjectType(loadProjectTypes(), projectId, type);
  localStorage.setItem(PROJECT_TYPES_KEY, JSON.stringify(map));
}

function saveProjectType(projectId, type) {
  try {
    persistProjectType(projectId, type);
  } catch {
    // 存不下只影响标签展示，不阻断创建流程
  }
}

let projectListSeq = 0;

async function renderProjects() {
  const seq = ++projectListSeq;
  const searchInput = h("input", {
    type: "search",
    id: "projectSearch",
    name: "search",
    placeholder: "搜索项目",
    autocomplete: "off",
    "aria-label": "搜索项目",
  });
  const searchBox = h("div", { class: "search-box workbench-search" },
    icon(ICON_SEARCH),
    searchInput,
  );
  const newProjectBtn = h("button", {
    class: "btn btn-new-project",
    type: "button",
    id: "newProjectBtn",
  });
  newProjectBtn.insertAdjacentHTML("afterbegin", ICON_PLUS);
  newProjectBtn.append("新建项目");

  const importPdfBtn = h("button", { class: "btn btn-primary", type: "button", id: "importPdfBtn" });
  importPdfBtn.insertAdjacentHTML("afterbegin", ICON_UPLOAD);
  importPdfBtn.append("导入 PDF");
  const modelBtn = h("button", { class: "btn btn-quiet", type: "button", id: "modelConfigBtn" });
  modelBtn.insertAdjacentHTML("afterbegin", ICON_SLIDERS);
  modelBtn.append("模型服务");
  const pdfInput = h("input", {
    type: "file",
    id: "pdfFileInput",
    accept: "application/pdf,.pdf",
    hidden: true,
    "aria-hidden": "true",
    tabindex: "-1",
  });

  const actionGroup = h("div", {
    class: "head-actions workbench-actions",
    role: "group",
    "aria-label": "工作台操作",
  }, importPdfBtn, newProjectBtn, modelBtn, pdfInput);
  const tools = h("div", {
    class: "workbench-tools",
    role: "group",
    "aria-label": "项目搜索与工作台操作",
  }, searchBox, actionGroup);
  let activeProjectType = "";
  const categoryButtons = ["全部", ...PROJECT_TYPES].map((type) => {
    const value = type === "全部" ? "" : type;
    const button = h("button", {
      class: "category-chip",
      type: "button",
      text: type,
      dataset: { projectType: value },
      "aria-pressed": String(value === activeProjectType),
      "aria-controls": "projectGridHost",
    });
    button.addEventListener("click", () => {
      activeProjectType = value;
      for (const item of categoryButtons) item.setAttribute("aria-pressed", String(item === button));
      updateGrid();
    });
    return button;
  });
  const categories = h("div", {
    class: "workbench-categories",
    id: "projectCategories",
    role: "group",
    "aria-label": "按研究领域筛选项目",
  },
    h("span", { class: "workbench-categories-label" }, icon(ICON_CRYSTAL), h("span", { text: "研究领域" })),
    h("div", { class: "workbench-category-list" }, ...categoryButtons),
  );
  const controls = h("div", { class: "workbench-controls" }, tools, categories);
  const kpiRow = h("div", { class: "stat-row", id: "kpiRow", "aria-label": "工作台统计" });
  const head = h("header", { class: "workbench-head" },
    h("div", { class: "workbench-title" },
      h("p", { class: "eyebrow", text: "工作台" }),
      h("h1", { text: "研究项目" }),
      h("p", { class: "lede", text: "把论文读成可检验的主张：每条结论，都要有对照证据。" }),
      kpiRow,
    ),
    controls,
  );
  const sectionTitle = h("h2", { class: "section-title", id: "recentTitle", text: "最近更新", hidden: true });
  const listToolbar = h("div", { class: "workbench-list-head", id: "listToolbar" },
    sectionTitle,
    h("p", { class: "list-count", id: "projectCount" }),
  );

  const gridHost = h("div", { id: "projectGridHost" });
  const emptyHost = h("div", { id: "projectEmptyHost" });
  main.append(head, listToolbar, gridHost, emptyHost);

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
      const num = h("span", { class: "stat-num", text: "0" });
      kpiRow.append(h("div", { class: "stat" }, num, h("span", { class: "stat-label", text: item.label })));
      countUp(num, item.value);
    }
  }

  function featherFor(projectId) {
    const variant = cardFeatherVariant(projectId);
    return h("img", {
      class: "card-feather",
      src: "./assets/sidebar-feather.png",
      alt: "",
      draggable: "false",
      "aria-hidden": "true",
      style: `--feather-x:${variant.x}px;--feather-y:${variant.y}px;--feather-scale:${variant.scale};--feather-rotate:${variant.rotate}deg`,
    });
  }

  function cardFor(project, index, animate) {
    const types = loadProjectTypes();
    const tag = types[project.projectId] ?? "未分类";
    const pinned = pinnedIds.has(project.projectId);
    const total = project.questionCount;
    const pending = project.pendingCount;
    const pct = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;
    const featherVariant = cardFeatherVariant(project.projectId);

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
      "aria-label": `编辑项目 ${project.name}`,
      title: "编辑",
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

    return h("article", {
      class: animate ? "project-card project-card--enter" : "project-card",
      dataset: { projectId: project.projectId },
      style: `--card-i:${index};--feather-a:${featherVariant.colors[0]};--feather-b:${featherVariant.colors[1]};--feather-c:${featherVariant.colors[2]};--card-orb-x:${featherVariant.glowX}%;--card-orb-y:${featherVariant.glowY}%`,
    },
      featherFor(project.projectId),
      h("div", { class: "card-top" },
        h("span", { class: `card-tag ${typeColorClass(tag)}`, text: tag }),
      ),
      h("div", { class: "card-body" },
        nameNode,
        h("div", { class: "card-meta" },
          h("span", { text: `研究问题 ${total}` }),
          pending > 0 ? h("span", { class: "card-pending", text: `${pending} 待补跑` }) : null,
          h("span", { text: formatUpdatedAt(project.updatedAt) }),
        ),
      ),
      h("div", { class: "card-footer" },
        h("div", {
          class: "card-progress",
          role: "img",
          "aria-label": `研究问题 ${total} 个，其中待补跑 ${pending} 个`,
          title: `研究问题 ${total} 个，其中待补跑 ${pending} 个`,
        }, h("div", { class: "card-progress-bar", style: `width:${pct}%` })),
        h("div", { class: "card-actions" }, pinBtn, renameBtn, deleteBtn),
      ),
    );
  }

  async function updateGrid() {
    const query = searchInput.value;
    const searched = filterProjects(allProjects, query);
    const list = sortProjects(filterProjectsByType(searched, loadProjectTypes(), activeProjectType), pinnedIds);
    clear(gridHost);
    clear(emptyHost);
    renderKpis();
    searchBox.hidden = allProjects.length === 0;
    categories.hidden = allProjects.length === 0;
    listToolbar.hidden = allProjects.length === 0;
    sectionTitle.hidden = allProjects.length === 0;
    document.getElementById("projectCount").textContent =
      allProjects.length === 0 ? "" : `${list.length} 个项目`;

    if (allProjects.length === 0) {
      const emptyImport = h("button", { class: "btn btn-primary", type: "button", id: "emptyImport", text: "导入 PDF" });
      emptyImport.addEventListener("click", () => pdfInput.click());
      emptyHost.append(
        h("div", { class: "empty empty--start" },
          h("p", { class: "eyebrow", text: "第一步" }),
          h("h2", { text: "从一篇论文开始" }),
          h("p", { class: "empty-lede", text: "导入带文字层的 PDF，工作台会保存逐页正文，并把可检验的结论整理成候选研究问题。" }),
          h("ol", { class: "empty-steps" },
            h("li", {}, h("strong", { text: "导入 PDF" }), h("span", { text: "逐页保存正文，文件不上传" })),
            h("li", {}, h("strong", { text: "核对候选" }), h("span", { text: "对照原文页码，删改后确认" })),
            h("li", {}, h("strong", { text: "验证主张" }), h("span", { text: "用对照实验回答是不是真的" })),
          ),
          h("div", { class: "empty-actions" },
            emptyImport,
            h("button", { class: "btn", type: "button", id: "loadDemo", text: "载入演示项目" }),
          ),
        ),
      );
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
  modelBtn.addEventListener("click", () => {
    location.hash = "#/models";
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
  if (seq !== projectListSeq) return;
  await updateGrid();
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
      const ocrDone = options.ocrOptIn
        ? startPaperOcr(project.projectId, options.paperFile.bytes, pagesNeedingOcr(options.paper), options.paper.sha256)
        : Promise.resolve();
      if (autoGenerate?.input.checked) void ocrDone.then(() => startPaperGeneration(project.projectId, options.paper));
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
  let phase = "解析";
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
    let layoutTitle = "";
    try {
      const pdf = await task.promise;
      const meta = await pdf.getMetadata();
      metaTitle = readPdfMetadataTitle(meta);
      pages = await extractPaperPages(pdf);
      if (!metaTitle && !restore?.meta?.title) {
        layoutTitle = await extractPaperTitleFromPage(pdf);
      }
    } finally {
      await task.destroy();
    }
    const textChars = pages.reduce((sum, text) => sum + Array.from(text).length, 0);
    const title = restore?.meta?.title || extractPaperTitle({ metaTitle, firstPageText: layoutTitle || pages[0] || "" });
    const paper = {
      filename: file.name,
      pages,
      sha256,
      title,
      pageSources: pages.map((text) => text.trim() ? "text" : "pending"),
      pageErrors: pages.map(() => ""),
      pageRegions: pages.map(() => []),
    };
    const bytes = new Uint8Array(buffer);
    phase = "保存到本地知识库";
    await localLibrary.savePaper({ filename: file.name, sha256, bytes });
    openImportResultModal({ file, bytes, paper, textChars, title, sha256, trigger, restore });
  } catch (error) {
    toast(`${phase}失败：${error && error.message ? error.message : String(error)}`, "bad");
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

  const pendingPages = pagesNeedingOcr(paper);
  const ocrOptIn = h("input", { type: "checkbox", id: "importPaperOcr", disabled: pendingPages.length === 0 });
  const ocrChoice = h("label", { class: "paper-opt-in", for: ocrOptIn.id }, ocrOptIn,
    pendingPages.length ? `发送 ${pendingPages.length} 页待识别内容到 OCR 服务（扫描页）` : "所有页面已有文字层，无需 OCR");
  const autoGenerate = restore ? paperGenerationChoice() : null;
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const useBtn = h("button", {
    class: "btn btn-primary", type: "button", id: "importUseTitle", text: restore ? (restore.meta ? "补录到当前项目" : "加入当前项目") : "用 PDF 新建项目",
  });
  useBtn.addEventListener("click", async () => {
    const nextName = titleInput.value.trim() || file.name.replace(/\.pdf$/i, "");
    const nextPaper = { ...paper, title: nextName };
    const paperFile = { filename: file.name, sha256, bytes };
    if (restore) {
      useBtn.disabled = true;
      error.hidden = true;
      try {
        const duplicate = (await data.listPaperStudies(ACTOR, restore.projectId)).some((item) => item.sha256 === sha256);
        await data.importPaper(ACTOR, { name: nextName, paper: nextPaper, now: new Date().toISOString(), projectId: restore.projectId, file: paperFile });
        closeImportResultModal(false);
        if (ocrOptIn.checked) void startPaperOcr(restore.projectId, bytes, pendingPages, sha256);
        if (autoGenerate.input.checked) void startPaperGeneration(restore.projectId, nextPaper);
        toast(duplicate ? "该 PDF 已在项目文献中，已复用原有记录" : "PDF 已加入当前项目", "ok");
        if (restore.returnQuestionId) {
          await renderQuestion(restore.returnQuestionId);
        } else {
          location.hash = projectPaperHash(restore.projectId, nextPaper, 1);
          await render();
        }
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
    ...(autoGenerate ? [autoGenerate.label] : []),
    ocrChoice,
    error,
    h("div", { class: "modal-actions" }, useBtn, closeBtn),
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

const pdfDocumentCache = new Map();

function loadPdfDocument(file) {
  const key = file.sha256 || file.filename;
  let pending = pdfDocumentCache.get(key);
  if (!pending) {
    pending = loadPdfLib().then((pdfjsLib) => pdfjsLib.getDocument({
      data: file.bytes.slice(),
      cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url).href,
    }).promise);
    pdfDocumentCache.set(key, pending);
    pending.catch(() => pdfDocumentCache.delete(key));
  }
  return pending;
}

async function renderPdfPageCanvas({ page, pageNumber, paper, quote, canvas, pageHost, highlights, scale, isCurrent }) {
  if (!isCurrent()) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  const buffer = document.createElement("canvas");
  buffer.width = Math.ceil(viewport.width);
  buffer.height = Math.ceil(viewport.height);
  const render = page.render({ canvasContext: buffer.getContext("2d", { alpha: false }), viewport });
  await render.promise;
  if (!isCurrent()) return null;
  let located = null;
  if (quote) {
    const source = paperPageSource(paper, pageNumber - 1);
    if (source === "ocr" && paper.pageRegions?.[pageNumber - 1]?.length) {
      located = locateInRegions(paper.pageRegions[pageNumber - 1], quote);
    } else {
      const content = await page.getTextContent();
      located = locateInTextItems(content.items, quote, viewport);
    }
    if (!isCurrent()) return null;
  }
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  canvas.getContext("2d", { alpha: false }).drawImage(buffer, 0, 0);
  pageHost.style.width = canvas.style.width;
  pageHost.style.height = canvas.style.height;
  clear(highlights);
  for (const rect of located?.rects ?? []) {
    highlights.append(h("div", {
      class: "pdf-highlight",
      style: `left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%`,
    }));
  }
  return { located };
}

let pdfViewerState = null;
let activePaperReaderCleanup = null;

function cleanupPaperReader() {
  activePaperReaderCleanup?.();
  activePaperReaderCleanup = null;
}

function closePdfViewer(restoreFocus = true) {
  const current = pdfViewerState;
  if (!current) return;
  current.closed = true;
  current.seq += 1;
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
  document.body.append(overlay);
  const state = {
    overlay,
    trigger,
    pdf: null,
    page: Math.min(paper.pages.length, Math.max(1, pageNumber)),
    quote,
    zoom: null,
    seq: 0,
    closed: false,
  };
  pdfViewerState = state;
  close.addEventListener("click", () => closePdfViewer());

  const draw = async () => {
    if (!state.pdf || state.closed) return;
    const seq = ++state.seq;
    const page = await state.pdf.getPage(state.page);
    if (state.closed || seq !== state.seq) return;
    const base = page.getViewport({ scale: 1 });
    if (state.zoom === null) state.zoom = Math.min(2.5, Math.max(0.5, (stage.clientWidth - 48) / base.width));
    precision.textContent = `第 ${state.page} / ${paper.pages.length} 页 · 正在渲染…`;
    const result = await renderPdfPageCanvas({
      page,
      pageNumber: state.page,
      paper,
      quote: state.quote,
      canvas,
      pageHost,
      highlights,
      scale: state.zoom,
      isCurrent: () => !state.closed && seq === state.seq,
    });
    if (!result) return;
    precision.textContent = `第 ${state.page} / ${paper.pages.length} 页${result.located ? ` · ${result.located.reason}` : " · 原版页面"}`;
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
    state.pdf = await loadPdfDocument(file);
    if (!state.closed) await draw();
  } catch (error) {
    if (!state.closed) precision.textContent = `原版页面打开失败：${error.message || String(error)}`;
  }
  return true;
}

// ---------- 卡片操作：编辑名称与项目类别 ----------

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
  const currentType = normalizeProjectType(loadProjectTypes()[project.projectId] ?? "其他");

  const nameInput = h("input", {
    type: "text",
    id: "renameProjectInput",
    value: project.name,
    autocomplete: "off",
  });
  const typeSelect = h("select", { id: "editProjectType", name: "projectType" },
    ...PROJECT_TYPES.map((type) => h("option", { value: type, text: type })),
  );
  typeSelect.value = currentType;
  const error = h("p", { class: "field-error", id: "renameModalError", hidden: true });
  const confirmBtn = h("button", { class: "btn btn-primary", type: "button", text: "保存" });
  const cancelBtn = h("button", { class: "btn", type: "button", text: "取消" });

  modal.append(
    h("h2", { id: "renameModalTitle", text: "编辑项目" }),
    h("div", { class: "field" },
      h("label", { for: "renameProjectInput", text: "项目名" }),
      nameInput,
    ),
    h("div", { class: "field" },
      h("label", { for: "editProjectType", text: "项目类别" }),
      typeSelect,
      h("p", { class: "aux", text: "类别会同步影响新建研究问题的设计提示，仅保存在当前浏览器。" }),
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
    const nextType = normalizeProjectType(typeSelect.value);
    const nameChanged = name !== project.name;
    const typeChanged = nextType !== currentType;
    if (!nameChanged && !typeChanged) {
      closeRenameProjectModal();
      return;
    }
    nameInput.removeAttribute("aria-invalid");
    error.hidden = true;
    confirmBtn.disabled = true;
    try {
      if (nameChanged) await data.renameProject(ACTOR, project.projectId, name, new Date().toISOString());
      persistProjectType(project.projectId, nextType);
      closeRenameProjectModal(false);
      toast(nameChanged && typeChanged ? "已更新项目名称和类别" : typeChanged ? `项目类别已改为「${nextType}」` : `已重命名为「${name}」`, "ok");
      if (onRenamed) await onRenamed();
    } catch (saveError) {
      confirmBtn.disabled = false;
      error.hidden = false;
      error.textContent = `保存失败：${saveError && saveError.message ? saveError.message : String(saveError)}`;
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

// ---------- 模型服务配置（仅本地同源接口） ----------

let modelViewSeq = 0;

async function renderModels() {
  const seq = ++modelViewSeq;
  const status = h("p", { class: "aux", role: "status", text: "读取中…" });
  const serviceList = h("div", { class: "model-services" });
  const addBtn = h("button", {
    class: "btn btn-primary", type: "button", id: "addModelService", text: "＋ 添加服务",
    "aria-expanded": "false", "aria-controls": "addModelServicePanel",
  });
  const back = h("a", { class: "back-link", href: "#/", text: "← 返回项目列表" });
  const addName = h("input", {
    type: "text", id: "addModelName", value: "模型服务", maxlength: 80,
    autocomplete: "off", required: true, "aria-label": "新服务名称",
  });
  const addBaseUrl = h("input", {
    type: "url", id: "addModelBaseUrl", maxlength: 500, required: true,
    placeholder: "本机 HTTP 或云 API HTTPS 地址", autocomplete: "off", "aria-label": "新服务 Base URL",
  });
  const addKey = h("input", {
    type: "password", id: "addModelKey", maxlength: 4000, required: true,
    autocomplete: "new-password", "aria-label": "新服务 API Key",
  });
  const addReveal = h("button", { class: "btn btn-small", type: "button", text: "显示", "aria-pressed": "false" });
  addReveal.addEventListener("click", () => {
    const visible = addKey.type === "text";
    addKey.type = visible ? "password" : "text";
    addReveal.textContent = visible ? "显示" : "隐藏";
    addReveal.setAttribute("aria-pressed", String(!visible));
  });
  const addError = h("p", { class: "field-error", role: "alert", hidden: true });
  const addCancel = h("button", { class: "btn", type: "button", text: "取消" });
  const addSave = h("button", { class: "btn btn-primary", type: "submit", text: "保存服务" });
  const addForm = h("form", { class: "model-add-form", id: "addModelServiceForm" },
    h("div", { class: "model-form-grid" },
      h("div", { class: "field" }, h("label", { for: addName.id, text: "服务名称" }), addName),
      h("div", { class: "field" }, h("label", { for: addBaseUrl.id, text: "Base URL" }), addBaseUrl),
    ),
    h("div", { class: "field" },
      h("label", { for: addKey.id, text: "API Key" }),
      h("div", { class: "model-key-row" }, addKey, addReveal),
      h("span", { class: "model-key-state", text: "只发送到本机服务端并加密保存，不写入浏览器存储。" }),
    ),
    addError,
    h("div", { class: "model-add-actions" }, addSave, addCancel),
  );
  const addPanel = h("section", {
    class: "model-add-panel", id: "addModelServicePanel", "aria-labelledby": "addModelServiceTitle", hidden: true,
  },
    h("h2", { id: "addModelServiceTitle", text: "添加模型服务" }),
    h("p", { class: "aux", text: "填写兼容 OpenAI 风格的服务地址；本机可使用 HTTP，云 API 必须使用 HTTPS。" }),
    addForm,
  );
  const closeAdd = () => {
    addPanel.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
    addError.hidden = true;
    addError.textContent = "";
  };
  addBtn.addEventListener("click", () => {
    if (addPanel.hidden) {
      addPanel.hidden = false;
      addBtn.setAttribute("aria-expanded", "true");
      addName.focus();
    } else {
      closeAdd();
      addBtn.focus();
    }
  });
  addCancel.addEventListener("click", () => {
    closeAdd();
    addBtn.focus();
  });
  addPanel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeAdd();
    addBtn.focus();
  });
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    addError.hidden = true;
    addSave.disabled = true;
    addSave.textContent = "保存中…";
    try {
      const next = await modelConfigRequest("POST", "", {
        name: addName.value,
        baseUrl: addBaseUrl.value,
        apiKey: addKey.value,
      });
      const added = next.services.at(-1);
      await applySnapshot(next);
      addName.value = "模型服务";
      addBaseUrl.value = "";
      addKey.value = "";
      addKey.type = "password";
      addReveal.textContent = "显示";
      addReveal.setAttribute("aria-pressed", "false");
      closeAdd();
      if (added) {
        stateByService.set(added.id, { expanded: true, loading: false, searched: false, error: "" });
        draw();
      }
      toast(`已添加「${added?.name ?? "模型服务"}」`, "ok");
      addBtn.focus();
    } catch (error) {
      addError.hidden = false;
      addError.textContent = error.message;
    } finally {
      addSave.disabled = false;
      addSave.textContent = "保存服务";
    }
  });

  main.append(back,
    h("header", { class: "page-head" },
      h("div", { class: "field", style: "gap:6px" },
        h("h1", { text: "模型服务" }),
        h("p", { class: "aux", text: "添加兼容 OpenAI 风格的本机或云端模型服务，已选模型将用于问题分析与论文候选生成。" }),
      ),
      addBtn,
    ),
    h("div", { class: "notice", role: "note" },
      h("strong", { text: "支持本机与云 API" }),
      h("p", { text: "支持本机 HTTP 和公网 HTTPS 云 API，私网与保留地址仍被阻止。API Key 加密保存在「本机保存」所选文件夹的 secrets/ 中；未选择时使用站点默认本机目录。密钥不会回传到浏览器，研究数据仍保存在当前浏览器。云同步尚未启用。" }),
    ),
    status,
    addPanel,
    serviceList,
  );

  let snapshot = { services: [], activeServiceId: null };
  const modelsByService = new Map();
  const stateByService = new Map();

  async function applySnapshot(next) {
    snapshot = next;
    await setAgent(Boolean(snapshot.activeServiceId));
    status.classList.remove("field-error");
    status.textContent = snapshot.services.length
      ? `已配置 ${snapshot.services.length} 个服务；当前使用 ${snapshot.services.find((item) => item.id === snapshot.activeServiceId)?.name ?? "未选择"}。`
      : "还没有模型服务，请先添加一个模型服务。";
    draw();
    return snapshot;
  }

  async function reload() {
    status.textContent = "读取中…";
    try {
      return await applySnapshot(await modelConfigRequest("GET"));
    } catch (error) {
      await setAgent(false);
      status.textContent = error.message;
      status.classList.add("field-error");
      return null;
    }
  }

  function card(service) {
    const state = stateByService.get(service.id) ?? { expanded: false, loading: false, searched: false, error: "" };
    stateByService.set(service.id, state);
    const active = snapshot.activeServiceId === service.id;
    const models = modelsByService.get(service.id) ?? [];
    const cardNode = h("article", { class: "model-card", dataset: { serviceId: service.id } });
    const toggle = h("button", {
      class: "model-card-toggle", type: "button", "aria-expanded": String(state.expanded), "aria-controls": `model-details-${service.id}`,
    }, h("span", { class: "model-card-title", text: service.name }),
      h("span", { class: `model-card-meta${active ? " is-active" : ""}`, text: active ? "使用中" : "未选择" }),
      h("span", { class: "model-card-meta", text: `${models.length} 个模型` }),
      h("span", { class: "model-card-chevron", "aria-hidden": "true", text: state.expanded ? "▾" : "▸" }));
    toggle.addEventListener("click", () => {
      state.expanded = !state.expanded;
      toggle.setAttribute("aria-expanded", String(state.expanded));
      toggle.querySelector(".model-card-chevron").textContent = state.expanded ? "▾" : "▸";
      details.hidden = !state.expanded;
    });

    const name = h("input", { type: "text", id: `model-name-${service.id}`, value: service.name, maxlength: 80, autocomplete: "off", "aria-label": "服务名称" });
    const baseUrl = h("input", { type: "url", id: `model-url-${service.id}`, value: service.baseUrl, maxlength: 500, autocomplete: "off", "aria-label": "Base URL" });
    const keyInput = h("input", { type: "password", id: `model-key-${service.id}`, placeholder: service.hasApiKey ? service.apiKeyHint : "请输入 API Key", autocomplete: "new-password", maxlength: 4000, "aria-label": "API Key" });
    const reveal = h("button", { class: "btn btn-small", type: "button", text: "显示", "aria-pressed": "false" });
    reveal.addEventListener("click", () => {
      const visible = keyInput.type === "text";
      keyInput.type = visible ? "password" : "text";
      reveal.textContent = visible ? "显示" : "隐藏";
      reveal.setAttribute("aria-pressed", String(!visible));
    });
    const configured = h("span", { class: "model-key-state", text: service.hasApiKey ? `已配置 ${service.apiKeyHint}` : "未配置" });
    const save = h("button", { class: "btn btn-primary", type: "button", text: "保存" });
    const search = h("button", { class: "btn", type: "button", disabled: state.loading, text: state.loading ? "搜索中…" : "搜索模型" });
    const remove = h("button", { class: "btn btn-danger", type: "button", text: "删除" });
    const error = h("p", { class: "field-error", role: "alert", hidden: true });
    const searchStatus = h("p", { class: "aux", role: "status" });
    const deleteConfirm = h("div", { class: "model-delete-confirm", role: "group", "aria-label": "确认删除模型服务", hidden: true },
      h("p", { text: `删除「${service.name}」？本机服务端保存的 API Key 也会一并移除。` }),
      h("div", { class: "model-delete-actions" },
        h("button", { class: "btn btn-danger", type: "button", id: `confirm-delete-${service.id}`, text: "确认删除" }),
        h("button", { class: "btn", type: "button", id: `cancel-delete-${service.id}`, text: "取消" }),
      ),
    );

    function updateSearchStatus() {
      searchStatus.classList.toggle("field-error", Boolean(state.error));
      searchStatus.textContent = state.loading
        ? "正在请求模型列表…"
        : state.error || (state.searched ? `已找到 ${models.length} 个模型` : "保存后可搜索模型。");
    }
    function showError(message) {
      state.error = message;
      error.hidden = false;
      error.textContent = message;
      updateSearchStatus();
    }
    function clearError() {
      state.error = "";
      error.hidden = true;
      error.textContent = "";
      updateSearchStatus();
    }
    updateSearchStatus();

    const modelSelect = h("select", { id: `model-select-${service.id}`, "aria-label": "选择模型" },
      h("option", { value: "", text: service.model ? `当前：${service.model}` : "请选择模型" }),
      ...models.filter((id) => id !== service.model).map((id) => h("option", { value: id, text: id })),
    );
    modelSelect.value = service.model;
    modelSelect.addEventListener("change", async () => {
      if (await persistService()) toast("已切换当前模型", "ok");
    });

    const details = h("div", { class: "model-details", id: `model-details-${service.id}`, hidden: !state.expanded },
      h("div", { class: "model-form-grid" },
        h("div", { class: "field" }, h("label", { for: name.id, text: "服务名称" }), name),
        h("div", { class: "field" }, h("label", { for: baseUrl.id, text: "Base URL" }), baseUrl),
      ),
      h("div", { class: "field" },
        h("label", { for: keyInput.id, text: "API Key" }),
        h("div", { class: "model-key-row" }, keyInput, reveal),
        configured,
      ),
      h("div", { class: "model-actions" }, save, search, remove),
      error,
      h("div", { class: "field" }, h("label", { for: modelSelect.id, text: "模型选择" }), modelSelect),
      searchStatus,
      h("div", { class: "model-options", role: "listbox", "aria-label": "可用模型" },
        models.length
          ? models.map((id) => h("button", {
              class: `model-option${id === service.model ? " is-selected" : ""}`, type: "button", role: "option",
              "aria-selected": String(id === service.model), text: id,
              onclick: () => { modelSelect.value = id; modelSelect.dispatchEvent(new Event("change")); },
            }))
          : h("p", { class: "aux", text: state.searched ? "模型列表为空。" : "尚未搜索模型。" }),
      ),
      deleteConfirm,
    );

    async function persistService() {
      clearError();
      save.disabled = true;
      search.disabled = true;
      try {
        const next = await modelConfigRequest("POST", "", {
          serviceId: service.id,
          name: name.value,
          baseUrl: baseUrl.value,
          apiKey: keyInput.value,
          model: modelSelect.value,
        });
        keyInput.value = "";
        await applySnapshot(next);
        toast(`已保存「${next.services.find((item) => item.id === service.id)?.name ?? name.value.trim()}」`, "ok");
        return next.services.find((item) => item.id === service.id) ?? null;
      } catch (saveError) {
        showError(saveError.message);
        return null;
      } finally {
        save.disabled = false;
        search.disabled = state.loading;
      }
    }

    save.addEventListener("click", () => { void persistService(); });

    search.addEventListener("click", async () => {
      const changed = name.value.trim() !== service.name || baseUrl.value.trim() !== service.baseUrl || Boolean(keyInput.value);
      state.loading = true;
      clearError();
      search.disabled = true;
      search.textContent = "搜索中…";
      try {
        if (changed && !await persistService()) return;
        const result = await modelConfigRequest("POST", "/models", { serviceId: service.id });
        modelsByService.set(service.id, result.models);
        state.searched = true;
      } catch (searchError) {
        showError(searchError.message);
      } finally {
        state.loading = false;
        search.disabled = false;
        search.textContent = "搜索模型";
        updateSearchStatus();
        draw();
      }
    });

    remove.addEventListener("click", () => {
      state.expanded = true;
      details.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.querySelector(".model-card-chevron").textContent = "▾";
      deleteConfirm.hidden = false;
      deleteConfirm.querySelector(".btn-danger").focus();
    });
    deleteConfirm.querySelector(".btn:not(.btn-danger)").addEventListener("click", () => {
      deleteConfirm.hidden = true;
      remove.focus();
    });
    deleteConfirm.querySelector(".btn-danger").addEventListener("click", async () => {
      const confirm = deleteConfirm.querySelector(".btn-danger");
      const cancel = deleteConfirm.querySelector(".btn:not(.btn-danger)");
      confirm.disabled = true;
      cancel.disabled = true;
      remove.disabled = true;
      try {
        const next = await modelConfigRequest("DELETE", `/${encodeURIComponent(service.id)}`);
        stateByService.delete(service.id);
        modelsByService.delete(service.id);
        await applySnapshot(next);
        toast(`已删除「${service.name}」`, "ok");
      } catch (removeError) {
        showError(removeError.message);
        confirm.disabled = false;
        cancel.disabled = false;
        remove.disabled = false;
      }
    });

    cardNode.append(toggle, details);
    return cardNode;
  }

  function draw() {
    if (seq !== modelViewSeq) return;
    clear(serviceList);
    if (!snapshot.services.length) {
      serviceList.append(h("div", { class: "empty" }, h("p", { text: "暂无模型服务" })));
      return;
    }
    snapshot.services.forEach((service) => serviceList.append(card(service)));
  }

  await reload();
}

// ---------- 视图 2：项目详情 ----------

function paperGenerationChoice() {
  const input = h("input", { type: "checkbox", checked: true });  return { input, label: h("label", { class: "paper-opt-in" }, input, "自动生成研究问题（逐批将论文文字发送给模型服务）") };
}

const paperJobs = new Map();

async function requestPaperModel(input) {
  const send = async (token) => fetch(PAPER_MODEL_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agentflow-local-token": token },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(70_000),
  });
  let response = await send(await localToken());
  if (response.status === 401) {
    localTokenPromise = null;
    response = await send(await localToken());
  }
  if (response.status === 404 || response.status === 405 || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("站点的论文模型接口未接通，全文已保存在本机");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `论文模型请求失败（HTTP ${response.status}）`);
  if (typeof result.text !== "string" || typeof result.model !== "string") throw new Error("论文模型返回格式无效");
  return result;
}

async function startPaperGeneration(projectId, paper) {
  const jobKey = `${projectId}:${paper.sha256}`;
  if (paperJobs.get(jobKey)?.running) return;
  const job = { running: true, text: "正在准备论文文字…" };
  paperJobs.set(jobKey, job);
  const onProject = () => parseRoute().view === "project" && parseRoute().projectId === projectId
    && (!parseRoute().paper || parseRoute().paper === paper.sha256);
  try {
    const generate = async () => {
      const study = await data.getPaperStudy(ACTOR, projectId, paper?.sha256);
      if (study?.generation?.candidates.length) return;
      if (!study) throw new Error("项目文献不存在");
      const generated = await generatePaperCandidates(study, requestPaperModel, (batch) => {
        job.text = `模型正在阅读第 ${batch} 批论文文字…`;
        const status = document.getElementById("paperGenerationStatus");
        if (onProject() && status) status.textContent = job.text;
      });
      await data.savePaperCandidates(ACTOR, projectId, generated, study.sha256);
    };
    if (navigator.locks) await navigator.locks.request(`paper-model-${jobKey}`, generate);
    else await generate();
    paperJobs.delete(jobKey);
  } catch (error) {
    paperJobs.set(jobKey, { running: false, text: error.message });
  }
  if (onProject()) await render();
}

function projectPaperHash(projectId, paper, page = 1, cite = null) {
  return `#/project/${projectId}/paper/${paper.sha256}/${page}${cite ? `/${encodeURIComponent(cite)}` : ""}`;
}

function paperEvidenceRef(questionId, evidenceId) {
  return `e:${questionId}:${evidenceId}`;
}

/** 引文引用号：c<候选序号>-<引文序号>；只用于站内定位，不进存储契约。 */
function citationRef(candidateIndex, citationIndex) {
  return `c${candidateIndex + 1}-${citationIndex + 1}`;
}

function citationForRef(paper, ref) {
  const match = /^c(\d+)-(\d+)$/.exec(ref ?? "");
  if (!match) return null;
  return paper.generation?.candidates[Number(match[1]) - 1]?.citations[Number(match[2]) - 1] ?? null;
}

/** 在段落文本中标出引文；定位失败时原样输出，不伪造高亮。 */
function fillWithQuote(node, text, quote) {
  const span = quote ? locate(text, quote) : null;
  if (!span) {
    node.textContent = text;
    return false;
  }
  const length = Array.from(text).length;
  const before = codePointSlice(text, 0, span[0]);
  const hit = codePointSlice(text, span[0], span[1]);
  const after = codePointSlice(text, span[1], length);
  if (before) node.append(before);
  node.append(h("mark", { class: "sheet-mark" }, hit));
  if (after) node.append(after);
  return true;
}

function factRow(label, value) {
  return h("div", { class: "candidate-fact" },
    h("dt", { text: label }),
    h("dd", { text: value }),
  );
}

function renderPaperEvidence(paper, candidate, candidateIndex) {
  const resolvedIndex = candidateIndex ?? paper.generation?.candidates.findIndex((item) => item.id === candidate.id) ?? 0;
  return [
    h("dl", { class: "candidate-facts" },
      factRow("待检验主张", candidate.claim),
      factRow("研究价值", candidate.rationale),
      factRow("验证方法", candidate.verification),
    ),
    h("ul", { class: "cite-list" },
      ...candidate.citations.map((citation, citationIndex) => {
        const href = projectPaperHash(paper.projectId, paper, citation.page, citationRef(resolvedIndex, citationIndex));
        const link = h("a", {
          class: "cite-chip",
          href,
          title: `定位到第 ${citation.page} 页的引文`,
        }, `第 ${citation.page} 页`);
        link.addEventListener("click", async (event) => {
          event.preventDefault();
          const file = await data.getPaperFile(ACTOR, paper.projectId, paper.sha256);
          if (!file) {
            toast("请先补传原 PDF，才能查看原版页面", "bad");
            location.hash = href;
            return;
          }
          await openPdfViewer(paper, file, citation.page, citation.quote, link);
        });
        return h("li", {}, link, h("blockquote", { class: "cite-quote", text: citation.quote }));
      }),
    ),
  ];
}

/** 项目名与论文题名高度重合时只显示一次，避免同一行标题上下重复。 */
function samePaperTitle(left, right) {
  const norm = (value) => (value || "").replace(/[\s·—–\-_/（）()：:，,。.]/g, "").toLowerCase();
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  return a === b || (a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a)));
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
        h("div", { class: "ocr-panel-copy" },
          h("h3", { id: "ocrPanelTitle", text: "原版与扫描识别" }),
          h("p", { class: "rail-note", text: "旧记录未保存 PDF 字节。补传同一原文件后可查看原版页面和精确高亮，已有问题与引文不会丢失。" }),
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
        error ? h("span", { class: "ocr-page-error", text: error }) : h("span", { class: "ocr-page-detail", text: source === "text" ? "无需 OCR" : source === "ocr" ? "已保存识别文字与区域" : "尚未取得可用文字" }),
        retry,
      );
    }),
  );
  const status = h("p", {
    class: job?.error ? "field-error" : "rail-note",
    role: "status",
    text: job?.running ? `${job.text}（第 ${job.current} / ${job.total} 页）` : job?.error || job?.text || "仅发送没有可用文字层的页面；单页失败不会影响其他页。",
  });
  return h("section", { class: "ocr-panel", "aria-labelledby": "ocrPanelTitle" },
    h("div", { class: "ocr-panel-head" },
      h("div", {},
        h("h3", { id: "ocrPanelTitle", text: "原版与扫描识别" }),
        h("p", { class: "paper-meta", text: `文字层 ${counts.text} · OCR ${counts.ocr} · 待识别 ${counts.pending} · 失败 ${counts.failed}` }),
      ),
      runAll,
    ),
    status,
    h("details", { class: "ocr-details", open: needing.length > 0 },
      h("summary", { text: "逐页状态与单页重试" }),
      rows,
    ),
    reupload,
    reuploadInput,
  );
}

function renderPaperStudy(paper, initialPage, citeRef = null, projectName = "", initialQuote = null, options = {}) {
  const total = paper.pages.length;
  const readable = paper.pages.filter((text) => text.trim()).length;
  const startPage = initialPage >= 1 && initialPage <= total ? initialPage : 1;
  const cited = citationForRef(paper, citeRef);
  const quote = initialQuote || (cited && cited.page === startPage ? cited.quote : null);
  const showHead = options.showHead !== false;
  const file = options.file || null;
  const job = paperJobs.get(`${paper.projectId}:${paper.sha256}`);
  const generation = paper.generation;
  const statusLabels = { text: "文字层", ocr: "OCR", pending: "待识别", failed: "识别失败" };
  let readerMode = file ? "original" : "text";
  let readerZoom = 1;
  let currentQuote = quote;
  let viewerSeq = 0;
  let resizeObserver = null;
  let resizeHandler = null;
  let resizeFrame = 0;
  let pendingWidth = null;
  let observedWidth = 0;
  let renderedPageWidth = 0;
  let renderedPageHeight = 0;

  const pageNow = h("strong", { id: "pageNow", text: String(startPage) });
  const pageSize = h("span", { class: "reader-size", id: "pageSize" });
  const prevBtn = h("button", { class: "page-step", type: "button", id: "pagePrev", "aria-label": "上一页", title: "上一页" }, icon(ICON_PREV));
  const nextBtn = h("button", { class: "page-step", type: "button", id: "pageNext", "aria-label": "下一页", title: "下一页" }, icon(ICON_NEXT));
  const pagePicker = h("select", { "aria-label": "PDF 页码", id: "paperPage" },
    paper.pages.map((text, index) => h("option", {
      value: index + 1,
      text: `第 ${index + 1} 页 · ${statusLabels[paperPageSource(paper, index)]}${text.trim() ? "" : " · 无可读文字"}`,
    })),
  );
  const originalModeBtn = h("button", {
    class: "reader-mode",
    type: "button",
    text: "原版",
    disabled: !file,
    title: file ? "保留双栏、图表、公式和原始分页" : "请先补传原 PDF",
    "aria-pressed": "true",
    "aria-controls": "paperSheet",
  });
  const textModeBtn = h("button", {
    class: "reader-mode",
    type: "button",
    text: "文字重排",
    title: "用于复制和检索的无版面文字",
    "aria-pressed": String(!file),
    "aria-controls": "paperSheet",
  });
  const zoomOutBtn = h("button", { class: "page-step", type: "button", "aria-label": "缩小原版页面", title: "缩小" }, h("span", { "aria-hidden": "true", text: "−" }));
  const zoomInBtn = h("button", { class: "page-step", type: "button", "aria-label": "放大原版页面", title: "放大" }, h("span", { "aria-hidden": "true", text: "+" }));
  const zoomLabel = h("span", { class: "reader-zoom-label", id: "readerZoomLabel", text: "100%", "aria-live": "polite" });
  const fitBtn = h("button", { class: "btn btn-small", type: "button", text: "适应宽度" });
  const modeGroup = h("div", { class: "reader-modes", role: "group", "aria-label": "阅读模式" }, originalModeBtn, textModeBtn);
  const zoomGroup = h("div", { class: "reader-zoom", role: "group", "aria-label": "原版缩放" }, zoomOutBtn, zoomLabel, zoomInBtn, fitBtn);
  const sheet = h("article", { class: "paper-sheet", id: "paperSheet", tabindex: "0", "aria-label": "当前页正文" });
  const citeNotice = h("span", { class: "cite-notice", id: "citeNotice", hidden: true, text: "已定位引文" });
  const originalBtn = file ? h("button", { class: "btn btn-small", type: "button", text: "查看原版", title: "在专注弹层中查看" }) : null;
  originalBtn?.addEventListener("click", () => openPdfViewer(paper, file, currentPage, currentQuote, originalBtn));
  const ocrPanel = renderPaperOcrPanel(paper, file);

  const heading = paper.title && !samePaperTitle(paper.title, projectName)
    ? h("h2", { class: "paper-title", id: "paperStudyTitle", text: paper.title })
    : h("h2", { class: "sr-only", id: "paperStudyTitle", text: "项目文献" });

  const reader = h("section", showHead ? { class: "reader", "aria-labelledby": "paperStudyTitle" } : { class: "reader", "aria-label": "论文正文" },
    showHead
      ? h("header", { class: "reader-head" },
        h("p", { class: "eyebrow", text: "项目文献" }),
        heading,
        h("p", { class: "paper-meta", text: `${paper.filename} · ${readable}/${total} 页有可提取文字` }),
      )
      : null,
    ocrPanel,
    h("div", { class: "reader-bar" },
      modeGroup,
      h("div", { class: "page-nav" },
        prevBtn,
        h("span", { class: "page-indicator" }, pageNow, h("span", { class: "page-total", text: ` / ${total}` })),
        nextBtn,
      ),
      h("label", { class: "page-jump", for: "paperPage", text: "跳至" }),
      pagePicker,
      zoomGroup,
      pageSize,
      originalBtn,
      citeNotice,
    ),
    sheet,
  );

  let currentPage = startPage;

  const updateReaderControls = () => {
    const original = readerMode === "original" && Boolean(file);
    originalModeBtn.classList.toggle("is-active", original);
    textModeBtn.classList.toggle("is-active", !original);
    originalModeBtn.setAttribute("aria-pressed", String(original));
    textModeBtn.setAttribute("aria-pressed", String(!original));
    zoomOutBtn.disabled = !original || readerZoom <= 0.5;
    zoomInBtn.disabled = !original || readerZoom >= 3;
    fitBtn.disabled = !original;
    zoomLabel.textContent = `${Math.round(readerZoom * 100)}%`;
  };

  const renderPage = (pageNumber, quote) => {
    viewerSeq += 1;
    clear(sheet);
    sheet.classList.add("is-text");
    sheet.classList.remove("is-original");
    sheet.dataset.readerMode = "text";
    sheet.setAttribute("aria-label", "当前页文字重排");
    const text = paper.pages[pageNumber - 1] ?? "";
    if (!text.trim()) {
      const source = paperPageSource(paper, pageNumber - 1);
      const error = paper.pageErrors?.[pageNumber - 1] || "";
      const message = source === "failed"
        ? `这一页 OCR 失败：${error || "未取得可用文字"}。可在上方单页重试。`
        : source === "pending"
          ? "这一页没有可用的文字层，尚未 OCR。可在上方识别本页或全部待识别页。"
          : source === "ocr"
            ? "这一页 OCR 已完成，但没有识别到文字；可在上方单页重试。"
            : "这一页没有可提取的文字层，可能是扫描页或纯图页。";
      sheet.append(h("p", { class: "sheet-empty", text: message }));
      return null;
    }
    let marked = null;
    for (const block of paragraphizePage(text, { firstPage: pageNumber === 1 })) {
      const node = block.kind === "title"
        ? h("h2", { class: "sheet-title" })
        : block.kind === "heading"
          ? h("h3", { class: "sheet-h" })
          : h("p", { class: block.kind === "meta" ? "sheet-meta" : "sheet-p" });
      if (fillWithQuote(node, block.text, quote) && node.querySelector("mark")) marked = node;
      sheet.append(node);
    }
    return marked;
  };

  const redrawForWidth = (width) => {
    if (readerMode !== "original" || !file) return;
    if (Math.abs(width - (pendingWidth ?? observedWidth)) < 1) return;
    pendingWidth = width;
    if (document.body.classList.contains("sidebar-resizing")) {
      const canvas = sheet.querySelector(".reader-pdf-canvas");
      const pageHost = sheet.querySelector(".reader-pdf-page");
      if (!canvas || !pageHost || !renderedPageWidth || !renderedPageHeight || !observedWidth) return;
      const previewWidth = renderedPageWidth * (width / observedWidth);
      const previewHeight = renderedPageHeight * (width / observedWidth);
      canvas.style.width = `${previewWidth}px`;
      canvas.style.height = `${previewHeight}px`;
      pageHost.style.width = `${previewWidth}px`;
      pageHost.style.height = `${previewHeight}px`;
      return;
    }
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const nextWidth = pendingWidth;
      if (nextWidth === null || readerMode !== "original" || document.body.classList.contains("sidebar-resizing")) return;
      pendingWidth = null;
      if (Math.abs(nextWidth - observedWidth) < 1) return;
      void drawOriginal(currentPage, currentQuote);
    });
  };

  const flushSidebarResize = () => {
    pendingWidth = null;
    redrawForWidth(sheet.clientWidth);
  };

  const drawOriginal = async (pageNumber, quote) => {
    const seq = ++viewerSeq;
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
    pendingWidth = null;
    let view = sheet.dataset.readerMode === "original" ? {
      status: sheet.querySelector(".original-reader-status"),
      stage: sheet.querySelector(".pdf-stage--embedded"),
      pageHost: sheet.querySelector(".reader-pdf-page"),
      canvas: sheet.querySelector(".reader-pdf-canvas"),
      highlights: sheet.querySelector(".reader-pdf-highlights"),
      quoteBox: sheet.querySelector(".pdf-quote--embedded"),
    } : null;
    if (!view || !Object.values(view).every(Boolean)) {
      clear(sheet);
      sheet.classList.add("is-original");
      sheet.classList.remove("is-text");
      sheet.dataset.readerMode = "original";
      sheet.setAttribute("aria-label", "当前页原版 PDF");
      const status = h("p", { class: "original-reader-status", role: "status", text: "正在打开原版页面…" });
      const stage = h("div", { class: "pdf-stage pdf-stage--embedded", "aria-label": "原版 PDF 页面" });
      const pageHost = h("div", { class: "pdf-page reader-pdf-page" });
      const canvas = h("canvas", { class: "reader-pdf-canvas", "aria-label": `原文第 ${pageNumber} 页` });
      const highlights = h("div", { class: "pdf-highlights reader-pdf-highlights", "aria-hidden": "true" });
      const quoteBox = h("blockquote", { class: "pdf-quote pdf-quote--embedded", hidden: !quote, text: quote ?? "" });
      pageHost.append(canvas, highlights);
      stage.append(pageHost);
      sheet.append(status, stage, quoteBox);
      view = { status, stage, pageHost, canvas, highlights, quoteBox };
    }
    const { status, stage, pageHost, canvas, highlights, quoteBox } = view;
    sheet.querySelector(".original-reader-error")?.remove();
    canvas.setAttribute("aria-label", `原文第 ${pageNumber} 页`);
    quoteBox.hidden = !quote;
    quoteBox.textContent = quote ?? "";
    status.textContent = `第 ${pageNumber} / ${total} 页 · 正在打开…`;
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (seq !== viewerSeq || !sheet.isConnected) return;
      const pdf = await loadPdfDocument(file);
      if (seq !== viewerSeq || !sheet.isConnected) return;
      const page = await pdf.getPage(pageNumber);
      if (seq !== viewerSeq || !sheet.isConnected) return;
      const base = page.getViewport({ scale: 1 });
      const stageStyle = getComputedStyle(stage);
      const horizontalPadding = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
      const availableWidth = Math.max(1, stage.clientWidth - horizontalPadding);
      const scale = (availableWidth / base.width) * readerZoom;
      observedWidth = sheet.clientWidth;
      status.textContent = `第 ${pageNumber} / ${total} 页 · 正在渲染…`;
      const result = await renderPdfPageCanvas({
        page,
        pageNumber,
        paper,
        quote,
        canvas,
        pageHost,
        highlights,
        scale,
        isCurrent: () => seq === viewerSeq && sheet.isConnected,
      });
      if (!result) return;
      renderedPageWidth = parseFloat(canvas.style.width);
      renderedPageHeight = parseFloat(canvas.style.height);
      status.textContent = `第 ${pageNumber} / ${total} 页${result.located ? ` · ${result.located.reason}` : " · 原版页面"}`;
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver((entries) => redrawForWidth(entries[0].contentRect.width));
        resizeObserver.observe(sheet);
        resizeHandler = () => redrawForWidth(sheet.clientWidth);
        window.addEventListener("resize", resizeHandler);
        window.addEventListener("agentflow:sidebar-resize-end", flushSidebarResize);
      }
      redrawForWidth(sheet.clientWidth);
    } catch (error) {
      if (seq !== viewerSeq) return;
      status.textContent = `原版页面打开失败：${error.message || String(error)}`;
      const retry = h("button", { class: "btn", type: "button", text: "重试原版" });
      retry.addEventListener("click", () => commitPage(currentPage, { quote: currentQuote }));
      const fallback = h("button", { class: "btn", type: "button", text: "改用文字重排" });
      fallback.addEventListener("click", () => setReaderMode("text"));
      sheet.querySelector(".original-reader-error")?.remove();
      quoteBox.after(h("div", { class: "original-reader-error" }, retry, fallback));
    }
  };

  const setReaderMode = (mode) => {
    if (mode === "original" && !file) return;
    readerMode = mode;
    updateReaderControls();
    commitPage(currentPage, { quote: currentQuote });
  };

  const commitPage = (next, { quote = null } = {}) => {
    currentPage = Math.min(total, Math.max(1, Number(next) || 1));
    currentQuote = quote;
    pagePicker.value = String(currentPage);
    pageNow.textContent = String(currentPage);
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= total;
    const text = paper.pages[currentPage - 1] ?? "";
    pageSize.textContent = text.trim() ? `约 ${countPaperChars(text).toLocaleString("zh-CN")} 字` : "无可读文字";
    citeNotice.hidden = !currentQuote;
    if (readerMode === "original" && file) {
      void drawOriginal(currentPage, currentQuote);
    } else {
      const marked = renderPage(currentPage, currentQuote);
      if (marked) {
        requestAnimationFrame(() => {
          if (!sheet.isConnected || readerMode !== "text") return;
          marked.scrollIntoView({ block: "center" });
          marked.classList.add("is-cited");
        });
      }
    }
    history.replaceState(null, "", projectPaperHash(paper.projectId, paper, currentPage, currentQuote ? citeRef : null));
  };

  originalModeBtn.addEventListener("click", () => setReaderMode("original"));
  textModeBtn.addEventListener("click", () => setReaderMode("text"));
  zoomOutBtn.addEventListener("click", () => {
    readerZoom = Math.max(0.5, readerZoom - 0.25);
    updateReaderControls();
    commitPage(currentPage, { quote: currentQuote });
  });
  zoomInBtn.addEventListener("click", () => {
    readerZoom = Math.min(3, readerZoom + 0.25);
    updateReaderControls();
    commitPage(currentPage, { quote: currentQuote });
  });
  fitBtn.addEventListener("click", () => {
    readerZoom = 1;
    updateReaderControls();
    commitPage(currentPage, { quote: currentQuote });
  });
  prevBtn.addEventListener("click", () => commitPage(currentPage - 1));
  nextBtn.addEventListener("click", () => commitPage(currentPage + 1));
  pagePicker.addEventListener("change", () => commitPage(Number(pagePicker.value)));
  sheet.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    commitPage(currentPage + (event.key === "ArrowRight" ? 1 : -1));
  });
  activePaperReaderCleanup = () => {
    viewerSeq += 1;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    pendingWidth = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
    window.removeEventListener("agentflow:sidebar-resize-end", flushSidebarResize);
  };
  updateReaderControls();
  commitPage(startPage, { quote });

  const rail = h("aside", { class: "evidence-rail", "aria-labelledby": "paperCandidatesTitle" },
    h("div", { class: "rail-head" },
      h("div", {},
        h("p", { class: "eyebrow", text: "模型提炼" }),
        h("h2", { id: "paperCandidatesTitle", text: "候选研究问题" }),
      ),
      generation?.candidates.length ? h("span", { class: "rail-count", text: String(generation.candidates.length) }) : null,
    ),
  );

  if (!generation?.candidates.length) {
    const message = job?.text ?? (generation ? "模型没有找到有可核对证据的问题，可重新生成。" : "把论文文字分批交给模型，生成带页码出处的候选研究问题。");
    const status = h("p", { id: "paperGenerationStatus", role: "status", class: job && !job.running ? "field-error" : "rail-note", text: message });
    const generate = h("button", {
      class: "btn btn-primary",
      type: "button",
      disabled: job?.running,
      text: job?.running ? "生成中…" : generation ? "重新生成" : "生成研究问题",
    });
    generate.addEventListener("click", () => {
      generate.disabled = true;
      status.textContent = "正在准备论文文字…";
      void startPaperGeneration(paper.projectId, paper);
    });
    rail.append(h("div", { class: "rail-empty" },
      h("p", { class: "rail-lede", text: "模型按页阅读全文，提出可检验、可核对的假设；核对页码与原文后再决定是否创建。" }),
      status,
      generate,
    ));
  } else {
    rail.append(h("p", { class: "rail-note", text: `模型 ${generation.model} · 核对页码与原文后确认` }));
    generation.candidates.forEach((candidate, index) => {
      const card = h("article", { class: "candidate" },
        h("div", { class: "candidate-head" },
          h("span", { class: "candidate-no", text: String(index + 1).padStart(2, "0") }),
          h("h3", { class: "candidate-q", text: candidate.question }),
        ),
        ...renderPaperEvidence(paper, candidate, index),
      );
      if (candidate.questionId) {
        card.append(h("a", { class: "candidate-open", href: `#/question/${candidate.questionId}`, text: "打开已确认的问题 →" }));
      } else {
        const input = h("textarea", { maxlength: 300, rows: 3, id: `paper-question-${candidate.id}`, required: true });
        input.value = candidate.question;
        const confirm = h("button", { class: "btn btn-primary", type: "submit", text: "确认并创建" });
        const status = h("p", { class: "field-error", role: "status" });
        const form = h("form", { class: "field candidate-form" },
          h("label", { for: input.id, text: "研究问题（可修改）" }), input,
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
        card.append(h("details", { class: "candidate-confirm" },
          h("summary", { text: "编辑并确认问题" }),
          form,
        ));
      }
      rail.append(card);
    });
  }

  return h("div", { class: "reader-layout" }, reader, rail);
}

function renderPaperLibrary(project, papers, selectedSha256) {
  const addButton = h("button", { class: "btn btn-primary", type: "button", id: "addPaperPdf", text: "＋ 添加 PDF" });
  const input = bindPdfImport(addButton, { projectId: project.projectId, meta: null });
  const visiblePapers = papers.filter((paper) => paper.sha256 !== selectedSha256);
  const tabs = h("nav", { class: "paper-tabs", "aria-label": "项目文献" },
    ...visiblePapers.map((paper) => h("a", {
      class: `paper-tab${paper.sha256 === selectedSha256 ? " is-active" : ""}`,
      href: projectPaperHash(project.projectId, paper),
      "aria-current": paper.sha256 === selectedSha256 ? "page" : "false",
      dataset: { paperSha256: paper.sha256 },
    },
      h("strong", { text: paper.title }),
      h("span", { text: `${paper.filename} · ${paper.pages.length} 页` }),
      h("span", { class: "paper-tab-state", text: paper.generation?.candidates.length ? `${paper.generation.candidates.length} 个候选问题` : "尚未生成候选问题" }),
    )),
  );
  return h("section", { class: "paper-library", "aria-labelledby": "paperLibraryTitle" },
    h("div", { class: "paper-library-head" },
      h("p", { class: "eyebrow", text: "文献库" }),
      h("h2", { id: "paperLibraryTitle", text: `项目文献（${papers.length}）` }),
    ),
    papers.length ? tabs : h("p", { class: "paper-library-empty", text: "还没有入库 PDF。添加论文后，可逐页阅读并把原文关联到研究问题。" }),
    addButton,
    input,
  );
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

async function renderProject(projectId, page, cite, paperSha256 = null) {
  const seq = ++projectRenderSeq;
  const project = await data.getProject(ACTOR, projectId);
  if (!project) throw new Error(`项目不存在: ${projectId}`);
  const papers = await data.listPaperStudies(ACTOR, projectId);
  let paper = papers.find((item) => item.sha256 === paperSha256) ?? papers[0] ?? null;
  if (paperSha256 && !paper) throw new Error("项目文献不存在");
  let initialQuote = null;
  if (paper && cite?.startsWith("e:")) {
    const [, questionId, evidenceId] = cite.split(":");
    const evidence = (await data.listPaperEvidence(ACTOR, questionId)).find((item) => item.evidenceId === evidenceId);
    if (!evidence || evidence.projectId !== projectId) throw new Error("研究证据不存在");
    paper = papers.find((item) => item.sha256 === evidence.paperSha256) ?? null;
    if (!paper) throw new Error("研究证据对应的文献不存在");
    page = evidence.page;
    initialQuote = evidence.quote;
  }
  const paperFile = paper ? await data.getPaperFile(ACTOR, projectId, paper.sha256) : null;
  const legacy = papers.length ? null : readLegacyPaperImport(projectId);
  if (seq !== projectRenderSeq || parseRoute().view !== "project" || parseRoute().projectId !== projectId
    || parseRoute().page !== page || (parseRoute().paper ?? null) !== (paperSha256 ?? null)) return;

  const titleInput = h("input", {
    type: "text",
    id: "projectTitleInput",
    class: "project-title-input",
    value: project.name,
    autocomplete: "off",
    "aria-label": "项目名称",
    "aria-describedby": "projectTitleError",
    title: "点击修改项目名；Enter 保存，Esc 取消",
  });
  const titleError = h("span", { class: "field-error project-title-error", id: "projectTitleError", role: "alert", hidden: true });
  const title = h("h1", { class: paper ? "project-paper-title" : "", id: "projectTitle" },
    titleInput,
    paper ? h("span", { class: "project-paper-title-meta", text: `${paper.title} · ${paper.filename} · ${paper.pages.length} 页` }) : null,
    titleError,
  );
  const head = h("div", { class: "project-head" },
    h("div", { class: "project-head-main" },
      h("p", { class: "eyebrow", text: "研究项目" }),
      title,
    ),
    h("div", { class: "head-actions" },
      h("button", { class: "btn btn-primary", type: "button", id: "newQuestionBtn", text: "新建研究问题" }),
    ),
  );

  const listHost = h("div", { id: "questionListHost" });
  main.append(head, listHost);
  listHost.before(renderPaperLibrary(project, papers, paper?.sha256));
  if (paper) {
    listHost.before(
      renderPaperStudy(paper, page, cite, project.name, initialQuote, { showHead: false, file: paperFile }),
      h("div", { class: "section-head" },
        h("h2", { class: "section-title", text: "研究问题" }),
        h("span", { class: "section-count", id: "questionCount" }),
      ),
    );
  } else if (legacy) listHost.before(renderLegacyPaper(projectId, legacy));
  if (paper && page > 0) document.getElementById("paperSheet")?.focus({ preventScroll: true });

  let currentProjectName = project.name;
  let savingProjectName = false;

  function clearTitleError() {
    titleInput.removeAttribute("aria-invalid");
    titleError.hidden = true;
    titleError.textContent = "";
  }

  function showTitleError(message) {
    titleInput.setAttribute("aria-invalid", "true");
    titleError.hidden = false;
    titleError.textContent = message;
  }

  async function saveProjectName() {
    if (savingProjectName) return;
    const name = titleInput.value.trim();
    if (name === currentProjectName) {
      titleInput.value = currentProjectName;
      clearTitleError();
      return;
    }
    if (!name) {
      showTitleError("请填写项目名");
      return;
    }
    clearTitleError();
    savingProjectName = true;
    titleInput.readOnly = true;
    titleInput.setAttribute("aria-busy", "true");
    try {
      const updated = await data.renameProject(ACTOR, projectId, name, new Date().toISOString());
      currentProjectName = updated.name;
      titleInput.value = currentProjectName;
      toast(`已重命名为「${currentProjectName}」`, "ok");
      await render();
    } catch (error) {
      titleInput.readOnly = false;
      titleInput.removeAttribute("aria-busy");
      showTitleError(`重命名失败：${error && error.message ? error.message : String(error)}`);
      titleInput.focus();
    } finally {
      savingProjectName = false;
    }
  }

  titleInput.addEventListener("focus", () => titleInput.select());
  titleInput.addEventListener("keydown", (event) => {
    if (event.isComposing || savingProjectName) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void saveProjectName();
    } else if (event.key === "Escape") {
      event.preventDefault();
      titleInput.value = currentProjectName;
      clearTitleError();
      titleInput.blur();
    }
  });
  titleInput.addEventListener("blur", () => { void saveProjectName(); });

  document.getElementById("newQuestionBtn").addEventListener("click", () => {
    location.hash = `#/new/${projectId}`;
  });

  await updateQuestionList(projectId);

  async function updateQuestionList(targetId) {
    const host = listHost;
    const questions = await data.listQuestions(ACTOR, targetId);
    if (!host.isConnected) return;
    clear(host);
    const countNode = document.getElementById("questionCount");
    if (countNode) countNode.textContent = questions.length > 0 ? `${questions.length} 个` : "";
    if (questions.length === 0) {
      if (paper) {
        host.append(h("p", { class: "list-empty", text: "在右侧候选问题里核对原文，确认后会出现在这里。" }));
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
          h("th", { scope: "col", text: paper ? "问题" : "原句" }),
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
  const projectType = normalizeProjectType(loadProjectTypes()[projectId] ?? "其他");
  const profile = buildQuestionFormProfile(projectType);

  const backLink = h("a", { class: "back-link back-link--follow", href: `#/project/${projectId}`, text: "← 返回项目" });
  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("h1", { text: "新建研究问题" }),
    ),
    h("span", { class: "aux", text: `项目：${project.name} · ${projectType}` }),
  );
  const typeGuide = h("aside", { class: "type-guide", "aria-labelledby": "typeGuideTitle" },
    h("div", { class: "type-guide-heading" },
      h("span", { class: `card-tag ${typeColorClass(projectType)}`, text: projectType }),
      h("h2", { id: "typeGuideTitle", text: profile.guideTitle }),
    ),
    h("p", { text: profile.guideIntro }),
    h("ul", {}, ...profile.checklist.map((item) => h("li", { text: item }))),
    h("p", { class: "type-guide-boundary", text: profile.boundary }),
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
          placeholder: profile.claimPlaceholder,
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
    h("h2", { class: "form-section-title", id: "scopeTitle" }, profile.scopeTitle, h("span", { class: "req-badge", text: "必选" })),
    h("div", { class: "scope-row", role: "radiogroup", "aria-label": "问题范围" },
      h("div", { class: "scope-choice" },
        h("label", {},
          h("input", { type: "radio", name: "scope", value: "target_lr", id: "scopeTarget", "aria-describedby": "scopeTargetHint" }),
          profile.targetScopeLabel,
        ),
        h("p", { class: "choice-hint", id: "scopeTargetHint", text: profile.targetScopeHint }),
      ),
      h("div", { class: "scope-choice" },
        h("label", {},
          h("input", { type: "radio", name: "scope", value: "both_lrs", id: "scopeBoth", "aria-describedby": "scopeBothHint" }),
          profile.bothScopeLabel,
        ),
        h("p", { class: "choice-hint", id: "scopeBothHint", text: profile.bothScopeHint }),
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
    typeGuide, claimSection, dataSection, mappingSection, runSection, scopeSection, submitRow,
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
          h("label", { for: selectId, text: profile.targetConditionLabel }),
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

function renderResearchSources(question, sources, sourceIds) {
  const selected = sourceIds.map((sourceId) => sources.find((source) => source.sourceId === sourceId)).filter(Boolean);
  if (selected.length === 0) return null;
  return h("ul", { class: "research-sources" },
    selected.map((source) => h("li", {},
      h("a", { href: `#/project/${question.projectId}/paper/${source.paperSha256}/${source.page}`, text: `${source.title} · PDF 第 ${source.page} 页` }),
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
          trace.append(h("a", { class: "btn", href: `#/project/${question.projectId}/paper/${source.paperSha256}/${source.page}`, text: `原文第 ${source.page} 页` }));
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

const PAPER_EVIDENCE_LABELS = {
  support: "支持证据",
  counterexample: "反例",
  condition: "适用条件",
};

function renderPaperEvidenceCard(question, evidence, paper, refresh) {
  const status = h("p", { class: "field-error", role: "alert", hidden: true });
  const edit = h("button", { class: "btn btn-small", type: "button", text: "编辑", "aria-label": `编辑${PAPER_EVIDENCE_LABELS[evidence.kind]}` });
  edit.addEventListener("click", () => openPaperEvidenceModal({ question, papers: paper ? [paper] : [], evidence, trigger: edit, onSaved: refresh }));
  const unlink = h("button", { class: "btn btn-small btn-quiet", type: "button", text: "解除关联", dataset: { confirmEvidence: evidence.evidenceId } });
  const cancel = h("button", { class: "btn btn-small btn-quiet", type: "button", text: "取消", hidden: true });
  let confirming = false;
  const reset = () => {
    confirming = false;
    unlink.textContent = "解除关联";
    unlink.classList.remove("btn-danger");
    cancel.hidden = true;
  };
  cancel.addEventListener("click", reset);
  unlink.addEventListener("click", async () => {
    if (!confirming) {
      confirming = true;
      unlink.textContent = "确认解除关联";
      unlink.classList.add("btn-danger");
      cancel.hidden = false;
      unlink.focus();
      return;
    }
    unlink.disabled = true;
    cancel.disabled = true;
    status.hidden = true;
    try {
      await data.removePaperEvidence(ACTOR, { questionId: question.questionId, evidenceId: evidence.evidenceId, now: new Date().toISOString() });
      toast("已解除问题与证据的关联，论文原文仍保留", "ok");
      await refresh();
    } catch (error) {
      status.hidden = false;
      status.textContent = `解除关联失败：${error.message}`;
      unlink.disabled = false;
      cancel.disabled = false;
    }
  });
  const sourceLink = paper ? h("a", { class: "cite-chip", href: projectPaperHash(question.projectId, paper, evidence.page, paperEvidenceRef(question.questionId, evidence.evidenceId)), text: `打开原文 · 第 ${evidence.page} 页` }) : null;
  if (sourceLink) {
    sourceLink.addEventListener("click", async (event) => {
      event.preventDefault();
      const file = await data.getPaperFile(ACTOR, question.projectId, paper.sha256);
      if (!file) {
        toast("请先补传原 PDF，才能查看原版页面", "bad");
        location.hash = sourceLink.hash;
        return;
      }
      await openPdfViewer(paper, file, evidence.page, evidence.quote, sourceLink);
    });
  }
  return h("article", {
    class: `paper-evidence-card paper-evidence-${evidence.kind}`,
    dataset: { evidenceId: evidence.evidenceId, evidenceKind: evidence.kind, paperSha256: evidence.paperSha256 },
  },
    h("div", { class: "paper-evidence-head" },
      h("span", { class: `research-badge paper-evidence-badge--${evidence.kind}`, text: PAPER_EVIDENCE_LABELS[evidence.kind] }),
      h("span", { class: "aux", text: `PDF 物理第 ${evidence.page} 页` }),
    ),
    h("h4", { class: "paper-evidence-title", text: paper?.title ?? evidence.paperSha256 }),
    h("p", { class: "paper-evidence-file", text: paper?.filename ?? "项目文献" }),
    sourceLink,
    h("blockquote", { class: "paper-evidence-quote", text: evidence.quote }),
    h("div", { class: "paper-evidence-note" }, h("strong", { text: "研究者说明" }), h("p", { text: evidence.note })),
    h("div", { class: "paper-evidence-actions" }, edit, unlink, cancel),
    status,
  );
}

function renderQuestionPaperPanel(question, papers, evidence, candidate, candidatePaper, candidateIndex, refresh) {
  const addPdf = h("button", { class: "btn", type: "button", id: "questionAddPaperPdf", text: "＋ 添加 PDF" });
  const pdfInput = bindPdfImport(addPdf, { projectId: question.projectId, meta: null, returnQuestionId: question.questionId });
  const addEvidence = h("button", {
    class: "btn btn-primary",
    type: "button",
    id: "addPaperEvidence",
    text: "＋ 添加证据",
    disabled: !papers.length,
  });
  addEvidence.addEventListener("click", () => openPaperEvidenceModal({ question, papers, trigger: addEvidence, onSaved: refresh }));
  const clue = candidate && candidatePaper ? h("div", { class: "paper-clue" },
    h("div", { class: "paper-clue-head" }, h("h3", { text: "研究线索与文献出处" }), h("span", { class: "aux", text: candidatePaper.title })),
    ...renderPaperEvidence(candidatePaper, candidate, candidateIndex),
  ) : null;
  const columns = Object.entries(PAPER_EVIDENCE_LABELS).map(([kind, label]) => {
    const items = evidence.filter((item) => item.kind === kind);
    return h("section", { class: `paper-compare-column paper-compare-${kind}`, dataset: { evidenceKind: kind }, "aria-labelledby": `paperCompare-${kind}` },
      h("div", { class: "paper-compare-head" },
        h("h3", { id: `paperCompare-${kind}`, text: label }),
        h("span", { class: "rail-count", text: String(items.length) }),
      ),
      items.length
        ? h("div", { class: "paper-compare-list" }, ...items.map((item) => renderPaperEvidenceCard(question, item, papers.find((paper) => paper.sha256 === item.paperSha256) ?? null, refresh)))
        : h("p", { class: "paper-compare-empty", text: "待补充" }),
    );
  });
  return h("section", { class: "panel paper-compare-panel", id: "paperComparePanel", "aria-labelledby": "paperCompareTitle" },
    h("div", { class: "paper-compare-heading" },
      h("div", {},
        h("p", { class: "eyebrow", text: "跨文献阅读" }),
        h("h2", { id: "paperCompareTitle", text: "论文证据对照" }),
        h("p", { class: "aux", text: "证据分类由研究者确认；支持、反例与适用条件并列保留，不自动合并结论。" }),
      ),
      h("div", { class: "paper-compare-actions" }, addPdf, addEvidence),
    ),
    !papers.length ? h("p", { class: "notice", text: "先添加 PDF，再从指定文献的物理页选择连续原文。" }) : null,
    clue,
    h("div", { class: "paper-compare-grid" }, ...columns),
    pdfInput,
  );
}

let paperEvidenceModalState = null;

function openPaperEvidenceModal({ question, papers, evidence = null, trigger, onSaved }) {
  closePaperEvidenceModal(false);
  const overlay = h("div", { class: "modal-overlay", id: "paperEvidenceModalOverlay" });
  const modal = h("div", {
    class: "modal modal--wide modal--paper-evidence",
    id: "paperEvidenceModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "paperEvidenceModalTitle",
    tabindex: "-1",
  });
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const verifyStatus = h("p", { class: "aux", role: "status", id: "paperEvidenceVerifyStatus" });
  const kind = h("select", { id: "paperEvidenceKind", required: true, "aria-label": "证据分类" },
    ...Object.entries(PAPER_EVIDENCE_LABELS).map(([value, label]) => h("option", { value, text: label })),
  );
  kind.value = evidence?.kind ?? "support";
  const note = h("textarea", { id: "paperEvidenceNote", rows: 4, maxlength: 500, required: true, "aria-label": "证据说明" });
  note.value = evidence?.note ?? "";
  const save = h("button", { class: "btn btn-primary", type: "submit", id: "paperEvidenceSave", text: evidence ? "保存修改" : "保存证据" });
  const close = h("button", { class: "btn", type: "button", id: "paperEvidenceClose", text: "取消" });
  const form = h("form", { class: "research-form" },
    h("h2", { id: "paperEvidenceModalTitle", text: evidence ? "编辑研究证据" : "添加研究证据" }),
    h("div", { class: "field" }, h("label", { for: kind.id, text: "证据分类（由研究者确认）" }), kind),
  );

  if (evidence) {
    const paper = papers.find((item) => item.sha256 === evidence.paperSha256);
    form.append(h("section", { class: "paper-evidence-source" },
      h("h3", { text: paper?.title ?? "项目文献" }),
      h("p", { class: "aux", text: `${paper?.filename ?? ""} · PDF 物理第 ${evidence.page} 页` }),
      h("blockquote", { class: "paper-evidence-quote", text: evidence.quote }),
      h("p", { class: "aux", text: "原文、文献与页码不可修改；只调整分类和说明。" }),
    ));
  } else {
    const paperSelect = h("select", { id: "paperEvidencePaper", required: true, "aria-label": "来源文献" },
      ...papers.map((paper) => h("option", { value: paper.sha256, text: `${paper.title} · ${paper.filename}` })),
    );
    const page = h("input", { type: "number", id: "paperEvidencePage", min: 1, step: 1, required: true, value: "1", "aria-label": "PDF 物理页码" });
    const preview = h("div", { class: "paper-evidence-preview", id: "paperEvidencePreview", tabindex: "0", role: "region", "aria-label": "指定页原文" });
    const quote = h("textarea", { id: "paperEvidenceQuote", rows: 5, maxlength: 400, required: true, "aria-label": "连续原文" });
    const load = h("button", { class: "btn btn-small", type: "button", id: "paperEvidenceLoadPage", text: "载入该页" });
    const useSelection = h("button", {
      class: "btn btn-small",
      type: "button",
      id: "paperEvidenceUseSelection",
      text: "使用所选原文",
      mousedown: (event) => event.preventDefault(),
    });
    const verify = h("button", { class: "btn btn-small", type: "button", id: "paperEvidenceVerify", text: "回查原文" });
    const selectedPaper = () => papers.find((item) => item.sha256 === paperSelect.value);
    const loadPage = () => {
      const paper = selectedPaper();
      const number = Number(page.value);
      verifyStatus.textContent = "";
      verifyStatus.classList.remove("field-error");
      if (!paper || !Number.isSafeInteger(number) || number < 1 || number > paper.pages.length) {
        preview.textContent = "请输入该文献的有效物理页码。";
        page.setAttribute("aria-invalid", "true");
        return;
      }
      page.removeAttribute("aria-invalid");
      page.max = String(paper.pages.length);
      preview.textContent = paper.pages[number - 1] || "这一页没有可提取的文字层。";
    };
    paperSelect.addEventListener("change", () => {
      page.value = "1";
      quote.value = "";
      loadPage();
    });
    page.addEventListener("change", loadPage);
    load.addEventListener("click", loadPage);
    useSelection.addEventListener("click", () => {
      const selection = window.getSelection();
      const selected = selection?.toString().trim() ?? "";
      if (!selection || !selection.anchorNode || !preview.contains(selection.anchorNode) || !selected) {
        verifyStatus.textContent = "请先在原文预览中连续选取一段文字。";
        verifyStatus.classList.add("field-error");
        return;
      }
      quote.value = selected.slice(0, 400);
      verifyStatus.textContent = "已填入所选原文，保存前仍需通过回查。";
      verifyStatus.classList.remove("field-error");
      quote.focus();
    });
    verify.addEventListener("click", () => {
      try {
        const citation = verifyPaperQuote(selectedPaper(), Number(page.value), quote.value);
        quote.value = citation.quote;
        verifyStatus.textContent = `回查通过：已定位到第 ${citation.page} 页的连续原文。`;
        verifyStatus.classList.remove("field-error");
      } catch (verifyError) {
        verifyStatus.textContent = `回查失败：${verifyError.message}`;
        verifyStatus.classList.add("field-error");
      }
    });
    form.append(
      h("div", { class: "field" }, h("label", { for: paperSelect.id, text: "来源文献" }), paperSelect),
      h("div", { class: "paper-evidence-page-row" },
        h("div", { class: "field" }, h("label", { for: page.id, text: "PDF 物理页码" }), page),
        load,
      ),
      h("div", { class: "field" },
        h("label", { text: "该页原文（可在预览中选取）" }),
        preview,
        h("div", { class: "paper-evidence-source-actions" }, useSelection, verify),
      ),
      h("div", { class: "field" },
        h("label", { for: quote.id, text: "连续原文（10–400 字符）" }),
        quote,
        verifyStatus,
      ),
    );
    loadPage();
  }

  form.append(
    h("div", { class: "field" }, h("label", { for: note.id, text: "证据说明" }), note),
    error,
    h("div", { class: "modal-actions" }, save, close),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    error.hidden = true;
    try {
      if (evidence) {
        await data.updatePaperEvidence(ACTOR, {
          questionId: question.questionId,
          evidenceId: evidence.evidenceId,
          kind: kind.value,
          note: note.value,
          now: new Date().toISOString(),
        });
      } else {
        const paperSelect = document.getElementById("paperEvidencePaper");
        const page = document.getElementById("paperEvidencePage");
        const quote = document.getElementById("paperEvidenceQuote");
        await data.addPaperEvidence(ACTOR, {
          projectId: question.projectId,
          questionId: question.questionId,
          paperSha256: paperSelect.value,
          page: Number(page.value),
          quote: quote.value,
          kind: kind.value,
          note: note.value,
          now: new Date().toISOString(),
        });
      }
      closePaperEvidenceModal(false);
      toast(evidence ? "证据分类与说明已更新" : "证据已关联到当前研究问题", "ok");
      await onSaved();
    } catch (saveError) {
      error.hidden = false;
      error.textContent = `保存失败：${saveError.message}`;
      save.disabled = false;
    }
  });
  close.addEventListener("click", () => closePaperEvidenceModal());
  modal.append(form);
  paperEvidenceModalState = { trigger, overlay };
  attachModalBehavior(overlay, modal, () => closePaperEvidenceModal());
  (evidence ? kind : document.getElementById("paperEvidencePaper")).focus();
}

function closePaperEvidenceModal(restoreFocus = true) {
  const current = paperEvidenceModalState;
  if (!current) return;
  current.overlay.remove();
  paperEvidenceModalState = null;
  if (restoreFocus && current.trigger?.isConnected) current.trigger.focus();
}

let renderSeq = 0;

async function renderQuestion(questionId) {
  const seq = ++renderSeq;
  cleanupPaperReader();
  clear(main);
  const question = await data.getQuestion(ACTOR, questionId);
  if (seq !== renderSeq) return;
  if (!question) throw new Error(`问题不存在: ${questionId}`);
  const project = await data.getProject(ACTOR, question.projectId);
  const papers = await data.listPaperStudies(ACTOR, question.projectId);
  let candidatePaper = null;
  let candidateIndex = -1;
  let candidate = null;
  for (const paper of papers) {
    const index = paper.generation?.candidates.findIndex((item) => item.questionId === questionId) ?? -1;
    if (index >= 0) {
      candidatePaper = paper;
      candidateIndex = index;
      candidate = paper.generation.candidates[index];
      break;
    }
  }
  const paperEvidence = await data.listPaperEvidence(ACTOR, questionId);
  const research = await data.getQuestionResearch(ACTOR, questionId);
  if (seq !== renderSeq || parseRoute().questionId !== questionId) return;
  const researchPanel = await renderResearchWorkspace(question, research);
  const refreshPapers = () => renderQuestion(questionId);
  const paperPanel = renderQuestionPaperPanel(question, papers, paperEvidence, candidate, candidatePaper, candidateIndex, refreshPapers);

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
  main.append(head, steps, paperPanel);

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
        unavailable ? h("a", { class: "back-link", href: "#/models", text: "前往模型服务配置 →" }) : null,
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
      unavailable ? h("p", { class: "aux", text: "配置并选择模型后返回此处，重试模型分析才会生效。" }) : null,
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
const sidebarLeafLayer = document.getElementById("sidebarLeafLayer");
const sidebarReducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let sidebarLeafReady = false;
let lastSidebarLeafAt = 0;

function loadSidebarArtwork(image, onLoad) {
  image.addEventListener("load", onLoad, { once: true });
  image.addEventListener("error", () => {
    image.hidden = true;
  }, { once: true });
  image.src = image.dataset.src;
}

function markSidebarFeatherReady() {
  shell.classList.add("sidebar-feather-ready");
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
  window.dispatchEvent(new Event("agentflow:sidebar-resize-end"));
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

void refreshAgent().catch((error) => console.info(`模型服务未启用：${error.message}`));
render();

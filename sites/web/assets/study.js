// 表里有据 · 研究界面（卡 09）：外框 + 项目列表 + 项目内问题列表 + 新问题/数据录入。
// 纯 JS（无类型标注）；业务走正式服务动作；持久化 = IndexedDB「本机保存」。
import { createIndexedDBBackend, LOCAL_STORAGE_LABEL } from "./gen/src/experiment/storage-indexeddb.js";
import { createDataService } from "./gen/src/experiment/storage.js";
import { createWorkflowService } from "./gen/src/workflow/service.js";
import {
  deriveLrOptions,
  evaluateEntryMissing,
  filterProjects,
  formatUpdatedAt,
  modelGlyph,
  statusGlyph,
} from "./gen/src/web/model.js";

const DB_NAME = "agentflow-study";
const ACTOR = { userId: "local" };

const backend = createIndexedDBBackend(indexedDB, DB_NAME);
const data = createDataService(backend);
const wf = createWorkflowService({ storage: data, agent: null, now: () => new Date().toISOString() });

const main = document.getElementById("main");
const sidebar = document.getElementById("sidebar");
const navBtn = document.getElementById("navBtn");
document.getElementById("saveMode").textContent = LOCAL_STORAGE_LABEL;

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

// ---------- 路由 ----------

function parseRoute() {
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "project" && parts[1]) return { view: "project", projectId: parts[1] };
  if (parts[0] === "new" && parts[1]) return { view: "newQuestion", projectId: parts[1] };
  if (parts[0] === "question" && parts[1]) return { view: "question", questionId: parts[1] };
  return { view: "projects" };
}

let currentProjectId = null;

async function render() {
  const route = parseRoute();
  closeNav();
  clear(main);
  try {
    if (route.view === "projects") await renderProjects();
    else if (route.view === "project") {
      currentProjectId = route.projectId;
      await renderProject(route.projectId);
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

// ---------- 侧栏 ----------

async function renderSidebar(route) {
  const group = document.getElementById("sideQuestions");
  const list = document.getElementById("sideQuestionList");
  const nameNode = document.getElementById("sideProjectName");
  clear(list);

  let projectId = null;
  if (route.view === "project" || route.view === "newQuestion") projectId = route.projectId;
  if (route.view === "question") {
    const question = await data.getQuestion(ACTOR, route.questionId);
    projectId = question ? question.projectId : null;
  }

  if (!projectId) {
    group.hidden = true;
    return;
  }
  try {
    const project = await data.getProject(ACTOR, projectId);
    const questions = await data.listQuestions(ACTOR, projectId);
    nameNode.textContent = project ? project.name : projectId;
    for (const question of questions) {
      const link = h(
        "a",
        {
          class: "side-question",
          href: `#/question/${question.questionId}`,
          text: question.rawClaim || "(未填主张)",
        },
      );
      if (route.view === "question" && route.questionId === question.questionId) {
        link.setAttribute("aria-current", "page");
      }
      list.append(link);
    }
    group.hidden = false;
  } catch {
    group.hidden = true;
  }
}

// ---------- 视图 1：项目列表 ----------

async function renderProjects() {
  const searchId = "projectSearch";
  const head = h(
    "div",
    { class: "page-head" },
    h("h1", { text: "研究项目" }),
    h("button", { class: "btn btn-primary", type: "button", id: "newProjectBtn", text: "新建项目" }),
  );

  const createRow = h("div", { class: "toolbar", hidden: true, id: "newProjectForm" },
    h("div", { class: "field" },
      h("label", { for: "newProjectName", text: "项目名" }),
      h("input", { type: "text", id: "newProjectName", name: "projectName", autocomplete: "off" }),
    ),
    h("div", { class: "empty-actions" },
      h("button", { class: "btn btn-primary", type: "button", id: "createProjectConfirm", text: "创建" }),
      h("button", { class: "btn", type: "button", id: "createProjectCancel", text: "取消" }),
    ),
  );

  const searchField = h("div", { class: "field search-field" },
    h("label", { for: searchId, text: "搜索项目" }),
    h("input", { type: "search", id: searchId, name: "search", placeholder: "按项目名搜索", autocomplete: "off" }),
  );

  const tableHost = h("div", { id: "projectTableHost" });
  const emptyHost = h("div", { id: "projectEmptyHost" });

  main.append(head, createRow, h("div", { class: "toolbar" }, searchField), tableHost, emptyHost);

  let allProjects = [];

  async function updateTable() {
    const query = document.getElementById(searchId).value;
    const list = filterProjects(allProjects, query);
    clear(tableHost);
    clear(emptyHost);

    if (allProjects.length === 0) {
      emptyHost.append(
        h("div", { class: "empty" },
          h("p", { text: "还没有研究项目" }),
          h("div", { class: "empty-actions" },
            h("button", { class: "btn btn-primary", type: "button", id: "emptyNewProject", text: "新建项目" }),
            h("button", { class: "btn", type: "button", id: "loadDemo", text: "载入演示项目" }),
          ),
        ),
      );
      document.getElementById("emptyNewProject").addEventListener("click", openCreateForm);
      document.getElementById("loadDemo").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "载入中…";
        try {
          await data.ensureDemoProject(ACTOR, new Date().toISOString());
          allProjects = await wf.listProjects(ACTOR);
          await updateTable();
        } finally {
          // 按钮随空态/表格重绘被替换；若仍在 DOM 则恢复
          if (button.isConnected) {
            button.disabled = false;
            button.textContent = "载入演示项目";
          }
        }
      });
      return;
    }

    if (list.length === 0) {
      emptyHost.append(h("div", { class: "empty" }, h("p", { text: "没有匹配的项目" })));
      return;
    }

    const table = h("table", { class: "data-table", id: "projectTable" },
      h("colgroup", {},
        h("col", { class: "col-name" }),
        h("col", { class: "col-count" }),
        h("col", { class: "col-pending" }),
        h("col", { class: "col-updated" }),
      ),
      h("thead", {},
        h("tr", {},
          h("th", { scope: "col", text: "项目名" }),
          h("th", { scope: "col", text: "研究问题" }),
          h("th", { scope: "col", text: "待补实验的问题" }),
          h("th", { scope: "col", text: "最近更新" }),
        ),
      ),
    );
    const tbody = h("tbody");
    for (const project of list) {
      const nameButton = h("button", {
        class: "name-link",
        type: "button",
        text: project.name,
        "aria-label": `打开项目 ${project.name}`,
        onclick: () => {
          location.hash = `#/project/${project.projectId}`;
        },
      });
      tbody.append(
        h("tr", { dataset: { projectId: project.projectId } },
          h("td", { class: "primary-cell" }, nameButton),
          h("td", { class: "num-cell", "data-label": "研究问题", text: String(project.questionCount) }),
          h("td", { class: "num-cell", "data-label": "待补实验", text: String(project.pendingCount) }),
          h("td", { class: "num-cell", "data-label": "最近更新", text: formatUpdatedAt(project.updatedAt) }),
        ),
      );
    }
    table.append(tbody);
    tableHost.append(table);
  }

  function openCreateForm() {
    createRow.hidden = false;
    document.getElementById("newProjectName").focus();
  }

  document.getElementById("newProjectBtn").addEventListener("click", openCreateForm);
  document.getElementById("createProjectCancel").addEventListener("click", () => {
    createRow.hidden = true;
    document.getElementById("newProjectName").value = "";
  });
  document.getElementById("createProjectConfirm").addEventListener("click", async (event) => {
    const input = document.getElementById("newProjectName");
    const name = input.value.trim();
    if (!name) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const project = await wf.createProject(ACTOR, name);
      input.value = "";
      createRow.hidden = true;
      location.hash = `#/project/${project.projectId}`;
    } catch (error) {
      button.disabled = false;
      alert(`创建失败：${error && error.message ? error.message : String(error)}`);
    }
  });
  document.getElementById(searchId).addEventListener("input", () => {
    updateTable();
  });

  allProjects = await wf.listProjects(ACTOR);
  await updateTable();
}

// ---------- 视图 2：项目详情 ----------

async function renderProject(projectId) {
  const project = await data.getProject(ACTOR, projectId);
  if (!project) throw new Error(`项目不存在: ${projectId}`);

  const nameHost = h("span", { id: "projectTitle", text: project.name });
  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("a", { class: "back-link", href: "#/", text: "← 返回项目列表" }),
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
    ),
    h("div", { class: "empty-actions" },
      h("button", { class: "btn btn-primary", type: "button", id: "renameConfirm", text: "保存" }),
      h("button", { class: "btn", type: "button", id: "renameCancel", text: "取消" }),
    ),
  );

  const listHost = h("div", { id: "questionListHost" });
  main.append(head, renameRow, listHost);

  document.getElementById("renameProjectBtn").addEventListener("click", () => {
    renameRow.hidden = false;
    const input = document.getElementById("renameInput");
    input.value = project.name;
    input.focus();
  });
  document.getElementById("renameCancel").addEventListener("click", () => {
    renameRow.hidden = true;
  });
  document.getElementById("renameConfirm").addEventListener("click", async () => {
    const input = document.getElementById("renameInput");
    const name = input.value.trim();
    if (!name) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
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
    const host = document.getElementById("questionListHost");
    clear(host);
    const questions = await data.listQuestions(ACTOR, targetId);
    if (questions.length === 0) {
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
          h("th", { scope: "col", text: "原句" }),
          h("th", { scope: "col", text: "当前状态" }),
          h("th", { scope: "col", text: "最后版本" }),
        ),
      ),
    );
    const tbody = h("tbody");
    for (const question of questions) {
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
          h("td", { "data-label": "状态" }, badge(question.status)),
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
  dataMode: "paste",
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
    dataMode: "paste",
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

  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("a", { class: "back-link", href: `#/project/${projectId}`, text: "← 返回项目" }),
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
    h("h2", { class: "form-section-title", id: "dataTitle", text: "数据输入" }),
    h("div", { class: "input-mode", role: "radiogroup", "aria-label": "数据输入方式" },
      h("label", {},
        h("input", { type: "radio", name: "dataMode", value: "paste", checked: true, id: "modePaste" }),
        "粘贴 TSV/CSV",
      ),
      h("label", {},
        h("input", { type: "radio", name: "dataMode", value: "file", id: "modeFile" }),
        "上传 CSV 文件",
      ),
    ),
    h("div", { class: "field", id: "pasteField" },
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
    h("h2", { class: "form-section-title", id: "scopeTitle", text: "问题范围" }),
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

  main.append(head, form);

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

// ---------- 视图 4：问题详情 ----------

async function renderQuestion(questionId) {
  const question = await data.getQuestion(ACTOR, questionId);
  if (!question) throw new Error(`问题不存在: ${questionId}`);
  const project = await data.getProject(ACTOR, question.projectId);

  const head = h("div", { class: "page-head" },
    h("div", { class: "field", style: "gap:6px" },
      h("a", { class: "back-link", href: `#/project/${question.projectId}`, text: "← 返回项目" }),
      h("h1", { text: question.rawClaim || "(未填主张)" }),
    ),
    badge(question.status),
  );

  const claim = question.confirmedClaim;
  const detail = h("div", { class: "detail-list" },
    h("dl", { class: "detail-grid" },
      h("dt", { text: "问题编号" }),
      h("dd", { text: question.questionId, id: "questionIdValue" }),
      h("dt", { text: "项目" }),
      h("dd", { text: project ? project.name : question.projectId }),
      h("dt", { text: "结构化主张" }),
      h("dd", {
        text: claim
          ? `${claim.factor} / ${claim.metric} / 范围 ${claim.scope === "both_lrs" ? "两档" : "目标档"} / 学习率 ${claim.learningRates.join("、")} / 增幅 ${claim.expectedDeltaPp === null ? "未指定" : `${claim.expectedDeltaPp} 个百分点`} / 目标 ${claim.targetRunId} vs 基线 ${claim.baselineRunId}`
          : "尚未确认（待补充）",
      }),
      h("dt", { text: "当前状态" }),
      h("dd", {}, badge(question.status)),
    ),
  );

  const versionsHost = h("div", { id: "versionHost" });
  main.append(head, detail, versionsHost);

  const versions = await wf.listRevisions(ACTOR, questionId);
  clear(versionsHost);
  if (versions.length === 0) {
    versionsHost.append(h("div", { class: "empty" }, h("p", { text: "还没有分析版本" })));
    return;
  }
  versionsHost.append(h("h2", { text: `分析版本（${versions.length}）` }));
  for (const version of [...versions].reverse()) {
    versionsHost.append(
      h("div", { class: "version-item", dataset: { revisionId: version.revisionId } },
        h("div", {}, h("strong", { text: shortId(version.revisionId) }), ` · 父版本 ${version.parentId ? shortId(version.parentId) : "无"} · ${formatUpdatedAt(version.createdAt)}`),
        h("div", {}, modelBadge(version.modelOutput), ` · 输入运行 ${version.inputSnapshot.runs.map((r) => r.runId).join("、") || "无"} · 结论 ${version.conclusions.length} 条`),
      ),
    );
  }
}

// ---------- 导航按钮 ----------

function closeNav() {
  sidebar.classList.remove("open");
  navBtn.setAttribute("aria-expanded", "false");
}

navBtn.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open");
  navBtn.setAttribute("aria-expanded", open ? "true" : "false");
});

document.getElementById("sideProjects").addEventListener("click", () => {
  closeNav();
});

window.addEventListener("hashchange", () => {
  render();
});

render();

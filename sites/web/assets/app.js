/* AgentFlow · 论文科研工作台（浏览器演示版）
   版式承袭整合版报告骨架（编号章节 / 目录高亮 / KPI / SVG 图表 / CSV / 打印）。
   与服务器版的差别：没有后端——PDF 由 pdf.js 在本地解析，五节点链路在本页执行
   （确定性模拟后端），数据只存在于当前会话内存中。 */

import { runPipeline } from "/assets/pipeline.js";
import * as pdfjsLib from "/assets/vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.mjs";

const $ = (selector) => document.querySelector(selector);

const STEPS = [
  { key: "cards", label: "证据卡抽取" },
  { key: "note", label: "笔记起草" },
  { key: "audit", label: "论断审计" },
  { key: "gate", label: "门禁判定" },
  { key: "archive", label: "归档落盘" },
];

const STATUS_TEXT = {
  passed: "已归档",
  needs_review: "待复核",
  blocked: "已阻断",
  error: "异常",
  running: "运行中",
};

const CLAIM_KINDS = [
  { key: "supported", label: "有据", cls: "bar--supported" },
  { key: "needs_qualification", label: "需限定", cls: "bar--needs_qualification" },
  { key: "insufficient_evidence", label: "证据不足", cls: "bar--insufficient_evidence" },
  { key: "illustration", label: "类比", cls: "bar--illustration" },
];

const SECTIONS = ["sec-overview", "sec-cards", "sec-note", "sec-claims", "sec-log"];

const STATE = {
  papers: [],
  current: null,
  running: false,
  cardFilter: { verified: true, unverified: true },
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));

async function sha256hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toast(message, kind = "") {
  const node = $("#toast");
  node.textContent = message;
  node.className = "toast " + kind;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function newRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `r_${stamp}-${Math.floor(Math.random() * 900 + 100)}`;
}

/* ---------------- 侧栏 ---------------- */

function renderList() {
  const list = $("#paper-list");
  $("#paper-count").textContent = String(STATE.papers.length);
  list.innerHTML = STATE.papers.map((paper) => {
    const active = STATE.current && STATE.current.id === paper.id ? " active" : "";
    const latest = paper.runs[0];
    const status = latest ? STATUS_TEXT[latest.status] || latest.status : "未解析";
    const kind = latest && latest.status === "passed" ? "ok"
      : latest && latest.status === "needs_review" ? "warn"
      : latest ? "bad" : "";
    return `<button type="button" class="paper${active}" data-id="${paper.id}">
      <div class="paper-title">${esc(paper.title || paper.filename)}</div>
      <div class="paper-meta">
        <span class="tag ${kind}">${esc(status)}</span>
        <span>${paper.page_count} 页</span>
        <span>卡 ${paper.cards.filter((c) => c.status === "verified").length}/${paper.cards.length}</span>
      </div>
    </button>`;
  }).join("");
  list.querySelectorAll(".paper").forEach((node) => {
    node.addEventListener("click", () => openPaper(node.dataset.id));
  });
}

/* ---------------- 打开文献 ---------------- */

function openPaper(paperId) {
  const paper = STATE.papers.find((item) => item.id === paperId);
  if (!paper) return;
  STATE.current = paper;
  $("#empty").hidden = true;
  $("#report").hidden = false;
  ["#btn-csv", "#btn-print", "#btn-toc-mobile"].forEach((sel) => { $(sel).hidden = false; });
  STATE.cardFilter = { verified: true, unverified: true };
  renderHead();
  renderStepsFromRun(latestRun(paper));
  renderOverview();
  renderCards();
  renderNote();
  renderClaims();
  renderLog();
  renderList();
  updateToc();
}

function latestRun(paper) {
  return paper.runs && paper.runs.length ? paper.runs[0] : null;
}

function renderHead() {
  const paper = STATE.current;
  const run = latestRun(paper);
  $("#d-title").textContent = paper.title || paper.filename;
  $("#d-eyebrow").textContent =
    `${paper.filename} · ${paper.page_count} 页 · ${paper.text_chars} 字符 · sha256 ${paper.sha256.slice(0, 10)}`;
  const verified = paper.cards.filter((card) => card.status === "verified").length;
  $("#d-standfirst").textContent = run
    ? `最近一次运行：${run.created_at} · ${STATUS_TEXT[run.status] || run.status} · 模拟后端。`
      + "只有通过逐字回查的证据卡才会进入写作；笔记经论断审计后由门禁决定是否归档。"
    : "尚未运行解析。点击「运行解析」，链路会先抽卡并逐字回查，再进入写作与审计。";
  $("#d-byline").innerHTML = [
    ["状态", run ? STATUS_TEXT[run.status] || run.status : "未解析"],
    ["证据卡", `${verified}/${paper.cards.length} 通过回查`],
    ["运行", run ? `${paper.runs.length} 次 · mock` : "0 次"],
    ["页码", `${paper.page_count} 页`],
  ].map(([key, value]) => `<li><span>${esc(key)}</span> ${esc(value)}</li>`).join("");
  $("#run").disabled = STATE.running;
}

/* ---------------- 步骤条 ---------------- */

function renderStepsFromRun(run) {
  if (!run) { resetSteps(); return; }
  const summary = run.summary || {};
  const finished = run.status === "passed" || run.status === "needs_review";
  const details = {
    cards: summary.verified != null ? `${summary.verified}/${summary.cards ?? ""} 张` : "",
    note: summary.paragraphs ? `${summary.paragraphs} 段` : "",
    audit: summary.by_status ? `${summary.by_status.supported || 0} 条有据` : "",
    gate: summary.gate === "pass" ? "通过" : summary.gate === "review" ? "待复核" : "已阻断",
    archive: finished ? "已落盘" : "",
  };
  $("#steps").innerHTML = STEPS.map((step, index) => {
    const ok = finished || (run.status === "blocked" && index < 3);
    const cls = ok ? "step done" : step.key === "gate" ? "step failed" : "step";
    return `<div class="${cls}"><span class="dot"></span>
      <span>${esc(step.label)}</span>
      <span class="muted">${esc(details[step.key] || "")}</span></div>`;
  }).join("");
}

function renderLiveSteps(events) {
  $("#steps").innerHTML = STEPS.map((step) => {
    const mine = events.filter((event) => event.node === step.key);
    const last = mine[mine.length - 1];
    let cls = "step";
    if (last) cls += " " + last.state;
    return `<div class="${cls}" title="${esc(last ? last.detail || step.label : step.label)}">
      <span class="dot"></span><span>${esc(step.label)}</span>
      <span>${esc(last && last.state === "done" && last.detail ? last.detail : "")}</span></div>`;
  }).join("");
}

function resetSteps() {
  $("#steps").innerHTML = STEPS.map((step) =>
    `<div class="step"><span class="dot"></span><span>${esc(step.label)}</span></div>`).join("");
}

/* ---------------- 图表工具 ---------------- */

function niceScale(max, targetTicks) {
  if (!isFinite(max) || max <= 0) { return { max: 1, ticks: [0, 1] }; }
  const raw = max / (targetTicks || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = mult * mag;
  const niceMax = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) { ticks.push(v); }
  return { max: niceMax, ticks };
}

function barChart(host, options) {
  const labels = options.labels;
  const series = options.series.filter((s) => s.values.some((v) => v > 0));
  if (!labels.length || !series.length) {
    host.innerHTML = `<p class="figure-note">${esc(options.emptyText || "暂无数据。")}</p>`;
    return;
  }
  const W = 760, H = 300;
  const m = { t: 16, r: 16, b: 46, l: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  let maxVal = 0;
  labels.forEach((_, i) => series.forEach((s) => { if (s.values[i] > maxVal) maxVal = s.values[i]; }));
  const scale = niceScale(maxVal, 4);
  const y = (v) => m.t + ph - (v / scale.max) * ph;
  const band = pw / labels.length;
  const inner = band * 0.74;
  const gap = 4;
  const skip = Math.ceil(labels.length / 14);

  const out = [];
  const tid = `${host.id || "chart"}-t`;
  const did = `${host.id || "chart"}-d`;
  out.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${tid} ${did}">`);
  out.push(`<title id="${tid}">${esc(options.title)}</title>`);
  out.push(`<desc id="${did}">${esc(options.desc || options.title)}</desc>`);
  scale.ticks.forEach((t) => {
    out.push(`<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"></line>`);
    out.push(`<text class="tick-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${Number.isInteger(t) ? t : t.toFixed(1)}</text>`);
  });
  out.push(`<text class="axis-unit" x="${m.l - 8}" y="${m.t - 4}" text-anchor="end">${esc(options.unit || "")}</text>`);
  out.push(`<line class="axis-line" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"></line>`);

  labels.forEach((label, i) => {
    const present = series.filter((s) => s.values[i] > 0);
    const x0 = m.l + i * band + (band - inner) / 2;
    const bw = present.length > 1 ? (inner - gap * (present.length - 1)) / present.length : inner;
    present.forEach((s, j) => {
      const v = s.values[i];
      const bx = x0 + j * (bw + gap);
      const by = y(v);
      out.push(`<rect class="bar bar--enter ${s.cls}" x="${bx.toFixed(2)}" y="${by.toFixed(2)}" `
        + `width="${bw.toFixed(2)}" height="${(y(0) - by).toFixed(2)}" rx="1">`
        + `<title>${esc(label)} · ${esc(s.name)} · ${v} ${esc(options.unit || "")}</title></rect>`);
    });
    if (i % skip === 0 || i === labels.length - 1) {
      out.push(`<text class="tick-text" x="${(m.l + i * band + band / 2).toFixed(1)}" y="${H - m.b + 20}" text-anchor="middle">${esc(label)}</text>`);
    }
  });
  out.push(`<text class="axis-unit" x="${m.l}" y="${H - 6}">${esc(options.xTitle || "")}</text>`);
  out.push("</svg>");
  host.innerHTML = out.join("");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    host.querySelectorAll(".bar--enter").forEach((b) => b.classList.remove("bar--enter"));
  }));
}

/* ---------------- 01 概览 ---------------- */

function renderOverview() {
  const paper = STATE.current;
  const run = latestRun(paper);
  const summary = (run && run.summary) || {};
  const verified = paper.cards.filter((card) => card.status === "verified").length;
  const byStatus = summary.by_status || {};
  const claimsTotal = summary.claims || paper.claims.length || 0;

  $("#ov-meta").textContent = run ? `最近运行 ${run.id}` : "尚未运行";

  const banner = run && run.status === "needs_review"
    ? `<div class="banner">笔记已落盘，但存在需要人工确认的论断。请到「论断审计」章节逐条核对后再引用。</div>`
    : run && run.status === "blocked"
      ? `<div class="banner bad">已阻断：${esc(summary.error || run.log?.error || "见运行记录章节")}</div>`
      : run && run.status === "passed"
        ? `<div class="banner ok">全部论断均回引到通过回查的卡片，笔记已归档。</div>`
        : `<div class="banner">尚未完成一次通过的运行。链路语义：卡片回查失败即停止，不产出笔记。</div>`;
  $("#ov-banner").innerHTML = banner;

  const kpis = [
    {
      label: "证据卡回查",
      value: `${verified}/${paper.cards.length}`,
      unit: "张通过",
      delta: paper.cards.length ? `通过率 ${Math.round((verified / paper.cards.length) * 100)}%` : "尚未抽卡",
      tone: verified === paper.cards.length && paper.cards.length ? "good" : "bad",
    },
    {
      label: "论断有据",
      value: claimsTotal ? String(byStatus.supported || 0) : "—",
      unit: claimsTotal ? `/ ${claimsTotal} 条` : "",
      delta: claimsTotal
        ? `需限定 ${byStatus.needs_qualification || 0} · 证据不足 ${byStatus.insufficient_evidence || 0}`
        : "尚无审计结果",
      tone: claimsTotal && (byStatus.needs_qualification || byStatus.insufficient_evidence) ? "bad" : "good",
    },
    {
      label: "最近运行",
      value: run ? STATUS_TEXT[run.status] || run.status : "—",
      unit: run ? run.mode : "",
      delta: run ? run.created_at : "未运行",
      tone: run && run.status === "passed" ? "good" : run && run.status === "blocked" ? "bad" : "good",
    },
  ];
  $("#kpis").innerHTML = kpis.map((k) =>
    `<div class="kpi${k.tone === "bad" ? " kpi--bad" : ""}">
      <dt class="kpi__label">${esc(k.label)}</dt>
      <dd class="kpi__value">${esc(k.value)}<span class="kpi__unit">${esc(k.unit)}</span></dd>
      <dd class="kpi__delta kpi__delta--${esc(k.tone)}">${esc(k.delta)}</dd>
    </div>`).join("");

  const pages = [...new Set(paper.cards.map((card) => card.page))].sort((a, b) => a - b);
  barChart($("#chart-cards"), {
    title: "证据卡逐页回查结果柱状图",
    desc: `按页统计通过 / 失败卡片数，共 ${paper.cards.length} 张。`,
    labels: pages.map((p) => `P${p}`),
    unit: "张",
    xTitle: "页码（仅显示有卡片的页）",
    emptyText: "还没有证据卡，运行解析后在此查看逐页回查结果。",
    series: [
      { name: "通过回查", cls: "bar--ok", values: pages.map((p) => paper.cards.filter((c) => c.page === p && c.status === "verified").length) },
      { name: "回查失败", cls: "bar--bad", values: pages.map((p) => paper.cards.filter((c) => c.page === p && c.status !== "verified").length) },
    ],
  });
  $("#cards-note").textContent = paper.cards.length
    ? `共 ${paper.cards.length} 张 · 通过 ${verified} · 失败 ${paper.cards.length - verified}（通过卡片才允许进入写作）`
    : "尚无卡片。";

  barChart($("#chart-claims"), {
    title: "论断审计四态分布柱状图",
    desc: "最近一次运行的论断状态统计。",
    labels: CLAIM_KINDS.map((k) => k.label),
    unit: "条",
    xTitle: "论断状态（最近一次运行）",
    emptyText: run ? "本次运行没有审计产出。" : "尚无审计结果，运行解析后在此查看。",
    series: CLAIM_KINDS.map((k, idx) => ({
      name: k.label, cls: k.cls,
      values: CLAIM_KINDS.map((_, i) => (i === idx ? (byStatus[k.key] || 0) : 0)),
    })),
  });
  $("#claims-note").textContent = claimsTotal
    ? `共 ${claimsTotal} 条 · 门禁 ${summary.gate === "pass" ? "通过" : summary.gate === "review" ? "待复核" : "已阻断"}`
    : "门禁规则：全部 supported 才放行。";

  const rows = [
    ["文献", paper.filename],
    ["标题", paper.title || "—"],
    ["页数 / 字符", `${paper.page_count} / ${paper.text_chars}`],
    ["原文哈希", `${paper.sha256.slice(0, 16)}…`],
    ["证据卡", `${verified} 张通过回查，共 ${paper.cards.length} 张`],
    ["最近运行", run ? `${run.created_at} · ${STATUS_TEXT[run.status] || run.status} · ${run.mode}` : "尚未运行"],
    ["论断", claimsTotal ? `${claimsTotal} 条（待复核 ${(byStatus.needs_qualification || 0) + (byStatus.insufficient_evidence || 0)}）` : "—"],
    ["笔记", run && run.note ? "已生成（可在「笔记」章节查看）" : "未生成"],
  ];
  $("#ov-spec").innerHTML = rows.map(([key, value]) =>
    `<div class="spec__row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("");
}

/* ---------------- 02 证据卡 ---------------- */

function renderCards() {
  const cards = STATE.current.cards;
  $("#cards-meta").textContent = cards.length
    ? `${cards.filter((c) => c.status === "verified").length}/${cards.length} 通过` : "";

  const filters = [
    { key: "verified", label: "通过回查", color: "var(--site-accent)" },
    { key: "unverified", label: "回查失败", color: "var(--risk)" },
  ];
  $("#card-chips").innerHTML = cards.length ? filters.map((f) =>
    `<button type="button" class="chip" data-filter="${f.key}" aria-pressed="${STATE.cardFilter[f.key]}" style="--chip-color:${f.color}">`
    + `<span class="chip__swatch" aria-hidden="true"></span>${f.label}</button>`).join("") : "";

  const body = $("#cards-body");
  if (!cards.length) {
    body.innerHTML = `<div class="placeholder">还没有证据卡。运行一次解析后在此查看回查结果。</div>`;
    return;
  }
  const shown = cards.filter((card) =>
    card.status === "verified" ? STATE.cardFilter.verified : STATE.cardFilter.unverified);
  if (!shown.length) {
    body.innerHTML = `<div class="placeholder">当前筛选下没有卡片，点击上方图例恢复显示。</div>`;
    return;
  }
  body.innerHTML = `<div class="grid-cards">${shown.map((card) => {
    const ok = card.status === "verified";
    return `<div class="card-item ${ok ? "" : "unverified"}">
      <div class="card-top">
        <span class="card-id">${esc(card.card_id)}</span>
        <span class="tag">第 ${card.page} 页</span>
        <span class="tag ${ok ? "ok" : "bad"}">${ok ? "逐字回查通过" : "回查失败"}</span>
        <span class="tag info">${esc(card.kind)}</span>
      </div>
      <blockquote class="card-quote">${esc(card.quote)}</blockquote>
      <p class="card-claim">${esc(card.claim)}</p>
      ${ok ? "" : `<p class="card-reason">${esc(card.reason || "")}</p>`}
    </div>`;
  }).join("")}</div>
  <div class="table-wrap"><table class="data-table">
    <caption>证据卡台账（共 ${shown.length} 张，当前筛选）</caption>
    <thead><tr><th scope="col">卡号</th><th scope="col">页</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col" class="left">论断</th></tr></thead>
    <tbody>${shown.map((card) => `<tr>
      <th scope="row">${esc(card.card_id)}</th>
      <td>${card.page}</td>
      <td>${esc(card.kind)}</td>
      <td>${card.status === "verified" ? "通过" : "失败"}</td>
      <td class="left">${esc(card.claim)}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

/* ---------------- 03 笔记 ---------------- */

function renderNote() {
  const paper = STATE.current;
  const note = paper.note;
  $("#note-meta").textContent = note ? `${paper.filename.replace(/\.pdf$/i, "")}.md` : "";
  $("#note-toolbar").hidden = !note;
  const body = $("#note-body");
  if (!note) {
    body.innerHTML = `<div class="placeholder">还没有笔记。运行解析并通过门禁后在此查看。</div>`;
    return;
  }
  body.innerHTML = md(note);
}

/* ---------------- 04 论断 ---------------- */

function renderClaims() {
  const claims = STATE.current.claims || [];
  $("#claims-meta").textContent = claims.length ? `${claims.length} 条` : "";
  const body = $("#claims-body");
  if (!claims.length) {
    body.innerHTML = `<div class="placeholder">还没有审计结果。</div>`;
    return;
  }
  const groups = new Map();
  claims.forEach((claim) => {
    if (!groups.has(claim.paragraph_id)) groups.set(claim.paragraph_id, []);
    groups.get(claim.paragraph_id).push(claim);
  });
  const badge = (status) => {
    const hit = CLAIM_KINDS.find((k) => k.key === status);
    const kind = status === "supported" ? "ok"
      : status === "needs_qualification" ? "warn"
      : status === "insufficient_evidence" ? "bad"
      : status === "illustration" ? "info" : "";
    return `<span class="tag ${kind}">${hit ? hit.label : esc(status)}</span>`;
  };
  body.innerHTML = [...groups.entries()].map(([pid, items]) => `
    <div class="claim-group">
      <h4>段落 ${esc(pid)}</h4>
      ${items.map((claim) => {
        const cards = claim.cards || [];
        return `<div class="claim">
          <p class="claim-excerpt">${esc(/[「」]/.test(claim.excerpt) ? claim.excerpt : `「${claim.excerpt}」`)}</p>
          <div class="claim-foot">${badge(claim.status)}
            <span>引用 ${cards.length ? esc(cards.join("、")) : "—"}</span>
          </div>
          ${claim.reason ? `<p class="claim-reason">${esc(claim.reason)}</p>` : ""}
        </div>`;
      }).join("")}
    </div>`).join("");
}

/* ---------------- 05 运行记录 ---------------- */

function renderLog() {
  const paper = STATE.current;
  const run = latestRun(paper);
  const body = $("#log-body");
  $("#log-meta").textContent = run ? run.id : "";
  if (!run) {
    body.innerHTML = `<div class="placeholder">还没有运行记录。</div>`;
    return;
  }
  const log = run.log || {};
  const summary = run.summary || {};
  body.innerHTML = `
    <dl class="kv">
      <dt>运行编号</dt><dd class="mono">${esc(run.id)}</dd>
      <dt>状态</dt><dd>${esc(run.status)} · 门禁 ${esc(log.gate || summary.gate || "—")}</dd>
      <dt>后端</dt><dd class="mono">deterministic-mock (mock · 全离线)</dd>
      <dt>原文哈希</dt><dd class="mono">${esc(paper.sha256.slice(0, 16))}…</dd>
      <dt>论断统计</dt><dd>${esc(fmtStatus(summary.by_status))}</dd>
      <dt>模型成本</dt><dd>0 次调用 · 0 tokens · $0.0000（模拟后端不调用模型）</dd>
    </dl>
    ${log.error ? `<div class="banner bad">${esc(log.error)}</div>` : ""}
    ${(log.issues || []).length ? `<div class="banner bad">阻断项：${esc(log.issues.join("；"))}</div>` : ""}
    ${(log.warnings || []).length ? `<div class="banner">提示：${esc(log.warnings.join("；"))}</div>` : ""}
    <h3 class="subhead">模型节点轨迹</h3>
    ${(log.trace || []).map((item) => `
      <div class="trace-row">
        <span class="trace-node">${esc(item.node)}</span>
        <span>${esc(item.model || "—")}</span>
        <span>${item.elapsed_ms} ms</span>
        <span>${item.raw_chars} 字符</span>
        <span class="trace-hash">${esc((item.raw_sha256 || "").slice(0, 12))}</span>
      </div>
      <details><summary>原始输出</summary><pre>${esc(item.raw)}</pre></details>
    `).join("") || `<div class="placeholder">没有节点记录。</div>`}
  `;
}

function fmtStatus(byStatus) {
  const stats = byStatus || {};
  return `有据 ${stats.supported || 0} · 需限定 ${stats.needs_qualification || 0}`
    + ` · 证据不足 ${stats.insufficient_evidence || 0} · 类比 ${stats.illustration || 0}`;
}

/* ---------------- 运行 ---------------- */

function setRunning(running) {
  STATE.running = running;
  $("#run").disabled = running;
  $("#run").textContent = running ? "运行中…" : "运行解析";
}

async function startRun() {
  if (!STATE.current || STATE.running) return;
  const paper = STATE.current;
  setRunning(true);
  resetSteps();
  try {
    const events = [];
    const emit = (node, state, detail) => {
      events.push({ node, state, detail });
      renderLiveSteps(events);
    };
    const log = await runPipeline(
      { paper, pages: paper.pages, paperId: paper.id },
      emit,
      { pace: 260 },
    );
    const run = {
      id: newRunId(),
      created_at: nowStamp(),
      status: log.status,
      mode: "mock",
      summary: log.summary,
      log,
      note: log.note,
    };
    paper.runs.unshift(run);
    paper.cards = log.cards;
    paper.claims = log.claims;
    paper.note = log.note;
    setRunning(false);
    renderHead();
    renderStepsFromRun(run);
    renderOverview();
    renderCards();
    renderNote();
    renderClaims();
    renderLog();
    renderList();
    if (log.status === "passed") {
      toast("解析完成，已归档", "ok");
      jumpTo("sec-note");
    } else if (log.status === "needs_review") {
      toast("解析完成，存在待复核论断", "");
      jumpTo("sec-claims");
    } else {
      toast(`已阻断：${log.error}`, "bad");
      jumpTo("sec-log");
    }
  } catch (error) {
    setRunning(false);
    toast(error.message, "bad");
  }
}

function jumpTo(sectionId) {
  const node = document.getElementById(sectionId);
  if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- CSV 导出 ---------------- */

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(",") + "\r\n"; }

function buildCsv() {
  const paper = STATE.current;
  if (!paper) return "";
  const run = latestRun(paper);
  const summary = (run && run.summary) || {};
  const rows = [];
  rows.push(csvRow(["区块", "基本信息"]));
  rows.push(csvRow(["文件", paper.filename]));
  rows.push(csvRow(["标题", paper.title || ""]));
  rows.push(csvRow(["页数", paper.page_count]));
  rows.push(csvRow(["字符数", paper.text_chars]));
  rows.push(csvRow(["sha256", paper.sha256]));
  rows.push(csvRow(["最近运行", run ? `${run.id} · ${run.status} · ${run.mode} · ${run.created_at}` : "无"]));
  rows.push(csvRow(["门禁", summary.gate || "无"]));
  rows.push("");
  rows.push(csvRow(["区块", `证据卡（${paper.cards.length} 张）`]));
  rows.push(csvRow(["卡号", "页码", "类型", "状态", "引文", "论断", "失败原因"]));
  paper.cards.forEach((card) => rows.push(csvRow([
    card.card_id, card.page, card.kind,
    card.status === "verified" ? "通过" : "失败",
    card.quote, card.claim, card.reason || "",
  ])));
  rows.push("");
  rows.push(csvRow(["区块", `论断审计（${paper.claims.length} 条，最近运行 ${run ? run.id : "无"}）`]));
  rows.push(csvRow(["段落", "摘录", "状态", "引用卡片", "理由"]));
  paper.claims.forEach((claim) => rows.push(csvRow([
    claim.paragraph_id, claim.excerpt, claim.status,
    (claim.cards || []).join("、"), claim.reason || "",
  ])));
  return rows.join("");
}

function downloadCsv() {
  const text = buildCsv();
  if (!text) { toast("请先打开一篇文献", "bad"); return; }
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${STATE.current.id}-ledger.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- 目录高亮（scrollspy） ---------------- */

function initToc() {
  const sections = SECTIONS.map((id) => document.getElementById(id));
  const links = {};
  document.querySelectorAll(".toc__link").forEach((a) => {
    links[a.getAttribute("href").slice(1)] = a;
  });
  let currentId = "";
  function update() {
    const probe = 160;
    let picked = sections[0];
    for (const node of sections) {
      if (node && node.getBoundingClientRect().top <= probe) picked = node;
    }
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      picked = sections[sections.length - 1];
    }
    if (picked && picked.id !== currentId) {
      currentId = picked.id;
      Object.keys(links).forEach((id) => {
        if (id === currentId) links[id].setAttribute("aria-current", "true");
        else links[id].removeAttribute("aria-current");
      });
    }
  }
  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.updateToc = update;
  update();

  const toggle = $("#btn-toc-mobile");
  const list = $("#toc-list");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    list.classList.toggle("is-open", !open);
  });
  list.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 1080px)").matches) {
        toggle.setAttribute("aria-expanded", "false");
        list.classList.remove("is-open");
      }
    });
  });
}

function updateToc() { if (window.updateToc) window.updateToc(); }

/* ---------------- 上传（pdf.js 本地解析） ---------------- */

async function upload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast("只支持 PDF", "bad");
    return;
  }
  toast(`正在本地解析：${file.name}`);
  try {
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256hex(buffer.slice(0));
    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      cMapUrl: "/assets/vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/assets/vendor/standard_fonts/",
    }).promise;

    let title = "";
    try {
      const meta = await pdf.getMetadata();
      title = String(meta.info?.Title || "").trim();
    } catch (_) { /* 元数据缺失不阻断摄取 */ }

    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : " "))
        .join("")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      pages.push(text);
      if (number % 5 === 0) toast(`正在本地解析：${file.name}（${number}/${pdf.numPages} 页）`);
    }
    const textChars = pages.reduce((sum, text) => sum + Array.from(text).length, 0);
    if (!textChars) {
      toast("没有文字层：扫描件需要先 OCR", "bad");
      return;
    }
    const paper = {
      id: "p_" + sha256.slice(0, 16),
      title: title || "",
      filename: file.name,
      page_count: pdf.numPages,
      text_chars: textChars,
      sha256,
      pages,
      cards: [],
      claims: [],
      runs: [],
      note: null,
    };
    const existing = STATE.papers.findIndex((item) => item.id === paper.id);
    if (existing >= 0) STATE.papers.splice(existing, 1);
    STATE.papers.unshift(paper);
    toast(`已入库：${paper.page_count} 页，${paper.text_chars} 字符`, "ok");
    openPaper(paper.id);
    jumpTo("sec-overview");
  } catch (error) {
    toast(`解析失败：${error.message || error}`, "bad");
  }
}

/* ---------------- 极简 Markdown ---------------- */

function md(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const inline = (text) => esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { output.push("<hr>"); index += 1; continue; }

    if (/^\s*>/.test(line)) {
      const block = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        block.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote>${block.map(inline).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*\|/.test(line) && index + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      output.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      output.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      output.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^\s*(#{1,4}\s|>|[-*]\s|\d+[.)]\s|\|)/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    else index += 1;
  }
  return output.join("\n");
}

/* ---------------- 事件绑定与启动 ---------------- */

function bindStatic() {
  $("#run").addEventListener("click", startRun);
  $("#upload-btn").addEventListener("click", () => $("#file").click());
  $("#empty-upload").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", (event) => upload(event.target.files[0]));
  $("#btn-csv").addEventListener("click", downloadCsv);
  $("#btn-print").addEventListener("click", () => window.print());
  $("#card-chips").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter]");
    if (!btn) return;
    const key = btn.getAttribute("data-filter");
    STATE.cardFilter[key] = !STATE.cardFilter[key];
    btn.setAttribute("aria-pressed", String(STATE.cardFilter[key]));
    renderCards();
  });

  ["dragenter", "dragover"].forEach((name) => window.addEventListener(name, (event) => {
    event.preventDefault();
    $("#drop-overlay").hidden = false;
  }));
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) $("#drop-overlay").hidden = true;
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    $("#drop-overlay").hidden = true;
    upload(event.dataTransfer.files[0]);
  });

  document.addEventListener("click", (event) => {
    if (event.target.id === "copy-note") {
      const note = STATE.current && STATE.current.note;
      if (!note) return;
      navigator.clipboard.writeText(note).then(
        () => toast("已复制", "ok"),
        () => toast("复制失败：浏览器拒绝访问剪贴板", "bad"),
      );
    }
    if (event.target.id === "download-note") {
      const note = STATE.current && STATE.current.note;
      if (!note) return;
      const blob = new Blob([note], { type: "text/markdown;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${STATE.current.id}.md`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  });
}

function init() {
  bindStatic();
  initToc();
  resetSteps();
}

init();

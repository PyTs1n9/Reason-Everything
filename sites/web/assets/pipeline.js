/* AgentFlow 浏览器流水线：五节点编排 + 确定性模拟后端。
   行为对齐 app/pipeline.py、app/compose.py、app/model.py 的 MockBackend：
   抽卡 → 逐字回查 → 写作 → 论断审计 → 门禁归档；任何一步不满足条件就停在原地，
   如实报告失败，不产出半成品笔记。
   模拟后端不联网：从真实页面文本里截句，回查与审计是真的在执行，
   只有主张文本是模板。 */

import {
  parseCards, verifyCards, paragraphsFrom, reviewClaims, PENDING,
} from "./core.js";

const PAGE_CHAR_CAP = 6000;
const MIN_VERIFIED = 3;
const SECTIONS = ["研究问题", "方法与数据", "主要结论", "局限与边界"];

/* ---------------- compose ---------------- */

function parseSections(text) {
  let body = text.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```[a-zA-Z]*\s*|\s*```$/g, "").trim();
  }

  const positions = [];
  for (const line of body.split("\n")) {
    for (const heading of SECTIONS) {
      if (line.trim() === `## ${heading}`) positions.push([heading, positions.length]);
    }
  }
  const found = positions.map(([heading]) => heading);
  const issues = [];
  if (found.join("\u0000") !== SECTIONS.join("\u0000")) {
    const missing = SECTIONS.filter((heading) => !found.includes(heading));
    if (missing.length) issues.push("缺少小节：" + missing.join("、"));
    else if (new Set(found).size !== found.length) issues.push("小节标题重复");
    else issues.push("小节顺序与模板不一致");
    return [{}, issues];
  }

  const blocks = body.split(/^## (研究问题|方法与数据|主要结论|局限与边界)$/m);
  const sections = {};
  for (let index = 1; index < blocks.length; index += 2) {
    sections[blocks[index]] = blocks[index + 1].trim();
  }
  for (const [heading, content] of Object.entries(sections)) {
    if (!content) issues.push(`「${heading}」为空`);
    else if (content.length > 900) issues.push(`「${heading}」超过 900 字，可能混入了非本节内容`);
  }
  return [sections, issues];
}

function assemble(paper, cards, sections, meta) {
  const verified = cards.filter((card) => card.status === "verified");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const parts = [
    `# ${paper.title || paper.filename}`,
    "",
    `> 解析对象：\`${paper.filename}\` · ${paper.page_count} 页 · ${paper.text_chars} 提取字符`,
    `> 生成：${stamp} · 后端 \`${meta.backend}\` · 模型 \`${meta.model ?? "-"}\``,
    `> 证据：${cards.length} 张卡片，${verified.length} 张通过逐字回查`,
    "",
    "## 速览",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    `| 文件 | ${paper.filename} |`,
    `| 页数 | ${paper.page_count} |`,
    `| 可提取字符 | ${paper.text_chars} |`,
    `| 证据卡 | ${verified.length} / ${cards.length} 通过回查 |`,
    `| 审计 | ${meta.gate === "pass" ? "通过" : meta.gate === "review" ? "待人工复核" : "未通过"} |`,
    "",
  ];
  for (const heading of SECTIONS) {
    parts.push(`## ${heading}`, "", sections[heading] ?? "原文未提供。", "");
  }
  parts.push(
    "## 证据对照", "",
    "| 卡 | 页 | 原文摘句 | 支撑的主张 | 校验 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const card of cards) {
    const quote = card.quote.replace(/\|/g, "\\|");
    const claim = card.claim.replace(/\|/g, "\\|");
    const flag = card.status === "verified" ? "通过" : `未通过：${card.reason || ""}`;
    parts.push(`| ${card.card_id} | ${card.page} | ${quote} | ${claim} | ${flag} |`);
  }
  parts.push(
    "", "---", "",
    "机器生成：速览表、证据对照表。模型生成：以上四个正文小节，已逐段核查并回引卡片。",
    "未通过回查的卡片保留在表中但不参与写作，也不构成结论依据。",
    "",
  );
  return parts.join("\n");
}

/* ---------------- 确定性模拟后端 ---------------- */

const MockBackend = {
  name: "mock",
  meta: {
    backend: "mock",
    routing: { evidence: ["mock"], note: ["mock"], audit: ["mock"] },
    profiles: [{ name: "mock", model: "deterministic-mock", host: "-" }],
  },

  cards(payload) {
    const cards = [];
    for (const page of payload.pages) {
      const sentences = page.text
        .split(/(?<=[.;])\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 60 && part.length <= 300);
      for (const sentence of sentences.slice(0, 2)) {
        cards.push({
          id: `E${cards.length + 1}`,
          page: page.page,
          quote: sentence,
          claim: `（模拟）第 ${page.page} 页的方法性陈述，用于验证链路。`,
          kind: "method",
        });
        if (cards.length >= 12) break;
      }
      if (cards.length >= 12) break;
    }
    return JSON.stringify({ cards });
  },

  note(payload) {
    const verified = payload.cards.filter((card) => card.status === "verified").slice(0, 4);
    if (!verified.length) throw new Error("没有通过回查的证据卡，模拟后端无法写作");
    const blocks = SECTIONS.map((heading, index) => {
      const card = verified[index % verified.length];
      return `## ${heading}\n\n（模拟文本，不构成科研结论）第 ${card.page} 页的原文记录为：`
        + `「${card.quote.slice(0, 160)}」。[${card.card_id}]`;
    });
    return blocks.join("\n\n");
  },

  audit(payload) {
    const byId = new Map(payload.cards.map((card) => [card.card_id, card]));
    const paragraphs = payload.paragraphs.map((paragraph) => {
      const text = paragraph.text;
      const cut = text.indexOf("。");
      const excerpt = (cut > 0 ? text.slice(0, cut + 1) : text.slice(0, 60)).trim();
      const match = text.match(/\[(E\d+)\]/);
      const card = match ? byId.get(match[1]) : null;
      if (!card) {
        return {
          id: paragraph.id,
          claims: [],
          no_factual_claim_reason: "模拟后端未找到可引用的证据卡。",
        };
      }
      return {
        id: paragraph.id,
        claims: [{
          article_excerpt: excerpt,
          status: "supported",
          evidence: [{ card_id: card.card_id, page: card.page, quote: card.quote.slice(0, 200) }],
          reason: "模拟后端回引该卡片，用于验证校验器。",
        }],
      };
    });
    return JSON.stringify({ paragraphs });
  },
};

/* ---------------- 编排 ---------------- */

function pagesForPrompt(pages) {
  const selected = [];
  const truncated = [];
  let used = 0;
  let stop = false;
  pages.forEach((text, offset) => {
    const number = offset + 1;
    if (!text.trim()) return;
    const chunk = text.slice(0, PAGE_CHAR_CAP);
    const longPage = chunk.length < text.length;
    if (stop || used + chunk.length > 90000) {
      stop = true;
      truncated.push(number);
      return;
    }
    if (longPage) truncated.push(number);
    selected.push({ page: number, text: chunk });
    used += chunk.length;
  });
  return [selected, truncated];
}

/**
 * 跑一遍五节点链路。
 * @param {{paper: object, pages: string[], paperId: string}} input
 * @param {(node: string, state: string, detail?: string, ms?: number) => void} emit
 * @param {{pace?: number}} [options] pace: 节点间人工停顿毫秒数（仅用于 UI 演示节奏）
 * @returns {Promise<object>} 运行日志形状的摘要（与 /api/papers/{id}/runs 同构）
 */
async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function runPipeline(input, emit, options = {}) {
  const { paper, pages, paperId } = input;
  const pace = options.pace || 0;
  const wait = () => (pace ? new Promise((resolve) => setTimeout(resolve, pace)) : Promise.resolve());
  const backend = MockBackend;
  const ctx = {
    cards: [], claims: [], sections: null, issues: [], warnings: [],
    summary: {}, gate: null, detail: "", trace: [], note: null,
  };

  const record = async (node, raw, started, meta) => {
    ctx.trace.push({
      node,
      model: meta?.model ?? "-",
      elapsed_ms: Math.round(performance.now() - started),
      raw,
      raw_chars: Array.from(raw).length,
      raw_sha256: await sha256hex(raw),
    });
  };

  let currentNode = null;
  try {
    /* cards */
    currentNode = "cards";
    emit("cards", "running");
    let started = performance.now();
    const [payloadPages, truncated] = pagesForPrompt(pages);
    if (!payloadPages.length) throw new Error("没有可用的页面文本");
    let raw = backend.cards({ paper, pages: payloadPages });
    await record("cards", raw, started, backend.meta.profiles[0]);
    const [parsed, parseIssues] = parseCards(raw);
    const [verified, verifyIssues] = await verifyCards(parsed, pages, paperId);
    ctx.cards = verified;
    ctx.warnings.push(...parseIssues, ...verifyIssues);
    if (truncated.length) ctx.warnings.push("未送入抽取的页面：" + truncated.join("、"));
    const passed = verified.filter((card) => card.status === "verified").length;
    ctx.detail = `${verified.length} 张卡，${passed} 张通过逐字回查`;
    if (passed === 0) throw new Error("没有任何证据卡通过回查，停止写作");
    emit("cards", "done", ctx.detail, Math.round(performance.now() - started));
    await wait();

    /* note */
    currentNode = "note";
    emit("note", "running");
    const verifiedList = ctx.cards.filter((card) => card.status === "verified");
    if (verifiedList.length < MIN_VERIFIED) {
      throw new Error(`通过回查的卡片只有 ${verifiedList.length} 张，少于 ${MIN_VERIFIED} 张`);
    }
    let noteIssues = [];
    let sections = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      started = performance.now();
      raw = backend.note({ paper, cards: ctx.cards, issues: noteIssues.length ? noteIssues : null });
      await record("note", raw, started, backend.meta.profiles[0]);
      [sections, noteIssues] = parseSections(raw);
      if (!noteIssues.length) break;
      if (attempt === 0) ctx.warnings.push("笔记结构不合格，已请求重写一次");
    }
    if (noteIssues.length) {
      ctx.issues.push(...noteIssues);
      throw new Error("笔记结构不合格：" + noteIssues.join("；"));
    }
    ctx.sections = sections;
    const chars = Object.values(sections).reduce((sum, value) => sum + Array.from(value).length, 0);
    ctx.detail = `${Object.keys(sections).length} 节，正文 ${chars} 字`;
    emit("note", "done", ctx.detail, Math.round(performance.now() - started));
    await wait();

    /* audit */
    currentNode = "audit";
    emit("audit", "running");
    const paragraphs = paragraphsFrom(ctx.sections);
    if (!paragraphs.length) throw new Error("笔记没有可核查的段落");
    ctx.summary.paragraphs = paragraphs.length;
    let claims = [];
    let reviewIssues = ["审计未执行"];
    let counts = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      started = performance.now();
      raw = backend.audit({ cards: ctx.cards, paragraphs, retry: attempt > 0 });
      await record("audit", raw, started, backend.meta.profiles[0]);
      try {
        [claims, reviewIssues, counts] = reviewClaims(raw, paragraphs, ctx.cards);
      } catch (error) {
        if (attempt === 0) continue;
        throw new Error(`审计结果无法解析：${error.message}`);
      }
      if (reviewIssues.length && attempt === 0) continue;
      break;
    }
    ctx.claims = claims;
    Object.assign(ctx.summary, counts);
    ctx.issues.push(...reviewIssues);
    const pending = [...PENDING].reduce((sum, name) => sum + (counts.by_status?.[name] || 0), 0);
    ctx.detail = `${counts.claims || 0} 条论断，待复核 ${pending} 条`;
    emit("audit", "done", ctx.detail, Math.round(performance.now() - started));
    await wait();

    /* gate */
    currentNode = "gate";
    emit("gate", "running");
    started = performance.now();
    if (ctx.issues.length) {
      ctx.gate = "failed";
      throw new Error("门禁未通过：" + ctx.issues.slice(0, 4).join("；"));
    }
    const pendingClaims = ctx.claims.filter((claim) => PENDING.has(claim.status));
    ctx.gate = pendingClaims.length ? "review" : "pass";
    ctx.detail = pendingClaims.length
      ? `待人工复核 ${pendingClaims.length} 条论断，笔记已落盘但标记为待复核`
      : `${ctx.claims.length} 条论断全部有据，允许归档`;
    emit("gate", "done", ctx.detail, Math.round(performance.now() - started));
    await wait();

    /* archive */
    currentNode = "archive";
    emit("archive", "running");
    started = performance.now();
    ctx.note = assemble(paper, ctx.cards, ctx.sections, {
      backend: backend.name, model: backend.meta.profiles[0].model, gate: ctx.gate,
    });
    ctx.detail = `笔记已生成，${ctx.cards.length} 个锚点`;
    emit("archive", "done", ctx.detail, Math.round(performance.now() - started));
    await wait();
    return buildLog(ctx, null);
  } catch (error) {
    /* 与 workflow.py 一致：节点内任何失败都按节点失败上报，链路停在原地。 */
    ctx.error = String(error.message || error);
    if (currentNode) emit(currentNode, "failed", ctx.error);
    await wait();
    return buildLog(ctx, ctx.error);
  }
}

function buildLog(ctx, error) {
  const summary = {
    gate: ctx.gate,
    cards: ctx.cards.length,
    verified: ctx.cards.filter((card) => card.status === "verified").length,
    paragraphs: ctx.summary.paragraphs || 0,
    claims: ctx.summary.claims || ctx.claims.length,
    by_status: ctx.summary.by_status || {},
    error,
  };
  const status = error
    ? "blocked"
    : ctx.gate === "pass" ? "passed" : "needs_review";
  return {
    status,
    gate: ctx.gate,
    error,
    issues: ctx.issues,
    warnings: ctx.warnings,
    summary,
    cards: ctx.cards,
    claims: ctx.claims,
    note: ctx.note,
    trace: ctx.trace,
    mode: "mock",
    backend: { model: "deterministic-mock" },
  };
}

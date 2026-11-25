import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const study = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = "/* 卡 24：文章页压缩页头";
const compact = css.slice(css.indexOf(marker));

function ruleBody(source: string, selector: string): string {
  const bodies = ruleBodies(source, selector);
  assert.notEqual(bodies.length, 0, `缺少规则 ${selector}`);
  return bodies[0];
}

function ruleBodies(source: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

function px(body: string, prop: string): number {
  const match = body.match(new RegExp(`${prop}:\\s*(-?\\d+)(?:px)?`));
  assert.ok(match, `规则缺少 ${prop}`);
  return Number(match[1]);
}

test("紧凑布局只在桌面文章阅读路由生效", () => {
  assert.notEqual(css.indexOf(marker), -1);
  assert.match(compact, /@media \(min-width: 961px\)/);
  assert.match(compact, /body:has\(\.reader-layout\) \.topbar/);
  assert.match(compact, /body:has\(\.reader-layout\) \.content/);
  assert.doesNotMatch(compact, /@media \(max-width: 960px\)/);
});

test("文章页顶栏与返回链接保持 8px 避让，内容间距仍为 6px", () => {
  const topbar = ruleBody(compact, "body:has(.reader-layout) .topbar");
  const back = ruleBody(compact, "body:has(.reader-layout) .back-link--follow");
  const content = ruleBody(compact, "body:has(.reader-layout) .content");
  assert.equal(px(topbar, "height"), 56);
  assert.equal(px(back, "top"), px(topbar, "height") + 8);
  assert.equal(px(content, "gap") + px(back, "margin-bottom"), 6);
});

test("桌面文章页扩大内容宽度并压缩项目标题与文献条", () => {
  const content = ruleBody(compact, "body:has(.reader-layout) .content");
  const head = ruleBody(compact, "body:has(.reader-layout) .project-head");
  const title = ruleBody(compact, "body:has(.reader-layout) .project-head h1");
  const library = ruleBody(compact, "body:has(.reader-layout) .paper-library");
  assert.match(content, /max-width:\s*1680px/);
  assert.match(content, /padding:\s*12px 24px 40px/);
  assert.equal(px(content, "gap"), 10);
  assert.equal(px(head, "padding-bottom"), 10);
  assert.equal(px(title, "font-size"), 24);
  assert.match(ruleBody(compact, "body:has(.reader-layout) .project-head .eyebrow"), /display:\s*none/);
  assert.match(ruleBody(compact, "body:has(.reader-layout) .paper-tab-state"), /display:\s*none/);
  assert.match(library, /margin-bottom:\s*0/);
});

test("正文、原版页面与证据栏按内容自然展开，不制造嵌套滚动", () => {
  const reader = ruleBody(css, ".reader");
  const sheet = ruleBody(css, ".paper-sheet");
  const rail = ruleBody(css, ".evidence-rail");
  assert.match(reader, /overflow:\s*clip/);
  assert.match(sheet, /height:\s*auto/);
  assert.match(sheet, /overflow:\s*visible/);
  assert.match(rail, /overflow:\s*visible/);
  assert.doesNotMatch(reader, /(?:^|;)\s*height:\s*(?:clamp|max|calc|\d)/);
  assert.doesNotMatch(rail, /(?:^|;)\s*height:\s*(?:clamp|max|calc|\d)/);
  for (const body of ruleBodies(css, ".paper-sheet")) {
    assert.doesNotMatch(body, /(?:^|;)\s*height:\s*(?:clamp|max|calc|\d)/);
  }
  assert.doesNotMatch(study, /updateRailFade/);
  assert.doesNotMatch(study, /sheet\.scrollTop/);
});

test("主阅读器默认原版，提供缩放、适合宽度与响应式重绘", () => {
  assert.match(study, /let readerMode = file \? "original" : "text"/);
  assert.match(study, /text:\s*"文字重排"/);
  assert.match(study, /text:\s*"适应宽度"/);
  assert.match(study, /loadPdfDocument\(file\)/);
  assert.match(study, /\}\)\.promise\);/);
  assert.match(study, /renderPdfPageCanvas\(\{/);
  assert.match(study, /scale = \(availableWidth \/ base\.width\) \* readerZoom/);
  assert.match(study, /new ResizeObserver/);
  assert.match(study, /window\.addEventListener\("resize", resizeHandler\)/);
  assert.match(study, /window\.removeEventListener\("resize", resizeHandler\)/);
  assert.match(study, /activePaperReaderCleanup = \(\) =>/);
  assert.match(study, /marked\.scrollIntoView\(\{ block: "center" \}\)/);
  const original = ruleBody(css, ".paper-sheet.is-original");
  const stage = ruleBody(css, ".pdf-stage--embedded");
  assert.match(original, /padding:\s*0/);
  assert.match(stage, /overflow-x:\s*auto/);
  assert.match(stage, /overflow-y:\s*hidden/);
});

test("原版宽度重绘复用画布，侧栏拖动中不清空论文", () => {
  const drawStart = study.indexOf("  const drawOriginal = async");
  const drawEnd = study.indexOf("  const setReaderMode =", drawStart);
  assert.ok(drawStart >= 0 && drawEnd > drawStart, "缺少原版绘制函数");
  const draw = study.slice(drawStart, drawEnd);
  const createStart = draw.indexOf("if (!view");
  assert.ok(createStart >= 0, "原版视图缺少创建分支");
  assert.doesNotMatch(draw.slice(0, createStart), /clear\(sheet\)/);
  assert.match(draw.slice(createStart), /clear\(sheet\)/);
  assert.match(draw, /sheet\.dataset\.readerMode === "original"/);
  assert.match(draw, /canvas\.style\.width/);
  assert.match(study, /renderedPageWidth \* \(width \/ observedWidth\)/);
  assert.match(study, /document\.body\.classList\.contains\("sidebar-resizing"\)/);
  assert.match(study, /pendingWidth = width/);
  assert.match(study, /requestAnimationFrame\(\(\) =>/);
  assert.match(study, /window\.addEventListener\("agentflow:sidebar-resize-end"/);
  assert.match(study, /window\.removeEventListener\("agentflow:sidebar-resize-end"/);
  const redrawStart = study.indexOf("  const redrawForWidth =");
  const redrawEnd = study.indexOf("  const flushSidebarResize =", redrawStart);
  assert.ok(redrawStart >= 0 && redrawEnd > redrawStart, "缺少宽度重绘调度");
  assert.doesNotMatch(study.slice(redrawStart, redrawEnd), /commitPage\(/);
  assert.match(study.slice(redrawStart, redrawEnd), /void drawOriginal\(currentPage, currentQuote\)/);
});

test("原版与文字重排共用同一外框宽度，只调整正文行宽", () => {
  const layout = ruleBody(compact, "body:has(.reader-layout) .reader-layout");
  const textSheet = ruleBody(compact, "body:has(.reader-layout) .paper-sheet.is-text");
  assert.match(layout, /grid-template-columns:\s*minmax\(0, 1fr\) 320px/);
  assert.equal(px(layout, "gap"), 24);
  assert.doesNotMatch(layout, /max-width/);
  assert.doesNotMatch(compact, /\.reader-layout:has\(\.paper-sheet\.is-text\)/);
  assert.match(textSheet, /padding:\s*28px 36px 44px/);
});

test("OCR 状态条压缩为单行摘要，逐页操作仍保留在 DOM", () => {
  const panel = ruleBody(compact, "body:has(.reader-layout) .ocr-panel");
  const copy = ruleBody(compact, "body:has(.reader-layout) .ocr-panel-head p");
  const status = ruleBody(compact, "body:has(.reader-layout) .ocr-panel > .rail-note,\n  body:has(.reader-layout) .ocr-panel > .field-error");
  assert.match(panel, /display:\s*grid/);
  assert.match(panel, /grid-template-columns:\s*minmax\(0, 1fr\) auto auto/);
  assert.match(panel, /padding:\s*6px 12px/);
  assert.match(ruleBody(compact, "body:has(.reader-layout) .ocr-panel-head"), /grid-column:\s*1 \/ -1/);
  assert.match(ruleBody(compact, "body:has(.reader-layout) .ocr-details"), /grid-column:\s*2/);
  assert.match(copy, /white-space:\s*nowrap/);
  assert.match(copy, /text-overflow:\s*ellipsis/);
  assert.match(status, /white-space:\s*nowrap/);
  assert.doesNotMatch(compact, /\.ocr-details\s*\{[^}]*display:\s*none/);
});

test("≤960px 回退单列自然高度，窄屏原版保留横向缩放", () => {
  const narrowAt = css.indexOf("@media (max-width: 960px)");
  assert.notEqual(narrowAt, -1);
  const narrow = css.slice(narrowAt, css.indexOf("@media (min-width: 768px)", narrowAt));
  assert.match(narrow, /\.reader-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(narrow, /\.paper-sheet\s*\{[^}]*height:\s*(?:min|max|calc|\d)/);
  const mobileAt = css.indexOf("@media (max-width: 767px)", narrowAt);
  const mobile = css.slice(mobileAt, css.indexOf(".reader-bar", mobileAt));
  assert.match(mobile, /\.paper-sheet\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none/);
  assert.match(css, /\.paper-sheet\.is-original \.pdf-stage--embedded\s*\{[^}]*padding:\s*0 8px 12px/);
});

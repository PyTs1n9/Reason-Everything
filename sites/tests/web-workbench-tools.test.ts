import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = "/* 卡 26：工作台水晶工具条 */";
const markerAt = css.indexOf(marker);
assert.notEqual(markerAt, -1, "缺少工作台工具条样式区");
const section = css.slice(markerAt);

function ruleBody(selector: string): string {
  const at = section.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = section.indexOf("{", at);
  const close = section.indexOf("}", open);
  return section.slice(open + 1, close);
}

function mediaBody(query: string): string {
  const at = section.indexOf(`@media ${query} {`);
  assert.notEqual(at, -1, `缺少媒体查询 ${query}`);
  const open = section.indexOf("{", at);
  const close = section.indexOf("\n}\n", open);
  return section.slice(open + 1, close);
}

test("搜索与右上角操作同属一个可访问工具条，计数并入最近更新行", () => {
  assert.match(js, /const searchBox = h\("div", \{ class: "search-box workbench-search" \}/);
  assert.match(js, /const actionGroup = h\("div", \{\s*class: "head-actions workbench-actions",\s*role: "group"/s);
  assert.match(js, /const tools = h\("div", \{\s*class: "workbench-tools",\s*role: "group",[\s\S]*?\}, searchBox, actionGroup\);/s);
  assert.match(js, /const listToolbar = h\("div", \{ class: "workbench-list-head", id: "listToolbar" \},\s*sectionTitle,\s*h\("p", \{ class: "list-count", id: "projectCount" \}\)/s);
  assert.match(js, /main\.append\(head, listToolbar, gridHost, emptyHost\);/);
  assert.match(js, /searchBox\.hidden = allProjects\.length === 0;/);
  assert.match(ruleBody(".workbench-search[hidden]"), /display:\s*none/);
  assert.match(ruleBody(".workbench-list-head[hidden]"), /display:\s*none/);
});

test("项目搜索移除 Ctrl K 提示与快捷键，仅保留输入和 Escape 清空", () => {
  assert.match(js, /placeholder: "搜索项目"/);
  assert.match(js, /"aria-label": "搜索项目"/);
  assert.match(js, /searchInput\.addEventListener\("keydown", \(event\) => \{\s*if \(event\.key === "Escape" && searchInput\.value\)/s);
  assert.doesNotMatch(js, /Ctrl K|⌘ K|search-kbd|pendingSearchFocus/);
  assert.doesNotMatch(js, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.doesNotMatch(css, /\.search-kbd/);
});

test("工具条使用半透明玻璃、折射高光与内描边，搜索不再自带重边框", () => {
  const tools = ruleBody(".workbench-tools");
  assert.match(tools, /background:[^;]*radial-gradient[^;]*linear-gradient/s);
  assert.match(tools, /backdrop-filter:\s*blur\(18px\) saturate\(135%\)/);
  assert.match(tools, /box-shadow:[^;]*inset 0 1px 0 var\(--glass-highlight\)/s);
  assert.match(ruleBody(".workbench-tools::before"), /linear-gradient\(115deg/);
  assert.match(ruleBody(".workbench-tools::after"), /linear-gradient\(90deg/);
  const search = ruleBody(".workbench-tools .search-box input[type=\"search\"]");
  assert.match(search, /background:\s*transparent/);
  assert.match(search, /background-image:\s*none/);
  assert.match(search, /border:\s*1px solid transparent/);
});

test("三个操作共用尺寸与玻璃底，仅导入 PDF 保留主操作权重", () => {
  const button = ruleBody(".workbench-tools .head-actions .btn");
  assert.match(button, /min-height:\s*38px/);
  assert.match(button, /border-radius:\s*11px/);
  assert.match(button, /background:\s*var\(--glass-control\)/);
  assert.match(button, /box-shadow:[^;]*inset 0 1px 0 var\(--glass-highlight\)/);
  assert.match(ruleBody(".workbench-tools .head-actions .btn-primary"), /background:\s*linear-gradient/);
  assert.match(js, /class: "btn btn-new-project"/);
  assert.doesNotMatch(js, /class: "btn btn-primary btn-new-project"/);
  assert.match(ruleBody(".workbench-list-head .list-count"), /border-radius:\s*999px/);
});

test("桌面保持同级，窄屏工具条内部 stack 且三个操作等宽", () => {
  const tablet = mediaBody("(max-width: 1199px)");
  assert.match(tablet, /\.workbench-head\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(tablet, /\.workbench-tools\s*\{[^}]*width:\s*100%/s);
  const mobile = mediaBody("(max-width: 640px)");
  assert.match(mobile, /\.workbench-tools\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(mobile, /\.workbench-tools \.head-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(mobile, /\.workbench-tools \.search-box input\[type="search"\]\s*\{[^}]*min-height:\s*44px/s);
  assert.match(mobile, /\.workbench-tools \.head-actions \.btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(mediaBody("(max-width: 380px)"), /\.workbench-tools \.head-actions \.btn svg\s*\{[^}]*width:\s*14px/s);
});

test("聚焦、减少透明度和减少动效偏好均有明确降级", () => {
  const focus = ruleBody(".workbench-tools .search-box input[type=\"search\"]:focus-visible");
  assert.match(focus, /outline:\s*none/);
  assert.match(focus, /box-shadow:[^;]*0 0 0 3px var\(--glass-focus\)/);
  const noMotion = mediaBody("(prefers-reduced-motion: reduce)");
  assert.match(noMotion, /\.workbench-tools::before,[\s\S]*?transition:\s*none/);
  assert.match(noMotion, /\.workbench-tools:hover::before,[\s\S]*?transform:\s*none/);
  const noTransparency = mediaBody("(prefers-reduced-transparency: reduce)");
  assert.match(noTransparency, /\.workbench-tools\s*\{[^}]*background:\s*var\(--surface\)[^}]*backdrop-filter:\s*none/s);
  assert.match(noTransparency, /\.workbench-tools::before,[\s\S]*?display:\s*none/);
  assert.match(mediaBody("(forced-colors: active)"), /border-color:\s*CanvasText/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = "/* 首页卡片：虹彩毛玻璃与随机渐变羽毛。 */";
const markerAt = css.indexOf(marker);
assert.notEqual(markerAt, -1, "缺少首页毛玻璃卡片样式区");
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
  assert.notEqual(close, -1, `媒体查询 ${query} 未闭合`);
  return section.slice(open + 1, close);
}

test("每张项目卡片使用透明 PNG 羽毛，装饰不进入交互与无障碍树", () => {
  assert.match(js, /cardFeatherVariant,[\s\S]*?from "\.\/gen\/src\/web\/model\.js"/);
  assert.match(js, /function featherFor\(projectId\)[\s\S]*?cardFeatherVariant\(projectId\)/);
  assert.doesNotMatch(js, /CARD_FEATHER_(?:BODY|QUILL|BARBS)|variant\.shape/);
  const featherMarkup = js.slice(js.indexOf("function featherFor("), js.indexOf("function cardFor("));
  assert.match(featherMarkup, /h\("img", \{/);
  assert.match(featherMarkup, /class: "card-feather"/);
  assert.match(featherMarkup, /src: "\.\/assets\/sidebar-feather\.png"/);
  assert.match(featherMarkup, /alt: ""/);
  assert.match(featherMarkup, /draggable: "false"/);
  assert.match(featherMarkup, /"aria-hidden": "true"/);
  assert.match(featherMarkup, /--feather-x:\$\{variant\.x\}px;--feather-y:\$\{variant\.y\}px;--feather-scale:\$\{variant\.scale\};--feather-rotate:\$\{variant\.rotate\}deg/);
  assert.doesNotMatch(featherMarkup, /<svg|insertAdjacentHTML|linearGradient|<stop/);
  assert.match(js, /const featherVariant = cardFeatherVariant\(project\.projectId\);/);
  assert.match(js, /featherFor\(project\.projectId\),/);
  const feather = ruleBody(".card-feather");
  assert.match(feather, /position:\s*absolute/);
  assert.match(feather, /display:\s*block/);
  assert.match(feather, /object-fit:\s*contain/);
  assert.match(feather, /right:\s*var\(--feather-x/);
  assert.match(feather, /top:\s*var\(--feather-y/);
  assert.match(feather, /pointer-events:\s*none/);
  assert.doesNotMatch(section, /\.card-feather svg/);
});

test("卡片内容分为标签、正文与底部操作，链接整卡覆盖但不遮挡按钮", () => {
  const card = js.slice(js.indexOf("function cardFor("), js.indexOf("async function updateGrid("));
  assert.match(card, /h\("article", \{/);
  assert.match(card, /h\("div", \{ class: "card-top" \}/);
  assert.match(card, /h\("div", \{ class: "card-body" \},[\s\S]*?nameNode/);
  assert.match(card, /h\("div", \{ class: "card-footer" \},[\s\S]*?h\("div", \{ class: "card-actions" \}, pinBtn, renameBtn, deleteBtn\)/);
  const overlayRules = [...css.matchAll(/(?:^|\n)\.card-name::after\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join("\n");
  assert.match(ruleBody(".card-name"), /z-index:\s*3/);
  assert.match(overlayRules, /position:\s*absolute/);
  assert.match(overlayRules, /inset:\s*0/);
  assert.match(ruleBody(".card-footer"), /z-index:\s*4/);
  assert.doesNotMatch(ruleBody(".card-body"), /position:\s*(?:relative|absolute|fixed|sticky)/);
});

test("卡片使用项目专属光晕、虹彩渐变、模糊饱和度与柔和高光", () => {
  const card = ruleBody(".project-card");
  assert.match(card, /background:[^;]*radial-gradient[^;]*radial-gradient[^;]*linear-gradient/s);
  assert.match(card, /var\(--card-orb-x/);
  assert.match(card, /var\(--feather-b, var\(--brand\)\)/);
  assert.match(card, /backdrop-filter:\s*blur\(20px\) saturate\(145%\)/);
  assert.match(card, /-webkit-backdrop-filter:\s*blur\(20px\) saturate\(145%\)/);
  assert.match(card, /border-radius:\s*20px/);
  assert.match(card, /box-shadow:[^;]*inset 0 1px 0 var\(--glass-highlight\)/s);
  assert.match(ruleBody(".project-card::before"), /linear-gradient\(115deg/);
  assert.match(ruleBody("body:has(.workbench-head)"), /radial-gradient/);
  assert.match(ruleBody(".skeleton-card"), /backdrop-filter:\s*blur\(20px\) saturate\(145%\)/);
});

test("桌面两列、手机单列，操作按钮保持可点击且不产生横向溢出", () => {
  assert.match(mediaBody("(min-width: 1024px)"), /\.project-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(mediaBody("(max-width: 767px)"), /\.project-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(mediaBody("(max-width: 767px)"), /\.card-feather\s*\{[^}]*width:\s*60px[^}]*height:\s*60px/s);
  assert.match(ruleBody(".project-card"), /overflow:\s*hidden/);
  assert.match(ruleBody(".card-name"), /overflow-wrap:\s*anywhere|padding-right:\s*42px/);
  assert.match(ruleBody(".card-footer"), /display:\s*flex/);
  assert.match(ruleBody(".card-actions"), /flex:\s*none/);
});

test("悬停效果仅用于精细指针，减少动效、透明度与强制颜色均有降级", () => {
  const hover = mediaBody("(hover: hover) and (pointer: fine)");
  assert.match(hover, /\.project-card:hover\s*\{[^}]*transform:\s*translateY\(-4px\)/s);
  assert.match(hover, /\.project-card:hover \.card-feather\s*\{[^}]*transform:\s*rotate/s);
  const motion = mediaBody("(prefers-reduced-motion: reduce)");
  assert.match(motion, /\.project-card,[\s\S]*?\.card-feather,[\s\S]*?transition:\s*none/);
  assert.match(motion, /\.project-card:hover \.card-feather\s*\{[^}]*transform:\s*rotate\(var\(--feather-rotate/s);
  const transparency = mediaBody("(prefers-reduced-transparency: reduce)");
  assert.match(transparency, /\.project-card,\s*\.skeleton-card,\s*\.empty--start\s*\{[^}]*background:\s*var\(--surface\)[^}]*backdrop-filter:\s*none/s);
  assert.match(transparency, /\.project-card::before,[\s\S]*?display:\s*none/);
  assert.match(mediaBody("(prefers-contrast: more)"), /border-color:\s*var\(--line-strong\)/);
  const forced = mediaBody("(forced-colors: active)");
  assert.match(forced, /border-color:\s*CanvasText/);
  assert.match(forced, /background:\s*Canvas/);
  assert.match(forced, /\.project-card::before,[\s\S]*?\.card-feather\s*\{[^}]*display:\s*none/s);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = "/* 全站水晶墨绿森林主题 */";
const markerAt = css.indexOf(marker);
assert.notEqual(markerAt, -1, "缺少全站主题样式区");
const theme = css.slice(markerAt);

function ruleBody(selector: string): string {
  const escaped = selector
    .trim()
    .split(/\s*\n\s*/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const matches = [...theme.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  const match = matches.find((entry) => theme[entry.index - 1] !== ",");
  assert.ok(match, `缺少规则 ${selector}`);
  return match[1];
}

function mediaBodies(query: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < theme.length) {
    const at = theme.indexOf(`@media ${query} {`, from);
    if (at === -1) break;
    const open = theme.indexOf("{", at);
    let depth = 1;
    let end = -1;
    for (let i = open + 1; i < theme.length; i += 1) {
      if (theme[i] === "{") depth += 1;
      if (theme[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    assert.notEqual(end, -1, `媒体查询未闭合：${query}`);
    blocks.push(theme.slice(open + 1, end));
    from = end + 1;
  }
  return blocks;
}

function mediaBody(query: string): string {
  const blocks = mediaBodies(query);
  assert.ok(blocks.length, `缺少媒体查询 ${query}`);
  return blocks[0];
}

test("全站主题从页面骨架和路由进入，不改变原有路由契约", () => {
  assert.match(html, /<body class="crystal-forest">/);
  assert.match(js, /const route = parseRoute\(\);\s*document\.body\.dataset\.view = route\.view;/);
  for (const view of ["projects", "project", "newQuestion", "models", "question"]) {
    assert.ok(js.includes(`view: "${view}"`), `缺少路由 ${view}`);
  }
});

test("主题使用独立的森林与水晶令牌，保留原始明暗主题声明", () => {
  const light = ruleBody("body.crystal-forest");
  assert.match(light, /--bg-app:\s*#e8f0e9/);
  assert.match(light, /--ink:\s*#183226/);
  assert.match(light, /--brand:\s*#2f7353/);
  assert.match(light, /--glass-highlight:\s*rgba\(255, 255, 255, 0\.78\)/);
  assert.match(light, /--crystal-radius:\s*18px/);
  assert.match(light, /--crystal-blur:\s*blur\(18px\) saturate\(138%\)/);
  assert.match(light, /--crystal-surface-bg:[\s\S]*radial-gradient[\s\S]*linear-gradient/);
  const dark = mediaBody("(prefers-color-scheme: dark)");
  assert.match(dark, /--bg-app:\s*#07150f/);
  assert.match(dark, /--surface:\s*rgba\(13, 34, 24, 0\.86\)/);
  assert.match(dark, /--brand:\s*#8bd3aa/);
  assert.match(dark, /--glass-line:\s*rgba\(166, 216, 187, 0\.17\)/);
  assert.match(css.slice(0, markerAt), /:root\s*\{[^}]*--brand:\s*#1f5a45/s);
  assert.match(css.slice(0, markerAt), /:root\s*\{[^}]*--surface:\s*#1e2119/s);
});

test("研究表单、模型、文献、问题面板共用折射高光与水晶材质", () => {
  const surfaces = ruleBody(".crystal-forest :is(\n  .form-section,\n  .model-card,\n  .model-add-panel,\n  .paper-library,\n  .reader,\n  .evidence-rail,\n  .panel,\n  .paper-compare-panel,\n  .paper-evidence-card,\n  .research-card,\n  .research-result,\n  .q-header\n)");
  assert.match(surfaces, /background:\s*var\(--crystal-surface-bg\)/);
  assert.match(surfaces, /border-radius:\s*var\(--crystal-radius\)/);
  assert.match(surfaces, /box-shadow:[^;]*inset 0 1px 0 var\(--glass-highlight\)/);
  assert.match(surfaces, /backdrop-filter:\s*var\(--crystal-blur\)/);
  assert.match(ruleBody(".crystal-forest .entry-form"), /max-width:\s*920px/);
  assert.match(ruleBody(".crystal-forest .scope-choice:has(input:checked)"), /border-color:\s*var\(--brand\)/);
});

test("控件保留下拉箭头，聚焦使用松绿光圈，主操作使用薄荷渐变", () => {
  const controls = ruleBody(".crystal-forest input[type=\"text\"],\n.crystal-forest input[type=\"search\"],\n.crystal-forest input[type=\"number\"],\n.crystal-forest input[type=\"url\"],\n.crystal-forest input[type=\"password\"],\n.crystal-forest textarea,\n.crystal-forest select");
  assert.match(controls, /background-color:\s*var\(--forest-control\)/);
  assert.match(controls, /border-color:\s*var\(--glass-line-strong\)/);
  assert.doesNotMatch(controls, /(?:^|[;{])\s*background:/);
  const focus = ruleBody(".crystal-forest input[type=\"text\"]:focus-visible,\n.crystal-forest input[type=\"search\"]:focus-visible,\n.crystal-forest input[type=\"number\"]:focus-visible,\n.crystal-forest input[type=\"url\"]:focus-visible,\n.crystal-forest input[type=\"password\"]:focus-visible,\n.crystal-forest textarea:focus-visible,\n.crystal-forest select:focus-visible");
  assert.match(focus, /box-shadow:[^;]*0 0 0 3px var\(--glass-focus\)/);
  assert.match(ruleBody(".crystal-forest .btn-primary"), /background:\s*linear-gradient\(135deg, var\(--brand-deep\), var\(--brand\)\)/);
  assert.match(ruleBody(".crystal-forest .paper-tab.is-active"), /border-color:\s*var\(--brand\)/);
  assert.doesNotMatch(ruleBody(".crystal-forest .paper-tab.is-active"), /border-left|box-shadow:\s*inset/);
});

test("森林底图覆盖全部路由，首页透明度与桌面侧栏留白保持原契约", () => {
  assert.match(ruleBody(".crystal-forest[data-view]:not([data-view=\"projects\"]) .shell::before"), /opacity:\s*0\.28/);
  assert.match(ruleBody(".crystal-forest[data-view=\"projects\"]:has(.project-grid) .shell::before"), /opacity:\s*0\.46/);
  const desktop = mediaBody("(min-width: 1200px)");
  assert.match(desktop, /\.crystal-forest\[data-view\]:not\(\[data-view="projects"\]\) \.shell > \.content\s*\{[^}]*padding-left:\s*72px/s);
  assert.match(desktop, /\.crystal-forest\[data-view\]:not\(\[data-view="projects"\]\) \.shell > \.sidebar\s*\{[^}]*z-index:\s*2/s);
  assert.match(ruleBody(".crystal-forest .topbar"), /backdrop-filter:\s*var\(--crystal-blur\)/);
});

test("原版 PDF 只主题化外围框架，不增加画布滤镜或着色", () => {
  assert.match(ruleBody(".crystal-forest .paper-sheet.is-original"), /background:\s*var\(--forest-bg-deep\)/);
  assert.match(ruleBody(".crystal-forest .pdf-stage--embedded"), /radial-gradient[\s\S]*var\(--forest-bg-deep\)/);
  assert.match(ruleBody(".crystal-forest .reader-pdf-page"), /box-shadow:[^;]*0 0 0 1px var\(--glass-line\)/);
  assert.doesNotMatch(theme, /\.reader-pdf-canvas\s*\{[^}]*filter\s*:/s);
  assert.doesNotMatch(theme, /\.paper-sheet\.is-original\s*\{[^}]*filter\s*:/s);
});

test("弹窗、抽屉与轻提示延续同一材质，窄屏只收敛圆角和内边距", () => {
  const modal = ruleBody(".crystal-forest .modal,\n.crystal-forest .drawer");
  assert.match(modal, /background:\s*var\(--crystal-surface-bg\)/);
  assert.match(modal, /border-radius:\s*20px/);
  assert.match(modal, /backdrop-filter:\s*var\(--crystal-blur\)/);
  assert.match(ruleBody(".crystal-forest .toast:not(.toast-ok):not(.toast-bad)"), /border(?:-color)?:\s*(?:1px solid )?var\(--glass-line-strong\)/);
  const mobile = mediaBodies("(max-width: 767px)").join("\n");
  assert.match(mobile, /border-radius:\s*14px/);
  assert.match(mobile, /\.crystal-forest \.form-section,\s*\.crystal-forest \.evidence-rail,\s*\.crystal-forest \.q-header\s*\{[^}]*padding:\s*16px/s);
});

test("减少透明度、强制颜色与打印模式均有明确降级", () => {
  const reduced = mediaBody("(prefers-reduced-transparency: reduce)");
  assert.match(reduced, /background:\s*var\(--surface\)/);
  assert.match(reduced, /backdrop-filter:\s*none/);
  assert.match(reduced, /\.crystal-forest \.shell::before\s*\{\s*display:\s*none/);
  const forced = mediaBody("(forced-colors: active)");
  assert.match(forced, /background:\s*Canvas/);
  assert.match(forced, /border-color:\s*CanvasText/);
  assert.match(forced, /body\.crystal-forest::before,[\s\S]*?body\.crystal-forest::after\s*\{\s*display:\s*none/);
  const print = mediaBody("print");
  assert.match(print, /body\.crystal-forest\s*\{[^}]*background:\s*#fff/s);
  assert.match(print, /\.crystal-forest \.shell::before,[\s\S]*?body\.crystal-forest::after\s*\{\s*display:\s*none/);
  assert.match(print, /background:\s*#fff/s);
});

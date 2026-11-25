import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = "/* 森林科研皮肤：";
const theme = css.slice(css.indexOf(marker));

function ruleBody(source: string, selector: string): string {
  const escaped = selector
    .trim()
    .split(/\s*\n\s*/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  const match = matches.find((entry) => source[entry.index - 1] !== ",");
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
    if (end === -1) throw new Error(`媒体查询未闭合：${query}`);
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

test("森林装饰使用本地 SVG，且羽毛笔包含笔触、划痕与水晶切面", () => {
  const sprig = readFileSync(new URL("../web/assets/forest-sprig.svg", import.meta.url), "utf8");
  const quill = readFileSync(new URL("../web/assets/forest-quill.svg", import.meta.url), "utf8");
  assert.match(sprig, /<svg[^>]+viewBox="0 0 240 220"/);
  assert.match(quill, /<svg[^>]+viewBox="0 0 340 380"/);
  assert.match(quill, /id="feather"/);
  assert.match(quill, /id="shaft"/);
  assert.match(quill, /id="crystal"/);
  assert.match(quill, /stroke="#755b3d"/);
  assert.doesNotMatch(`${sprig}\n${quill}`, /<script|(?:href|src)=["']https?:/i);
});

test("左上与左下灌木固定为低对比背景，不拦截交互", () => {
  const corners = ruleBody(theme, "body::before,\nbody::after");
  assert.match(corners, /position:\s*fixed/);
  assert.match(corners, /mask-image:\s*url\("\.\/forest-sprig\.svg"\)/);
  assert.match(corners, /pointer-events:\s*none/);
  assert.match(corners, /user-select:\s*none/);
  assert.match(ruleBody(theme, "body::before"), /top:\s*-48px/);
  assert.match(ruleBody(theme, "body::before"), /transform:\s*scaleY\(-1\)/);
  assert.match(ruleBody(theme, "body::after"), /bottom:\s*-56px/);
});

test("工作台与纸张使用森林色、衬线标题和轻微纸张肌理", () => {
  assert.match(ruleBody(theme, "body"), /radial-gradient/);
  assert.match(ruleBody(theme, ".workbench-title .eyebrow"), /color:\s*var\(--brand\)/);
  assert.match(ruleBody(theme, ".workbench-title .eyebrow::before"), /border-radius:\s*100% 0 100% 0/);
  assert.match(ruleBody(theme, ".workbench-title h1,\n.empty--start h2"), /font-family:\s*var\(--font-read\)/);
  assert.match(ruleBody(theme, ".paper-sheet"), /background-image:\s*radial-gradient\(var\(--paper-grain\)/);
});

test("羽毛笔只占据空态右侧留白，窄屏降为淡化背景", () => {
  const empty = ruleBody(theme, ".empty--start");
  const quill = ruleBody(theme, ".empty--start::after");
  assert.match(empty, /padding-right:\s*310px/);
  assert.match(empty, /overflow:\s*hidden/);
  assert.match(quill, /background:\s*url\("\.\/forest-quill\.svg"\)/);
  assert.match(quill, /pointer-events:\s*none/);
  const mobile = mediaBody("(max-width: 767px)");
  assert.match(mobile, /\.empty--start\s*\{\s*padding:\s*24px/);
  assert.match(mobile, /\.empty--start::after\s*\{[^}]*opacity:\s*0\.2/);
});

test("空态与项目卡片共用透明水晶材质和玻璃控件", () => {
  const empty = ruleBody(theme, ".empty--start");
  assert.match(empty, /border-radius:\s*20px/);
  assert.match(empty, /radial-gradient\([^)]*#b7a6e8/);
  assert.match(empty, /linear-gradient\(135deg, var\(--glass-bg-strong\), var\(--glass-bg\)\)/);
  assert.match(empty, /box-shadow:\s*inset 0 1px 0 var\(--glass-highlight\)/);
  assert.match(empty, /backdrop-filter:\s*blur\(20px\) saturate\(145%\)/);
  const secondary = ruleBody(theme, ".empty--start .empty-actions .btn:not(.btn-primary)");
  assert.match(secondary, /background:\s*var\(--glass-control\)/);
  assert.match(secondary, /border-color:\s*var\(--glass-line\)/);
  const reduced = mediaBodies("(prefers-reduced-transparency: reduce)").join("\n");
  assert.match(reduced, /\.empty--start\s*\{\s*background:\s*var\(--surface\)/);
  assert.match(reduced, /\.empty--start \.empty-actions \.btn:not\(\.btn-primary\)\s*\{\s*background:\s*var\(--surface-2\)/);
  const forced = mediaBodies("(forced-colors: active)").join("\n");
  assert.match(forced, /\.empty--start\s*\{\s*border-color:\s*CanvasText/);
  const print = mediaBodies("print").join("\n");
  assert.match(print, /\.empty--start\s*\{\s*background:\s*#fff/);
});

test("有项目时才铺开连续森林书桌底图，卡片始终位于装饰上层", () => {
  const backdrop = readFileSync(new URL("../web/assets/forest-project-backdrop.webp", import.meta.url));
  assert.ok(backdrop.length > 10_000, "底图应保留足够细节");
  assert.deepEqual(backdrop.subarray(0, 4).toString("ascii"), "RIFF");
  assert.deepEqual(backdrop.subarray(8, 12).toString("ascii"), "WEBP");
  const layer = ruleBody(theme, ".shell:has(.project-grid)::before");
  assert.match(layer, /inset:\s*0;/);
  assert.match(layer, /background:\s*url\("\.\/forest-project-backdrop\.webp"\) center \/ cover no-repeat/);
  assert.match(layer, /opacity:\s*0\.46/);
  assert.match(layer, /mask-image:\s*linear-gradient/);
  assert.match(layer, /pointer-events:\s*none/);
  assert.match(ruleBody(theme, ".shell:has(.project-grid) > .content"), /z-index:\s*1/);
  const desktop = mediaBody("(min-width: 1200px)");
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{[^}]*z-index:\s*2/);
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{[^}]*linear-gradient\(90deg,[^}]*transparent\)/);
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.content\s*\{[^}]*padding-left:\s*72px/);
  const mobile = mediaBodies("(max-width: 767px)").join("\n");
  assert.match(mobile, /\.shell:has\(\.project-grid\)::before\s*\{[^}]*opacity:\s*0\.28/);
  const light = mediaBodies("(prefers-color-scheme: light)").join("\n");
  assert.match(light, /\.shell:has\(\.project-grid\)::before\s*\{[^}]*opacity:\s*0\.14/);
});

test("暗色、减少透明度、强制颜色与打印模式安全降级", () => {
  const dark = mediaBody("(prefers-color-scheme: dark)");
  assert.match(dark, /--botanical:\s*#8aab8d/);
  assert.match(dark, /--paper-grain:\s*rgba\(220, 238, 218, 0\.035\)/);
  const reduced = mediaBodies("(prefers-reduced-transparency: reduce)").join("\n");
  assert.match(reduced, /body::before,\s*body::after\s*\{\s*display:\s*none/);
  assert.match(reduced, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(reduced, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*var\(--bg\)/);
  const forced = mediaBodies("(forced-colors: active)").join("\n");
  assert.match(forced, /\.empty--start::after\s*\{\s*display:\s*none/);
  assert.match(forced, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(forced, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*Canvas/);
  const print = mediaBodies("print").join("\n");
  assert.match(print, /body::before,\s*body::after/);
  assert.match(print, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(print, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*#fff/);
});

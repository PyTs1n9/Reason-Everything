import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function ruleBody(selector: string): string {
  const escaped = selector
    .trim()
    .split(/\s*\n\s*/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  const match = matches.find((entry) => css[entry.index - 1] !== ",");
  assert.ok(match, `缺少规则 ${selector}`);
  return match[1];
}

function mediaBody(query: string): string {
  const blocks: string[] = [];
  let from = 0;
  while (from < css.length) {
    const at = css.indexOf(`@media ${query} {`, from);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    let depth = 1;
    let end = -1;
    for (let i = open + 1; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) throw new Error(`媒体查询未闭合：${query}`);
    blocks.push(css.slice(open + 1, end));
    from = end + 1;
  }
  assert.ok(blocks.length, `缺少媒体查询 ${query}`);
  return blocks.join("\n");
}

test("森林底图贯穿侧栏与主页，侧栏遮罩在右侧淡出", () => {
  const backdrop = readFileSync(new URL("../web/assets/forest-project-backdrop.webp", import.meta.url));
  assert.ok(backdrop.length > 10_000);
  assert.deepEqual(backdrop.subarray(0, 4).toString("ascii"), "RIFF");
  assert.deepEqual(backdrop.subarray(8, 12).toString("ascii"), "WEBP");
  const layer = ruleBody(".shell:has(.project-grid)::before");
  assert.match(layer, /inset:\s*0;/);
  assert.match(layer, /background:\s*url\("\.\/forest-project-backdrop\.webp"\) center \/ cover no-repeat/);
  assert.match(layer, /pointer-events:\s*none/);
  const desktop = mediaBody("(min-width: 1200px)");
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{[^}]*z-index:\s*2/);
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{[^}]*linear-gradient\(90deg,[^}]*transparent\)/);
  assert.match(desktop, /\.shell:has\(\.project-grid\) > \.content\s*\{[^}]*padding-left:\s*72px/);
});

test("树木与命中区右移到分界，卡片保留点击间隙", () => {
  const resizer = ruleBody(".shell.sidebar-tree-ready .sidebar-resizer");
  const tree = ruleBody(".shell.sidebar-tree-ready .sidebar-tree-image");
  const hitWidth = Number(resizer.match(/width:\s*(\d+)px/)?.[1]);
  const treeWidth = Number(ruleBody(".sidebar-tree-image").match(/width:\s*(\d+)px/)?.[1]);
  assert.match(resizer, /left:\s*calc\(var\(--sidebar-width\) - 72px\)/);
  assert.match(resizer, /right:\s*auto/);
  assert.equal(hitWidth, 136);
  assert.equal(treeWidth, 144);
  assert.match(tree, /right:\s*-4px/);
  assert.equal(treeWidth - hitWidth, 8);
});

test("窄屏抽屉与减少透明度、强制颜色和打印模式保持降级", () => {
  const narrow = mediaBody("(max-width: 1199px)");
  assert.match(narrow, /\.sidebar-resizer\s*\{\s*display:\s*none/);
  const reduced = mediaBody("(prefers-reduced-transparency: reduce)");
  assert.match(reduced, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(reduced, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*var\(--bg\)/);
  const forced = mediaBody("(forced-colors: active)");
  assert.match(forced, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(forced, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*Canvas/);
  const print = mediaBody("print");
  assert.match(print, /\.shell:has\(\.project-grid\)::before\s*\{\s*display:\s*none/);
  assert.match(print, /\.shell:has\(\.project-grid\) > \.sidebar\s*\{\s*background:\s*#fff/);
});

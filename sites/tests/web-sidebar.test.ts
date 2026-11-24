import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  parseSidebarWidth,
  sidebarWidthFromKey,
} from "../src/web/sidebar.ts";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const build = readFileSync(new URL("../scripts/build-web.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const marker = ".nav-btn {\n  flex: none;";
const sidebarCss = css.slice(css.indexOf(marker));

function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function mediaAfterMarker(query: string): string {
  const at = sidebarCss.indexOf(`@media ${query} {`);
  assert.notEqual(at, -1, `缺少媒体查询 ${query}`);
  const open = sidebarCss.indexOf("{", at);
  let depth = 1;
  for (let i = open + 1; i < sidebarCss.length; i += 1) {
    if (sidebarCss[i] === "{") depth += 1;
    if (sidebarCss[i] === "}") depth -= 1;
    if (depth === 0) return sidebarCss.slice(open + 1, i);
  }
  throw new Error(`媒体查询未闭合：${query}`);
}

test("侧栏宽度：默认值、取整、边界与非法数值", () => {
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 248);
  assert.equal(clampSidebarWidth(248.6), 249);
  assert.equal(clampSidebarWidth(-100), SIDEBAR_MIN_WIDTH);
  assert.equal(clampSidebarWidth(9999), SIDEBAR_MAX_WIDTH);
  assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY), SIDEBAR_DEFAULT_WIDTH);
});

test("侧栏宽度：本机存储值容错，空值与坏值回默认", () => {
  assert.equal(parseSidebarWidth(null), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseSidebarWidth(""), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseSidebarWidth("   "), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseSidebarWidth("320"), 320);
  assert.equal(parseSidebarWidth("100"), SIDEBAR_MIN_WIDTH);
  assert.equal(parseSidebarWidth("900"), SIDEBAR_MAX_WIDTH);
  assert.equal(parseSidebarWidth("248px"), SIDEBAR_DEFAULT_WIDTH);
});

test("侧栏键盘：左右键微调，Home/End 到边界，其余键不变", () => {
  assert.equal(sidebarWidthFromKey(248, "ArrowLeft"), 248 - SIDEBAR_KEYBOARD_STEP);
  assert.equal(sidebarWidthFromKey(248, "ArrowRight"), 248 + SIDEBAR_KEYBOARD_STEP);
  assert.equal(sidebarWidthFromKey(248, "Home"), SIDEBAR_MIN_WIDTH);
  assert.equal(sidebarWidthFromKey(248, "End"), SIDEBAR_MAX_WIDTH);
  assert.equal(sidebarWidthFromKey(248, "Enter"), 248);
  assert.equal(sidebarWidthFromKey(SIDEBAR_MIN_WIDTH, "ArrowLeft"), SIDEBAR_MIN_WIDTH);
  assert.equal(sidebarWidthFromKey(SIDEBAR_MAX_WIDTH, "ArrowRight"), SIDEBAR_MAX_WIDTH);
});

test("HTML：研究库按钮常显，分隔条、羽毛与透明 PNG 槽位具备无障碍语义", () => {
  const button = html.slice(html.indexOf('id="navBtn"'), html.indexOf("</button>", html.indexOf('id="navBtn"')));
  assert.doesNotMatch(button, /\shidden(?:\s|>)/);
  assert.match(button, /aria-controls="sidebar"/);
  assert.match(button, /aria-expanded="false"/);
  assert.match(button, /class="nav-btn-label"/);
  assert.match(html, /id="sidebarResizer"/);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-valuemin="208"/);
  assert.match(html, /aria-valuemax="420"/);
  assert.match(html, /class="sidebar-feather-mark" aria-hidden="true"/);
  assert.match(html, /class="sidebar-feather"[^>]*aria-hidden="true"/);
  assert.match(html, /class="sidebar-tree-image" data-src="\.\/assets\/sidebar-winding-tree\.png"/);
  assert.match(html, /class="sidebar-leaf-source" data-src="\.\/assets\/sidebar-leaf\.png"/);
  assert.match(html, /class="sidebar-feather-image" data-src="\.\/assets\/sidebar-feather\.png"/);
  assert.match(html, /id="sidebarLeafLayer" aria-hidden="true"/);
});

test("JS：桌面收起与窄屏抽屉分流，宽度和收起状态持久化", () => {
  assert.match(js, /matchMedia\("\(min-width: 1200px\)"\)/);
  assert.match(js, /SIDEBAR_COLLAPSED_KEY/);
  assert.match(js, /SIDEBAR_WIDTH_KEY/);
  assert.match(js, /shell\.classList\.toggle\("sidebar-collapsed", desktop && sidebarCollapsed\)/);
  assert.match(js, /localStorage\.setItem\(SIDEBAR_COLLAPSED_KEY, String\(sidebarCollapsed\)\)/);
  assert.match(js, /localStorage\.setItem\(SIDEBAR_WIDTH_KEY, String\(sidebarWidth\)\)/);
  assert.match(js, /aria-hidden", String\(!visible\)/);
  assert.match(js, /if \(event\.target\.closest\("a"\) && !desktopSidebarQuery\.matches\) closeNav\(true\)/);
  assert.match(js, /function syncSidebarViewport\(\)/);
  assert.match(js, /desktopSidebarQuery\.addEventListener\("change", syncSidebarViewport\)/);
  assert.match(js, /window\.addEventListener\("resize", syncSidebarViewport\)/);
});

test("JS：拖动捕获指针、忽略多点与副键，并支持键盘和 Escape", () => {
  assert.match(js, /resizePointerId !== null/);
  assert.match(js, /event\.pointerType === "mouse" && event\.button !== 0/);
  assert.match(js, /setPointerCapture\(event\.pointerId\)/);
  assert.match(js, /releasePointerCapture\(pointerId\)/);
  assert.match(js, /resizeStartWidth \+ event\.clientX - resizeStartX/);
  assert.match(js, /sidebarWidthFromKey\(sidebarWidth, event\.key\)/);
  assert.match(js, /event\.key !== "Escape"/);
  assert.match(js, /finishSidebarResize\(resizePointerId\)/);
});

test("PNG 素材：自动加载透明位图，拖动时从树梢生成少量落叶", () => {
  assert.match(js, /function loadSidebarArtwork\(image, onLoad\)/);
  assert.match(js, /image\.src = image\.dataset\.src/);
  assert.match(js, /shell\.classList\.add\("sidebar-tree-ready"\)/);
  assert.match(js, /shell\.classList\.add\("sidebar-feather-ready"\)/);
  assert.match(js, /function emitSidebarLeaves\(\)/);
  assert.match(js, /sidebarReducedMotionQuery\.matches/);
  assert.match(js, /sidebarLeafLayer\.childElementCount >= 12/);
  assert.match(js, /sidebarLeafSource\.cloneNode\(true\)/);
  assert.match(js, /--leaf-x/);
  assert.match(js, /--leaf-drift/);
  assert.match(js, /animationend/);
  assert.match(js, /emitSidebarLeaves\(\);/);
});

test("CSS：可变栏宽、收起归零、拖动把手与羽毛不拦截交互", () => {
  assert.match(ruleBody(css, ".shell"), /--sidebar-width:\s*248px/);
  assert.match(ruleBody(css, ".shell"), /grid-template-columns:\s*var\(--sidebar-width\) minmax\(0, 1fr\)/);
  assert.match(ruleBody(sidebarCss, ".shell.sidebar-collapsed"), /grid-template-columns:\s*0 minmax\(0, 1fr\)/);
  const collapsedSidebar = ruleBody(sidebarCss, ".shell.sidebar-collapsed .sidebar");
  assert.match(collapsedSidebar, /width:\s*0/);
  assert.match(collapsedSidebar, /padding-inline:\s*0/);
  assert.match(collapsedSidebar, /visibility:\s*hidden/);
  const resizer = ruleBody(sidebarCss, ".sidebar-resizer");
  assert.match(resizer, /cursor:\s*col-resize/);
  assert.match(resizer, /touch-action:\s*none/);
  assert.match(ruleBody(sidebarCss, ".sidebar-feather"), /pointer-events:\s*none/);
  assert.match(ruleBody(sidebarCss, ".sidebar-feather-mark"), /color:\s*var\(--brand\)/);
  assert.match(ruleBody(css, ".nav-btn"), /display:\s*inline-flex/);
  const treeAt = sidebarCss.lastIndexOf("\n.sidebar-tree-image {");
  assert.notEqual(treeAt, -1, "缺少独立树木位图规则");
  const treeOpen = sidebarCss.indexOf("{", treeAt);
  const treeClose = sidebarCss.indexOf("}", treeOpen);
  const treeImage = sidebarCss.slice(treeOpen + 1, treeClose);
  assert.match(ruleBody(sidebarCss, ".sidebar-tree-image"), /display:\s*none/);
  assert.match(treeImage, /width:\s*144px/);
  assert.match(treeImage, /object-fit:\s*cover/);
  assert.match(ruleBody(sidebarCss, ".shell.sidebar-tree-ready .sidebar-tree-image"), /display:\s*block/);
  assert.match(ruleBody(sidebarCss, ".sidebar-leaf-layer"), /pointer-events:\s*none/);
  assert.match(sidebarCss, /@keyframes sidebar-leaf-fall/);
  assert.match(sidebarCss, /animation:\s*sidebar-leaf-fall 1100ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
});

test("CSS：窄屏隐藏把手与按钮文字，减少动效和透明度偏好降级", () => {
  const narrow = mediaAfterMarker("(max-width: 1199px)");
  assert.match(narrow, /\.sidebar-resizer\s*\{\s*display:\s*none/);
  const mobile = mediaAfterMarker("(max-width: 767px)");
  assert.match(mobile, /\.nav-btn-label\s*\{\s*display:\s*none/);
  assert.match(mobile, /\.nav-btn\s*\{[^}]*width:\s*44px/);
  const reducedMotion = mediaAfterMarker("(prefers-reduced-motion: reduce)");
  assert.match(reducedMotion, /\.nav-btn(?:,\s*\.nav-btn:active)?\s*\{\s*transform:\s*none;\s*transition:\s*none/);
  assert.match(reducedMotion, /\.sidebar-leaf-layer\s*\{\s*display:\s*none/);
  assert.match(reducedMotion, /\.sidebar-falling-leaf\s*\{\s*animation:\s*none/);
  const reducedTransparency = mediaAfterMarker("(prefers-reduced-transparency: reduce)");
  assert.match(reducedTransparency, /\.sidebar-feather,\s*\.sidebar-feather-image\s*\{\s*display:\s*none/);
});

test("构建：侧栏纯函数进入浏览器构建清单", () => {
  assert.match(build, /"src\/web\/sidebar\.ts"/);
  assert.match(js, /from "\.\/gen\/src\/web\/sidebar\.js"/);
});

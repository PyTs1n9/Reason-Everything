import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

/** 取选择器规则体（这些规则内无嵌套花括号）；from 起检索以支持媒体查询块内的覆写。 */
function ruleBody(source: string, selector: string, from = 0): string {
  const at = source.indexOf(selector, from);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function px(body: string, prop: string): number {
  const match = body.match(new RegExp(`${prop}:\\s*(-?\\d+)(?:px)?`));
  assert.ok(match, `规则缺少 ${prop}`);
  return Number(match[1]);
}

test("返回链接吸顶：sticky 于顶栏下方 8px，胶囊底色防内容穿透", () => {
  const body = ruleBody(css, ".back-link--follow");
  assert.match(body, /position:\s*sticky/);
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /align-self:\s*flex-start/);
  const topbar = ruleBody(css, ".topbar");
  assert.equal(px(body, "top"), px(topbar, "height") + 8, "吸顶应避让顶栏 8px");
  assert.ok(px(body, "z-index") < px(topbar, "z-index"), "跟随层不得盖住顶栏");
});

test("跟随链接占位间距不变：负外边距抵消 .content 间距，仍距标题 6px", () => {
  const body = ruleBody(css, ".back-link--follow");
  const gap = px(ruleBody(css, ".content"), "gap");
  assert.equal(gap + px(body, "margin-bottom"), 6);
});

test("≤767px 断点：顶栏 56px 时吸顶 64px，间距仍 6px", () => {
  const mediaAt = css.indexOf("@media (max-width: 767px)");
  assert.notEqual(mediaAt, -1);
  const body = ruleBody(css, ".back-link--follow", mediaAt);
  const topbar = ruleBody(css, ".topbar", mediaAt);
  assert.equal(px(body, "top"), px(topbar, "height") + 8);
  const gap = px(ruleBody(css, ".content", mediaAt), "gap");
  assert.equal(gap + px(body, "margin-bottom"), 6);
});

test("项目页返回入口移到常驻顶栏，不再占据主内容单独一行", () => {
  assert.match(html, /id="topbarBack"/);
  assert.match(html, /class="topbar-back"[^>]*hidden/);
  assert.match(ruleBody(css, ".topbar-back[hidden]"), /display:\s*none/);
  assert.ok(js.includes('topbarBack.hidden = route.view !== "project";'));
  assert.match(js, /main\.append\(head,(?: renameRow,)? listHost\);/);
  assert.ok(!/main\.append\(backLink, head,(?: renameRow,)? listHost\);/.test(js));
  assert.ok(js.includes('class: "back-link back-link--follow", href: `#/project/${projectId}`, text: "← 返回项目"'));
  assert.ok(js.includes("main.append(backLink, head, form)"));
  const mobileAt = css.indexOf("@media (max-width: 767px)");
  assert.notEqual(mobileAt, -1);
  assert.match(ruleBody(css, ".topbar-back-full", mobileAt), /display:\s*none/);
  assert.match(ruleBody(css, ".topbar-back-short", mobileAt), /display:\s*inline/);
  const narrowAt = css.indexOf("@media (max-width: 360px)");
  assert.notEqual(narrowAt, -1);
  assert.equal(px(ruleBody(css, ".topbar-left", narrowAt), "gap"), 6);
});

test("全站顶栏统一为 56px，文章页不单独改变高度", () => {
  const topbarRules = [...css.matchAll(/\.topbar\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(topbarRules.length >= 2);
  for (const body of topbarRules) assert.equal(px(body, "height"), 56);
  assert.match(ruleBody(css, ".shell"), /min-height:\s*calc\(100vh - 56px\)/);
  assert.equal(px(ruleBody(css, ".back-link--follow"), "top"), 64);
});

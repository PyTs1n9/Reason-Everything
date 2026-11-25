import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function ruleBody(selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("全站下拉栏：共用圆角令牌、主题色与展开箭头", () => {
  assert.match(ruleBody(":root"), /--control-radius:\s*10px/);
  const controls = ruleBody("textarea,\nselect");
  assert.match(controls, /color:\s*var\(--ink\)/);
  assert.match(controls, /background:\s*var\(--surface\)/);
  assert.match(controls, /border:\s*1px solid var\(--line-strong\)/);
  assert.match(controls, /border-radius:\s*var\(--control-radius\)/);
  const select = ruleBody("select", css.indexOf("select {", css.indexOf("textarea {", css.indexOf("/* display:flex"))));
  assert.match(select, /appearance:\s*none/);
  assert.match(select, /background-image:[^;]*var\(--brand\)[^;]*var\(--brand\)/);
  assert.match(select, /background-repeat:\s*no-repeat/);
  assert.match(select, /padding:\s*8px 34px 8px 12px/);
  assert.match(ruleBody("textarea,\nselect"), /border-radius:\s*var\(--control-radius\)/);
  assert.match(ruleBody("input[type=\"text\"],\ninput[type=\"search\"],\ninput[type=\"number\"],\ninput[type=\"url\"],\ninput[type=\"password\"],\ntextarea"), /padding:\s*8px 11px/);
  assert.doesNotMatch(ruleBody("textarea,\nselect"), /appearance|background-image|cursor:\s*pointer/);
});

test("全站下拉栏：悬停、聚焦与禁用继承主题，不另设颜色或圆角", () => {
  const hover = ruleBody("select:hover:not(:disabled)");
  assert.match(hover, /border-color:\s*var\(--brand\)/);
  assert.match(hover, /background-color:\s*var\(--brand-soft\)/);
  const focus = ruleBody("select:focus-visible");
  assert.match(focus, /border-color:\s*var\(--brand\)/);
  assert.match(focus, /box-shadow:[^;]*var\(--brand-soft\)/);
  const controlsAt = css.indexOf("textarea,\nselect {");
  const disabledAt = css.indexOf("select:disabled {");
  const sharedFocusAt = css.indexOf("input[type=\"text\"]:focus-visible");
  const selectFocusAt = css.indexOf("select:focus-visible {", css.indexOf("select:focus-visible {", disabledAt) + 1);
  assert.ok(controlsAt < disabledAt && disabledAt < sharedFocusAt && sharedFocusAt < selectFocusAt);
  const selectFocus = ruleBody("select:focus-visible", selectFocusAt);
  assert.match(selectFocus, /color:\s*var\(--brand\)/);
  assert.match(selectFocus, /background-color:\s*var\(--surface\)/);
  const disabled = ruleBody("select:disabled");
  assert.match(disabled, /background-color:\s*var\(--surface-2\)/);
  assert.match(disabled, /cursor:\s*not-allowed/);
  assert.match(ruleBody(":root"), /--brand:\s*#1f5a45/);
  assert.match(ruleBody(":root"), /--brand-soft:\s*#e6efe8/);
  assert.doesNotMatch(disabled, /border-radius|background-image/);
});

test("紧凑下拉栏只改尺寸，不覆盖统一样式或遮挡箭头", () => {
  for (const selector of [".mapping-table select", ".q-meta select", ".reader-bar select"]) {
    const body = ruleBody(selector);
    assert.doesNotMatch(body, /border-radius|background-image|appearance|(?:^|[;{])\s*color|border:/);
    if (selector === ".reader-bar select") assert.match(body, /background-color:\s*var\(--surface\)/);
    assert.doesNotMatch(body, /padding:\s*\d/);
  }
  assert.match(ruleBody(".mapping-table select"), /padding-left:\s*30px/);
  assert.match(ruleBody(".q-meta select"), /padding-top:\s*4px/);
  assert.match(ruleBody(".reader-bar select"), /padding-bottom:\s*2px/);
  assert.match(ruleBody("body:has(.reader-layout) .reader-bar select"), /min-height:\s*28px/);
});

test("暗色主题提供下拉栏表面、边框与松绿强调色令牌", () => {
  const at = css.indexOf("@media (prefers-color-scheme: dark)");
  assert.notEqual(at, -1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const dark = css.slice(open + 1, close);
  assert.match(dark, /color-scheme:\s*dark/);
  assert.match(dark, /--surface:\s*#1e2119/);
  assert.match(dark, /--surface-2:\s*#24281f/);
  assert.match(dark, /--line-strong:\s*#414737/);
  assert.match(dark, /--brand:\s*#8ac7a6/);
  assert.match(dark, /--brand-soft:\s*#223029/);
});

test("全部原生下拉栏入口均由同一全局 select 规则覆盖", () => {
  const selectEntries = [...js.matchAll(/h\("select"/g)];
  assert.equal(selectEntries.length, 14);
  const selectDeclarations = [
    "newProjectType", "model-select-${service.id}", "paperPage", "accuracyUnit",
    "baselineRunId", "targetRunId", "selectId", "targetLr",
    "researchItemStatus", "researchResultConclusion", "paperEvidenceKind",
    "paperEvidencePaper", "scopeSelect", "versionSelect",
  ];
  for (const name of selectDeclarations) {
    assert.ok(selectEntries.some((entry) => {
      const declaration = js.slice(entry.index, js.indexOf(")", entry.index));
      return declaration.includes(name);
    }), `缺少下拉栏 ${name}`);
  }
  const declaredIds = [
    "newProjectType", "model-select-${service.id}", "paperPage", "unitId",
    "baselineId", "targetId", "selectId",
    "researchItemStatus", "researchResultConclusion", "paperEvidenceKind",
    "paperEvidencePaper", "scopeSelect", "versionSelect",
  ];
  for (const id of declaredIds) {
    assert.ok(js.includes(`id: ${id}`) || js.includes(`id: "${id}"`) || js.includes(`id: \`${id}\``), `缺少下拉栏 ID ${id}`);
  }
  assert.doesNotMatch(js, /style="[^"]*(?:border-radius|background|border)/);
  assert.ok(js.includes('const unitId = "unitSelect"'));
  assert.ok(js.includes('const selectId = "targetLrSelect"'));
  assert.match(ruleBody(".model-option"), /border-radius:\s*var\(--r-sm\)/);
});

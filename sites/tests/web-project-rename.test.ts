import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const projectView = js.slice(js.indexOf("async function renderProject("), js.indexOf("function sourceBadge("));

function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("项目页标题直接绑定项目名，独立改名按钮与改名行已移除", () => {
  assert.match(projectView, /id: "projectTitleInput",\s*class: "project-title-input",\s*value: project\.name/);
  assert.match(projectView, /"aria-label": "项目名称"/);
  assert.match(projectView, /"aria-describedby": "projectTitleError"/);
  assert.doesNotMatch(projectView, /renameProjectBtn|renameRow|renameInput|renameConfirm|renameCancel|新的项目名/);
  assert.match(projectView, /main\.append\((?:backLink, )?head, listHost\)/);
});

test("标题编辑支持 Enter 保存、失焦保存、Esc 取消，并避开中文输入法组词", () => {
  assert.match(projectView, /if \(event\.isComposing \|\| savingProjectName\) return;/);
  assert.match(projectView, /if \(event\.key === "Enter"\)\s*\{\s*event\.preventDefault\(\);\s*void saveProjectName\(\);/);
  assert.match(projectView, /else if \(event\.key === "Escape"\)\s*\{\s*event\.preventDefault\(\);\s*titleInput\.value = currentProjectName;\s*clearTitleError\(\);\s*titleInput\.blur\(\);/);
  assert.match(projectView, /titleInput\.addEventListener\("blur", \(\) => \{ void saveProjectName\(\); \}\);/);
});

test("保存去除首尾空白、防止重复提交，成功后刷新标题与侧栏", () => {
  assert.match(projectView, /const name = titleInput\.value\.trim\(\);/);
  assert.match(projectView, /if \(savingProjectName\) return;/);
  assert.match(projectView, /titleInput\.readOnly = true;/);
  assert.match(projectView, /titleInput\.setAttribute\("aria-busy", "true"\)/);
  assert.match(projectView, /await data\.renameProject\(ACTOR, projectId, name, new Date\(\)\.toISOString\(\)\)/);
  assert.match(projectView, /currentProjectName = updated\.name;/);
  assert.match(projectView, /toast\(`已重命名为「\$\{currentProjectName\}」`, "ok"\);/);
  assert.match(projectView, /await render\(\);/);
});

test("空名与保存失败均在标题下显示可访问错误，失败后恢复编辑", () => {
  assert.match(projectView, /showTitleError\("请填写项目名"\)/);
  assert.match(projectView, /titleInput\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(projectView, /titleError\.hidden = false;/);
  assert.match(projectView, /showTitleError\(`重命名失败：/);
  assert.match(projectView, /titleInput\.readOnly = false;/);
  assert.match(projectView, /titleInput\.removeAttribute\("aria-busy"\)/);
  assert.match(projectView, /titleInput\.focus\(\);/);
});

test("标题输入沿用标题排版与焦点样式，错误隐藏不被 display 覆盖", () => {
  const input = ruleBody("h1 .project-title-input");
  assert.match(input, /font:\s*inherit/);
  assert.match(input, /letter-spacing:\s*inherit/);
  assert.match(input, /background-image:\s*none/);
  assert.match(input, /cursor:\s*text/);
  assert.doesNotMatch(input, /font-size:/, "字号应由 h1 与响应式规则继续控制");
  assert.match(ruleBody("h1 .project-title-input:focus"), /box-shadow:\s*0 0 0 3px var\(--brand-soft\)/);
  assert.match(ruleBody('h1 .project-title-input[aria-invalid="true"]'), /border-color:\s*var\(--danger\)/);
  assert.match(ruleBody(".project-title-error[hidden]"), /display:\s*none/);
});

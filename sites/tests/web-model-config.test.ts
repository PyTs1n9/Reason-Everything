import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `缺少样式 ${selector}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

test("模型配置入口与只本地声明已接线", () => {
  assert.ok(js.includes('id: "modelConfigBtn"'));
  assert.ok(js.includes('location.hash = "#/models"'));
  assert.ok(js.includes('if (parts[0] === "models") return { view: "models" }'));
  assert.ok(js.includes("await renderModels()"));
  assert.ok(js.includes('void refreshAgent().catch((error) => console.info(`模型服务未启用：${error.message}`));'));
  assert.ok(js.includes("云端功能已停用"));
  assert.doesNotMatch(js, /createLiteratureClient|openFetchPaperModal|fetchPaperBtn|api\.crossref\.org/);
  assert.match(js, /modelConfigRequest\("POST", "\/models"/);
  assert.match(js, /modelConfigRequest\("DELETE"/);
});

test("服务卡片具备增删改、展开、显隐密钥、搜索、选择和数量状态", () => {
  for (const snippet of [
    'id: "addModelService"', 'id: "addModelServicePanel"', 'id: "addModelServiceForm"',
    '"aria-expanded": String(state.expanded)', 'keyInput.type = visible ? "password" : "text"',
    ': "搜索模型"', 'models.length} 个模型', 'value: service.model, text: service.model ? `当前：${service.model}` : "请选择模型"',
    'service.model ? "已选 1 个模型" : "0 个模型"', 'modelSelect.addEventListener("change"', 'role: "option"',
    'state.loading', 'state.error', 'state.searched', '尚未搜索模型', '模型列表为空',
    'async function persistService()', 'await persistService()', 'class: "model-delete-confirm"',
    'id: `confirm-delete-${service.id}`', 'id: `cancel-delete-${service.id}`',
  ]) assert.ok(js.includes(snippet), `缺少交互 ${snippet}`);
  assert.doesNotMatch(js, /window\.(?:prompt|confirm|alert)\(/);
  assert.doesNotMatch(js, /save\.click\(\)/);
  assert.doesNotMatch(js, /localStorage\.setItem\([^\n]*(apiKey|API_KEY)/i);
});

test("密码框与模型卡样式沿用现有令牌，隐藏状态不会被 display 覆盖", () => {
  assert.ok(css.includes('input[type="password"],'));
  assert.match(ruleBody(".model-details[hidden]"), /display:\s*none/);
  assert.match(ruleBody(".model-add-panel[hidden]"), /display:\s*none/);
  assert.match(ruleBody(".model-card-toggle"), /grid-template-columns/);
  assert.match(ruleBody(".model-key-row"), /display:\s*flex/);
  assert.ok(css.includes("@media (max-width: 767px)"));
  assert.doesNotMatch(ruleBody(".model-card {"), /#[0-9a-f]{6}/i);
});

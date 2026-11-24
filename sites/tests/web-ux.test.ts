import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { describeCellId, evaluateEntryMissing, humanizeCellIds } from "../src/web/model.ts";

const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const serve = readFileSync(new URL("../scripts/serve-web.mjs", import.meta.url), "utf8");

/** 取选择器规则体（这些规则内无嵌套花括号）。 */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

// ---------- cellId 可读化（纯函数） ----------

test("describeCellId：六段 cellId → 学习率/增强开·关；格式不符原样返回", () => {
  assert.equal(describeCellId("cell:p_demo:augmentation:accuracy:0.001:on"), "0.001/增强开");
  assert.equal(describeCellId("cell:p_demo:augmentation:accuracy:0.01:off"), "0.01/增强关");
  assert.equal(describeCellId("cell:only:three"), "cell:only:three");
  assert.equal(describeCellId("pair:p_demo:lr0.01"), "pair:p_demo:lr0.01");
  assert.equal(describeCellId("不是cellId"), "不是cellId");
});

test("humanizeCellIds：句内与 cell@ 前缀处的 cellId 全部替换；无匹配原样返回", () => {
  assert.equal(
    humanizeCellIds("cell:p_demo:augmentation:accuracy:0.001:on 未测，缺测值为 null"),
    "0.001/增强开 未测，缺测值为 null",
  );
  assert.equal(
    humanizeCellIds("cell@cell:p_demo:augmentation:accuracy:0.01:off：cell:p_demo:augmentation:accuracy:0.01:off 未测"),
    "cell@0.01/增强关：0.01/增强关 未测",
  );
  assert.equal(humanizeCellIds("目标与基准的 augmentation 相同，无法构成增强开/关对照"), "目标与基准的 augmentation 相同，无法构成增强开/关对照");
  assert.equal(humanizeCellIds("补跑 cell:p_v1:augmentation:accuracy:0.01:on"), "补跑 0.01/增强开");
});

// ---------- 表单：两组单选统一「无默认 + 必选表达」 ----------

test("表单接线：数据输入与问题范围均无默认选中；数据输入初始隐藏输入框", () => {
  assert.ok(!/name: "dataMode", value: "paste", checked/.test(js), "粘贴项不得默认选中");
  assert.ok(!/value: "target_lr", checked|value: "both_lrs", checked/.test(js), "范围项不得默认选中");
  assert.equal((js.match(/dataMode: "",/g) ?? []).length, 2, "dataMode 初始与 resetEntry 均为空串");
  assert.ok(js.includes('id: "pasteField", hidden: true'), "未选输入方式时粘贴框初始隐藏");
});

test("表单接线：两组均带「必选」徽标与空态提示，选中后提示收起", () => {
  assert.equal((js.match(/class: "req-badge", text: "必选"/g) ?? []).length, 2, "两组标题各一个必选徽标");
  assert.ok(js.includes('id: "dataModeHint" }, "请选择输入方式（二选一）"'));
  assert.ok(js.includes('id: "scopeHint" }, "请选择验证范围（二选一）"'));
  assert.ok(js.includes('getElementById("dataModeHint").hidden = true'));
  assert.ok(js.includes('getElementById("scopeHint").hidden = true'));
});

test("提交兜底：未选输入方式时在显示层补缺项；纯函数契约不变", () => {
  assert.ok(js.includes('missing.unshift("数据输入方式")'));
  // evaluateEntryMissing 契约仍不感知 UI 模式（原用例 web-model 继续覆盖）
  assert.deepEqual(
    evaluateEntryMissing({
      rawClaim: "主张",
      dataText: "csv",
      baselineRunId: "R01",
      targetRunId: "R02",
      scope: "both_lrs",
      targetLr: null,
    }),
    [],
  );
});

// ---------- 问题详情：标识符可读化 ----------

test("详情接线：问题编号缩短显示（完整编号留 title）；缺口与结论走可读标签", () => {
  assert.ok(js.includes("title: question.questionId"));
  assert.ok(js.includes("text: `问题编号 ${shortId(question.questionId)}`"));
  assert.ok(js.includes("text: humanizeCellIds(c)"), "当前缺口列表须可读化");
  assert.ok(js.includes("describeCellId(c.ruleId.slice(5))"), "cell@ 结论规则号须可读化");
  assert.ok(js.includes("humanizeCellIds(c.detail)"), "结论明细须可读化");
  assert.ok(js.includes("缺口：${humanizeCellIds(String(fact.value))}"), "证据条目 condition 须可读化");
  assert.ok(js.includes("humanizeCellIds(String(fact.value))"), "证据条目 action 须可读化");
  assert.ok((js.match(/同档另一格 \$\{describeCellId\(suggestion\.cellId\)\}/g) ?? []).length >= 2, "补跑建议两处 fallback 须可读化");
  assert.ok(js.includes("关联格 ${describeCellId(fact.cellId)}"), "证据说明关联格须可读化");
  assert.ok(js.includes("describeCellId,"), "study.js 须导入 describeCellId");
  assert.ok(js.includes("humanizeCellIds,"), "study.js 须导入 humanizeCellIds");
});

// ---------- AI 未接通与分析失败区分 ----------

test("状态区分：未接通为中性（步骤/提示），失败仍为红色；未接通时重试禁用", () => {
  assert.ok(js.includes('unavailable: "未接通"'), "步骤文案含未接通");
  assert.ok(js.includes("function modelStepState(events)"));
  assert.ok(js.includes('failed.summary.includes("模型服务不可用")'), "以工作流事件摘要区分未接通");
  assert.ok(js.includes('if (kind === "model" && state === "failed") state = modelStepState(stepEvents);'));
  assert.ok(js.includes('class: unavailable ? "notice" : "notice notice-error"'), "AI 未完成提示按状态分样式");
  assert.ok(js.includes('AI 未接通（模型服务未配置）'));
  assert.ok(js.includes("disabled: unavailable"), "未接通时重试按钮禁用");
  assert.ok(js.includes("模型服务未接通：需先在站点接入模型服务，重试才会生效。"));
  const stepUnavailable = ruleBody(css, ".step-unavailable {");
  assert.match(stepUnavailable, /color:\s*var\(--meta-ink\)/, "未接通步骤用中性色，不用红");
});

// ---------- CSS 与本地服务入口 ----------

test("CSS：必选徽标与空态提示成对存在，[hidden] 显式收起（防 display 覆盖）", () => {
  const badge = ruleBody(css, ".req-badge {");
  assert.match(badge, /border-radius:\s*999px/);
  assert.match(badge, /color:\s*var\(--amber\)/);
  const hint = ruleBody(css, ".choice-hint[hidden]");
  assert.match(hint, /display:\s*none/);
  // 本卡实测抓到的既有缺陷：.field 的 display:flex 让输入框无视 hidden 常显
  const fieldHidden = ruleBody(css, ".field[hidden]");
  assert.match(fieldHidden, /display:\s*none/);
});

test("项目卡片操作区：置顶、重命名和删除默认常显，不依赖悬停", () => {
  assert.match(ruleBody(css, ".card-actions {"), /opacity:\s*1/);
  assert.doesNotMatch(css, /\.card-actions\s*\{[^}]*opacity:\s*0/);
  assert.ok(js.includes('h("div", { class: "card-actions" }, pinBtn, renameBtn, deleteBtn)'));
});

test("本地服务：根路径 302 到 /web/index.html（相对资源不再 404）", () => {
  assert.ok(serve.includes('if (path === "/")'));
  assert.ok(serve.includes('res.writeHead(302, { location: "/web/index.html" })'));
});

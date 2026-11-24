import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildSaveModeInfo } from "../src/web/model.ts";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");

/** 取选择器规则体（这些规则内无嵌套花括号）。 */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(selector);
  assert.notEqual(at, -1, `缺少规则 ${selector}`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

test("弹层内容如实：存储方式/数据库/当前数据/云端未接入 + 同步边界说明", () => {
  const info = buildSaveModeInfo({
    adapterLabel: "本机保存",
    dbName: "agentflow-study",
    projectCount: 3,
    questionCount: 7,
  });
  assert.deepEqual(info.rows, [
    { label: "存储方式", value: "本机保存（IndexedDB）" },
    { label: "数据库", value: "agentflow-study" },
    { label: "当前数据", value: "3 个项目 · 7 个研究问题" },
    { label: "云端同步", value: "未接入" },
  ]);
  assert.match(info.note, /不跨设备同步/);
  assert.match(info.note, /清除浏览器站点数据/);
  assert.doesNotMatch(JSON.stringify(info), /已接入|已同步到云端/);
});

test("空库计数如实为 0，不省略行", () => {
  const info = buildSaveModeInfo({
    adapterLabel: "本机保存",
    dbName: "agentflow-study",
    projectCount: 0,
    questionCount: 0,
  });
  assert.equal(info.rows.find((row) => row.label === "当前数据")!.value, "0 个项目 · 0 个研究问题");
  assert.equal(info.rows.length, 4);
});

test("HTML 接线：保存模式为按钮，带 aria-expanded/aria-controls，弹层默认收起", () => {
  assert.match(html, /<button[\s\S]*?id="saveMode"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="saveModePop"/);
  assert.match(html, /id="saveModePop"[\s\S]*?role="note"[\s\S]*?hidden/);
});

test("JS 接线：标签取适配器常量；Escape 关闭并回焦、外部点击关闭、导航收起", () => {
  assert.ok(js.includes("saveModeBtn.textContent = LOCAL_STORAGE_LABEL"));
  // 切换开合
  assert.ok(js.includes("saveModeBtn.addEventListener(\"click\""));
  assert.ok(js.includes("if (saveModePop.hidden) void openSaveModePop();"));
  // Escape：关闭且回焦触发按钮（无障碍）
  assert.ok(js.includes("event.key === \"Escape\" && !saveModePop.hidden"));
  assert.ok(js.includes("closeSaveModePop(true)"));
  // 外部点击关闭（按钮与弹层本体点击不误关）
  assert.ok(js.includes("saveModeBtn.contains(event.target) || saveModePop.contains(event.target)"));
  // 路由渲染时收起（行尾不敏感）
  assert.ok(js.includes("closeNav();\r\n  closeSaveModePop();") || js.includes("closeNav();\n  closeSaveModePop();"));
  // 读取失败如实显示，不吞异常
  assert.ok(js.includes("读取失败："));
});

test("CSS：弹层绝对定位不越界、[hidden] 显式 display:none（防 display 覆盖）、指针与展开态", () => {
  const pop = ruleBody(css, ".save-mode-pop {");
  assert.match(pop, /position:\s*absolute/);
  assert.match(pop, /right:\s*0/);
  assert.match(pop, /width:\s*min\(320px,\s*calc\(100vw - 32px\)\)/, "弹层宽度须受视口约束");
  // 卡 15/16 同类教训：自定义 display 会覆盖 [hidden] 的 UA 样式
  const hidden = ruleBody(css, ".save-mode-pop[hidden]");
  assert.match(hidden, /display:\s*none/);
  const btn = ruleBody(css, ".save-mode {");
  assert.match(btn, /cursor:\s*pointer/);
  assert.ok(css.includes(".save-mode[aria-expanded=\"true\"]"));
});

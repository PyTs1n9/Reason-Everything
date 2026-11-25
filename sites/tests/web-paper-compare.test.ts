import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const study = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const questionView = study.slice(study.indexOf("async function renderQuestion("), study.indexOf("function sourceBadge("));

test("项目页列出多篇文献，添加 PDF 与阅读路由携带文献指纹", () => {
  assert.match(study, /async function renderProject\(projectId, page, cite, paperSha256 = null\)/);
  assert.match(study, /const papers = await data\.listPaperStudies\(ACTOR, projectId\)/);
  assert.match(study, /function renderPaperLibrary\(/);
  assert.match(study, /id: "addPaperPdf"/);
  assert.match(study, /bindPdfImport\(addButton, \{ projectId: project\.projectId, meta: null \}\)/);
  assert.match(study, /#\/project\/\$\{projectId\}\/paper\/\$\{paper\.sha256\}/);
  assert.match(study, /const jobKey = `\$\{projectId\}:\$\{paper\.sha256\}`/);
  assert.match(study, /paperJobs\.get\(jobKey\)/);
  assert.match(study, /paperJobs\.get\(`\$\{paper\.projectId\}:\$\{paper\.sha256\}`\)/);
});

test("项目名在主标题就地编辑，选中文献题名与文件信息保留为次要说明", () => {
  assert.match(study, /class: paper \? "project-paper-title"/);
  assert.match(study, /id: "projectTitleInput",\s*class: "project-title-input",\s*value: project\.name/);
  assert.match(study, /class: "project-paper-title-meta", text: `\$\{paper\.title\} · \$\{paper\.filename\} · \$\{paper\.pages\.length\} 页`/);
  assert.match(study, /const visiblePapers = papers\.filter\(\(paper\) => paper\.sha256 !== selectedSha256\)/);
  assert.match(study, /\.\.\.visiblePapers\.map\(\(paper\)/);
});

test("问题页不再提前退出，三类证据并排且空类别显示待补充", () => {
  assert.doesNotMatch(questionView, /if \(candidate\)\s*\{/);
  assert.match(questionView, /const papers = await data\.listPaperStudies\(ACTOR, question\.projectId\)/);
  assert.match(questionView, /const paperEvidence = await data\.listPaperEvidence\(ACTOR, questionId\)/);
  assert.match(questionView, /main\.append\(head, steps, paperPanel\)/);
  assert.match(study, /support: "支持证据"/);
  assert.match(study, /counterexample: "反例"/);
  assert.match(study, /condition: "适用条件"/);
  assert.match(study, /text: "待补充"/);
  assert.match(study, /id: "questionAddPaperPdf"/);
  assert.match(study, /returnQuestionId: question\.questionId/);
});

test("证据保存、编辑与解除关联走正式服务，跳转包含问题和文献身份", () => {
  assert.match(study, /data\.addPaperEvidence\(ACTOR/);
  assert.match(study, /data\.updatePaperEvidence\(ACTOR/);
  assert.match(study, /data\.removePaperEvidence\(ACTOR/);
  assert.match(study, /function paperEvidenceRef\(questionId, evidenceId\)/);
  assert.match(study, /projectPaperHash\(question\.projectId, paper, evidence\.page, paperEvidenceRef/);
  assert.match(study, /verifyPaperQuote\(selectedPaper\(\), Number\(page\.value\), quote\.value\)/);
  assert.match(study, /论文原文仍保留/);
});

test("桌面三列对照，窄屏顺序阅读且操作保持可达", () => {
  assert.match(css, /\.paper-compare-grid\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 980px\)\s*\{\s*\.paper-compare-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.paper-tabs\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.paper-evidence-actions \.btn\s*\{\s*min-height: 42px/);
  assert.match(css, /\.paper-evidence-card\s*\{[^}]*min-width: 0/s);
  assert.match(css, /\.paper-evidence-card \[hidden\]\s*\{\s*display: none/s);
});

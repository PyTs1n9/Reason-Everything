import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const study = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const serve = readFileSync(new URL("../scripts/serve-web.mjs", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-web.mjs", import.meta.url), "utf8");
const ocrApi = readFileSync(new URL("../src/web/paper-ocr-api.mjs", import.meta.url), "utf8");

test("PDF 导入保留原字节与逐页识别状态，扫描页必须先保存再可选 OCR", () => {
  assert.match(study, /pageSources:\s*pages\.map\(\(text\)\s*=>\s*text\.trim\(\)\s*\?\s*"text"\s*:\s*"pending"\)/);
  assert.match(study, /pageErrors:\s*pages\.map\(\(\)\s*=>\s*""\)/);
  assert.match(study, /pageRegions:\s*pages\.map\(\(\)\s*=>\s*\[\]\)/);
  assert.match(study, /openImportResultModal\(\{\s*file,\s*bytes:\s*new Uint8Array\(buffer\)/);
  assert.match(study, /const ocrOptIn = h\("input",\s*\{\s*type:\s*"checkbox"/);
  assert.doesNotMatch(study, /ocrOptIn[^\n]*checked:\s*true/);
  assert.match(study, /pagesNeedingOcr\(paper\)/);
  assert.match(study, /\.\.\.\(autoGenerate \? \[autoGenerate\.label\] : \[\]\),/);
  assert.match(study, /file:\s*options\.paperFile/);
});

test("OCR 作业按项目与文献指纹隔离，逐页落库成功或真实失败原因", () => {
  assert.match(study, /const jobKey = `\$\{projectId\}:\$\{sha256\}`/);
  assert.match(study, /paperOcrJobs\.get\(jobKey\)/);
  assert.match(study, /paperOcrJobs\.set\(jobKey, job\)/);
  assert.match(study, /const labels = \{[^}]*\};\s*const job = paperOcrJobs\.get/);
  assert.match(study, /requestPaperOcr\(readOcrRequest\(image\)\)/);
  assert.equal(study.match(/data\.updatePaperPageOcr\(ACTOR, \{/g)?.length, 2);
  assert.match(study, /update:\s*\{\s*page,\s*ok:\s*true,\s*text:\s*result\.text,\s*regions:\s*toPaperRegions\(result\)/);
  assert.match(study, /update:\s*\{\s*page,\s*ok:\s*false,\s*error:\s*error\.message \|\| String\(error\)/);
  assert.match(study, /识别全部待识别页/);
  assert.match(study, /逐页状态与单页重试/);
  assert.match(study, /source === "failed" \? "重试" : "识别"/);
});

test("旧项目补传同一 PDF 的入口保留原问题与候选，页面状态可读", () => {
  assert.match(study, /meta:\s*\{\s*sha256:\s*paper\.sha256,\s*title:\s*paper\.title\s*\}/);
  assert.match(study, /已有问题与引文不会丢失/);
  assert.match(study, /statusLabels\[paperPageSource\(paper, index\)\]/);
  assert.match(study, /这一页 OCR 失败/);
  assert.match(study, /尚未 OCR/);
  assert.match(study, /getPaperFile\(ACTOR, projectId, paper\.sha256\)/);
});

test("原版查看器复用 PDF.js、缩放与文字层或 OCR 区域高亮", () => {
  assert.match(study, /import \{ locateInRegions, locateInTextItems \} from "\.\/gen\/src\/web\/paper-locate\.js"/);
  assert.match(study, /data:\s*buffer\.slice\(0\)/);
  assert.match(study, /data:\s*bytes\.slice\(\)/);
  assert.match(study, /data:\s*file\.bytes\.slice\(\)/);
  assert.match(study, /class:\s*"modal modal--pdf"/);
  assert.match(study, /data:\s*file\.bytes/);
  assert.match(study, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(study, /locateInRegions\(paper\.pageRegions\[state\.page - 1\], state\.quote\)/);
  assert.match(study, /locateInTextItems\(content\.items, state\.quote, viewport\)/);
  assert.match(study, /left:\$\{rect\.x \* 100\}%/);
  assert.match(study, /sourceLink\.addEventListener\("click"/);
  assert.match(study, /openPdfViewer\(paper, file, evidence\.page, evidence\.quote, sourceLink\)/);
});

test("OCR 面板与原版查看器样式完整，窄屏仍保留逐页操作", () => {
  for (const selector of [".ocr-panel", ".ocr-page-row", ".status-badge.is-failed", ".modal--pdf", ".pdf-stage", ".pdf-page", ".pdf-highlights", ".pdf-highlight", ".pdf-precision", ".pdf-quote"]) {
    assert.ok(css.includes(selector), `缺少 ${selector}`);
  }
  assert.match(css, /\.pdf-highlights\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.pdf-highlight\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.ocr-page-row\s*\{/);
});

test("构建与服务端仅接本地 OCR，不保留外部上游或密钥配置", () => {
  assert.match(build, /"src\/web\/paper-locate\.ts"/);
  assert.match(build, /"src\/web\/paper-ocr\.ts"/);
  assert.match(serve, /handlePaperOcr/);
  assert.match(serve, /PAPER_OCR_PATH/);
  assert.match(serve, /localWindows:\s*process\.platform === "win32"/);
  assert.doesNotMatch(serve, /AGENTFLOW_PAPER_OCR_(?:URL|KEY|MODEL)/);
  assert.doesNotMatch(ocrApi, /config\.url|config\.key|complete = fetch|ocr\.example/);
  assert.doesNotMatch(study, /AGENTFLOW_PAPER_OCR_(?:URL|KEY|MODEL)/);
});

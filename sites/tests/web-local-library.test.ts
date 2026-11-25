import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const js = readFileSync(new URL("../web/assets/study.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/assets/study.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../scripts/serve-web.mjs", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-web.mjs", import.meta.url), "utf8");
const ignored = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");

function ruleBody(selector: string) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `缺少样式 ${selector}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

test("顶栏本机保存内含路径选择、原生浏览、现有 PDF 归档与取回入口", () => {
  assert.match(html, /id="saveMode"[\s\S]*?aria-controls="saveModePop"/);
  for (const snippet of [
    'createLocalLibraryClient', 'id: "localLibraryPath"', 'id: "localLibraryBrowse"',
    'id: "localLibraryForm"', 'submit.id = "localLibrarySave"', 'await localLibrary.select(pathInput.value)',
    'await archiveBrowserPdfs()', 'await localLibrary.readPaper(paper.sha256)',
    'await localLibrary.savePaper({ filename: file.name, sha256, bytes })',
    'PDF 原件存入 papers/，加密模型密钥存入 secrets/。',
  ]) assert.ok(js.includes(snippet), `缺少本地知识库接线 ${snippet}`);
  assert.doesNotMatch(js, /localStorage\.setItem\([^\n]*(libraryPath|localLibraryPath)/i);
  assert.doesNotMatch(js, /localStorage\.setItem\([^\n]*(apiKey|API_KEY)/i);
  assert.match(js, /local-library-paper" \},\s*h\("div", \{\},\s*h\("strong", \{ text: paper\.filename \}\)/);
});

test("模型页说明密钥跟随本地知识库目录，不宣称浏览器可读取明文", () => {
  assert.ok(js.includes('所选文件夹的 secrets/ 中'));
  assert.ok(js.includes('未选择时使用站点默认本机目录'));
  assert.ok(js.includes('密钥不会回传到浏览器'));
  assert.doesNotMatch(js, /localStorage\.setItem\([^\r\n]*(?:apiKey|API_KEY|modelKey)/i);
});

test("弹层受视口约束且路径表单、文献列表的隐藏与布局规则完整", () => {
  const pop = ruleBody(".save-mode-pop {");
  assert.match(pop, /width:\s*min\(400px,\s*calc\(100vw - 32px\)\)/);
  assert.match(pop, /max-height:\s*calc\(100dvh - 80px\)/);
  assert.match(pop, /overflow:\s*auto/);
  assert.match(ruleBody(".save-mode-pop[hidden]"), /display:\s*none/);
  assert.match(ruleBody(".local-library-form {"), /display:\s*grid/);
  assert.match(ruleBody(".local-library-form[hidden]"), /display:\s*none/);
  assert.match(ruleBody(".local-library-path-row {"), /grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(ruleBody(".local-library-papers {"), /max-height:\s*184px/);
});

test("本机服务注册知识库路由、复用动态模型服务并保护路径配置", () => {
  for (const snippet of [
    'createLocalLibraryService', 'handleLocalLibrary', 'LOCAL_LIBRARY_PATH',
    'validateCredentials', 'url.pathname.replace(/\\/+$/, "") === LOCAL_LIBRARY_PATH',
    'handleModelConfig(request, { token: localToken }, modelService)',
    'handlePaperModel(request, { token: localToken }, modelService)',
    'part === LOCAL_LIBRARY_SETTINGS_FILE', 'Buffer.from(await response.arrayBuffer())',
  ]) assert.ok(server.includes(snippet), `缺少服务接线 ${snippet}`);
  assert.ok(server.includes('createServer(async (req, res)'));
  assert.ok(server.includes('["127.0.0.1", "localhost", "::1"]'));
  assert.ok(build.includes('"src/web/local-library-client.ts"'));
  assert.ok(build.includes('"src/web/local-library-path.ts"'));
  assert.ok(ignored.includes(".agentflow-local-library.json"));
});

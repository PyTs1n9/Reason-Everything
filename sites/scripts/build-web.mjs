// Web 构建：用 Node 内置 stripTypeScriptTypes 把 src/ TS 剥成浏览器 JS，
// 并把 import 说明符 .ts → .js。产物在 web/assets/gen/（gitignore）。
// 与 tests/harness/build.mjs 同一条已验证的构建路径。
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sitesRoot = join(here, "..");
const outRoot = join(sitesRoot, "web", "assets", "gen");

const sources = [
  "src/core/grounding.ts",
  "src/core/json.ts",
  "src/experiment/types.ts",
  "src/experiment/runs.ts",
  "src/experiment/claim.ts",
  "src/experiment/import.ts",
  "src/experiment/evidence.ts",
  "src/experiment/revision.ts",
  "src/experiment/storage.ts",
  "src/experiment/storage-indexeddb.ts",
  "src/agent/prompts.ts",
  "src/agent/adapter.ts",
  "src/agent/facts.ts",
  "src/agent/validate.ts",
  "src/agent/service.ts",
  "src/workflow/service.ts",
  "src/web/model.ts",
  "src/web/literature.ts",
  "src/web/paper-locate.ts",
  "src/web/paper-ocr.ts",
  "src/web/paper-study.ts",
];

for (const rel of sources) {
  const code = readFileSync(join(sitesRoot, rel), "utf8");
  const stripped = stripTypeScriptTypes(code, { mode: "strip" });
  const js = stripped.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
  const dest = join(outRoot, rel.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  console.log(`built ${rel}`);
}
console.log(`web build done → ${outRoot}`);

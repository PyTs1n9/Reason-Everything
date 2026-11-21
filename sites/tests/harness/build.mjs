// 浏览器 harness 构建：用 Node 内置 stripTypeScriptTypes 把 TS 剥成 JS，
// 并把 import 说明符的 .ts 后缀改写为 .js。产物在 js/（已 gitignore）。
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sitesRoot = join(here, "..", "..");
const outRoot = join(here, "js");

const sources = [
  "src/experiment/types.ts",
  "src/experiment/runs.ts",
  "src/experiment/claim.ts",
  "src/experiment/import.ts",
  "src/experiment/evidence.ts",
  "src/experiment/revision.ts",
  "src/experiment/storage.ts",
  "src/experiment/storage-indexeddb.ts",
  "tests/fixtures/experiment-demo.ts",
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

const app = readFileSync(join(here, "app.js"), "utf8");
writeFileSync(join(outRoot, "app.js"), app);
console.log("built harness app.js");

// 离线测试入口：显式发现 tests/**/*.test.ts 交给 node --test。
// 空测试集（发现不到文件，或运行后 0 个用例）一律失败。
// 用法：node scripts/run-tests.mjs [rootDir]  （缺省 rootDir = sites/）
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.argv[2] ?? defaultRoot);
const testsDir = join(root, "tests");

function discover(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discover(full));
    else if (/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const files = discover(testsDir);
if (files.length === 0) {
  console.error(`[run-tests] 空测试集：在 ${testsDir} 未发现任何 *.test.ts，按约定失败。`);
  process.exit(1);
}
console.log(`[run-tests] 发现 ${files.length} 个测试文件（root=${root}）：`);
for (const file of files) console.log(`  - ${file.slice(root.length + 1)}`);

const result = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=spec", ...files],
  { cwd: root, encoding: "utf8" },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

const match = (result.stdout ?? "").match(/^ℹ tests (\d+)$/m);
const total = match ? Number(match[1]) : 0;
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (total === 0) {
  console.error("[run-tests] 空测试集：node --test 报告 0 个用例，按约定失败。");
  process.exit(1);
}
console.log(`[run-tests] 通过：${total} 个用例（${files.length} 个文件）。`);

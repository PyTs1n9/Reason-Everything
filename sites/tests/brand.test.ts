import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const currentBrand = "研论书屋";
const previousBrand = ["表里", "有据"].join("");
const textExtensions = new Set([".md", ".html", ".css", ".js", ".mjs", ".ts", ".json", ".svg", ".txt", ".yml", ".yaml", ".site"]);
const generatedPaths = new Set(["sites/web/assets/gen", "sites/tests/harness/js"]);

function collectTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const repoPath = relative(repoRoot, path).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === ".workbuddy" || entry.name === "node_modules" || generatedPaths.has(repoPath)) continue;
      files.push(...collectTextFiles(path));
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

test("页面标题与导航品牌统一为研论书屋", () => {
  const html = readFileSync(join(repoRoot, "sites/web/index.html"), "utf8");
  assert.ok(html.includes(`<title>${currentBrand}</title>`));
  assert.ok(html.includes(`<a class="brand" href="#/">${currentBrand}</a>`));
});

test("项目源码与文档不再使用旧品牌名称", () => {
  const offenders = collectTextFiles(repoRoot)
    .filter((path) => readFileSync(path, "utf8").includes(previousBrand))
    .map((path) => relative(repoRoot, path).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

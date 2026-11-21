import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonical,
  codePointSlice,
  contextFor,
  locate,
  normalized,
} from "../src/core/grounding.ts";

test("连字被 NFKC 展开", () => {
  assert.equal(canonical("artiﬁcial"), canonical("artificial"));
});

test("跨行断词与显式连字符等价", () => {
  assert.equal(canonical("foresee-\nable"), canonical("foresee-able"));
});

test("所有空白字符被移除", () => {
  assert.equal(canonical("alpha   beta\n gamma"), "alphabetagamma");
});

test("内容本身不被改动", () => {
  assert.notEqual(canonical("128 participants"), canonical("130 participants"));
});

test("跨行引文能定位，且偏移落在原文", () => {
  const page = "The effect was\nstatistically significant (p < 0.01).";
  const span = locate(page, "effect was statistically");
  assert.notEqual(span, null);
  const [start, end] = span!;
  assert.equal(page.slice(start, end), "effect was\nstatistically");
});

test("编造的引文被拒绝", () => {
  const page = "The effect was\nstatistically significant (p < 0.01).";
  assert.equal(locate(page, "The effect was practically significant"), null);
});

test("空白引文被拒绝", () => {
  assert.equal(locate("anything", "   "), null);
});

test("上下文保留原文版式", () => {
  const page = "x".repeat(800) + "The key sentence." + "y".repeat(800);
  const context = contextFor(page, "The key sentence.");
  assert.notEqual(context, null);
  assert.ok(context!.includes("The key sentence."));
  assert.ok(context!.includes("x"));
});

test("normalized 折叠空白但保留词边界", () => {
  assert.equal(normalized("a  b\nc"), "a b c");
});

// 以下为 JS 移植特有：Python 的 len/slice 按码点，JS 按 UTF-16 码元。
test("星平面字符的偏移按码点计算", () => {
  const page = "A😀B";
  const span = locate(page, "😀B");
  assert.deepEqual(span, [1, 3]);
  assert.equal(codePointSlice(page, 1, 3), "😀B");
});

test("Python 空白集合包含 NEL，不包含 BOM", () => {
  assert.equal(canonical("a\x85b"), "ab");
  assert.equal(normalized("a\x85b"), "a b");
  assert.equal(canonical("\ufeffa"), "\ufeffa");
});

test("不间断空格与全角空格按 Python 语义处理", () => {
  assert.equal(canonical("a\u00a0b\u2003c"), "abc");
  assert.equal(normalized("a\u00a0b\u2003c"), "a b c");
});

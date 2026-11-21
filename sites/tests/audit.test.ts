import assert from "node:assert/strict";
import { test } from "node:test";

import { PENDING, paragraphsFrom, review } from "../src/core/audit.ts";
import type { Paragraph, VerifiedCard } from "../src/core/types.ts";

const CARD: VerifiedCard = {
  card_id: "E1",
  page: 1,
  quote: "We recruited 128 participants aged between 20 and 34 years.",
  claim: "研究招募 128 名 20 至 34 岁参与者。",
  kind: "method",
  status: "verified",
  reason: null,
  context:
    "Methods. We recruited 128 participants aged between 20 and 34 years. All gave written consent.",
  anchor_id: "a_248f506e",
  char_span: [9, 68],
};

const PARAGRAPH: Paragraph = {
  id: "P01",
  text: "该研究招募了 128 名参与者，年龄在 20 到 34 岁之间。[E1]",
};

function report(claims: unknown[], paragraphId = "P01"): string {
  return JSON.stringify({ paragraphs: [{ id: paragraphId, claims }] });
}

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    article_excerpt: "该研究招募了 128 名参与者",
    status: "supported",
    evidence: [{ card_id: "E1", page: 1, quote: "We recruited 128 participants" }],
    reason: "对应原文",
    ...overrides,
  };
}

test("合法审计报告通过且摊平成论断", () => {
  const [claims, issues, summary] = review(report([claim()]), [PARAGRAPH], [CARD]);
  assert.deepEqual(issues, []);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0]!.cards, ["E1"]);
  assert.equal(summary.claims, 1);
  assert.equal(summary.cards_cited, 1);
});

test("编造的证据引文被拒绝", () => {
  const bad = claim({
    evidence: [{ card_id: "E1", page: 1, quote: "We recruited 130 participants" }],
  });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("逐字出现")), issues.join(" | "));
});

test("证据页码必须与卡片一致", () => {
  const bad = claim({
    evidence: [{ card_id: "E1", page: 2, quote: "We recruited 128 participants" }],
  });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("页码")), issues.join(" | "));
});

test("摘句必须来自该段落", () => {
  const bad = claim({ article_excerpt: "该研究招募了 130 名参与者" });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("不在该段落")), issues.join(" | "));
});

test("supported 但没有证据被拒绝", () => {
  const bad = claim({ evidence: [] });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("没有给出证据")), issues.join(" | "));
});

test("标为类比但摘句无类比标记被拒绝", () => {
  const bad = claim({ status: "illustration", evidence: [] });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("类比标记")), issues.join(" | "));
});

test("引用不存在的卡片被拒绝", () => {
  const bad = claim({
    evidence: [{ card_id: "E9", page: 1, quote: "We recruited 128 participants" }],
  });
  const [, issues] = review(report([bad]), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("不存在")), issues.join(" | "));
});

test("段落覆盖不完整被拒绝", () => {
  const [, issues] = review(report([claim()], "P02"), [PARAGRAPH], [CARD]);
  assert.ok(issues.some((item) => item.includes("段落覆盖不完整")), issues.join(" | "));
});

test("needs_qualification 是待办而不是错误", () => {
  const [claims, issues, summary] = review(
    report([claim({ status: "needs_qualification" })]),
    [PARAGRAPH],
    [CARD],
  );
  assert.deepEqual(issues, []);
  assert.ok(PENDING.has(claims[0]!.status));
  assert.equal(summary.by_status.needs_qualification, 1);
});

test("模型输出带代码围栏时仍可解析", () => {
  const wrapped = "```json\n" + report([claim()]) + "\n```";
  const [, issues] = review(wrapped, [PARAGRAPH], [CARD]);
  assert.deepEqual(issues, []);
});

test("切段跳过小标题并保持顺序", () => {
  const sections = { 研究问题: "第一段。", 方法与数据: "第二段。\n\n第三段。" };
  const paragraphs = paragraphsFrom(sections);
  assert.deepEqual(paragraphs.map((item) => item.id), ["P01", "P02", "P03"]);
  assert.equal(paragraphs[1]!.text, "第二段。");
});

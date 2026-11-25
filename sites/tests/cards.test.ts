import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_CARDS, makeAnchorId, parse, verify } from "../src/core/cards.ts";

const PAGE = "Methods. We recruited 128 participants aged between 20 and 34 years. All gave written consent.";

function payload(cards: unknown[]): string {
  return JSON.stringify({ cards });
}

const GOOD = {
  id: "E1",
  page: 1,
  quote: "We recruited 128 participants aged between 20 and 34 years.",
  claim: "研究招募 128 名 20 至 34 岁参与者。",
  kind: "method",
};

test("合法输出被解析为卡片", () => {
  const [cards, issues] = parse(payload([GOOD]));
  assert.deepEqual(issues, []);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.card_id, "E1");
  assert.equal(cards[0]!.kind, "method");
});

test("```json 围栏被容忍", () => {
  const [cards, issues] = parse("```json\n" + payload([GOOD]) + "\n```");
  assert.deepEqual(issues, []);
  assert.equal(cards.length, 1);
});

test("缺 quote / claim / page 的条目被跳过并记录原因", () => {
  const [cards, issues] = parse(
    payload([
      { ...GOOD, id: "E1", quote: "" },
      { ...GOOD, id: "E2", claim: "  " },
      { ...GOOD, id: "E3", page: "1" },
      GOOD,
    ]),
  );
  assert.equal(cards.length, 1);
  assert.equal(issues.length, 3);
  assert.ok(issues[0]!.includes("缺少 quote"));
  assert.ok(issues[1]!.includes("缺少 claim"));
  assert.ok(issues[2]!.includes("page 不是整数"));
});

test("重复卡片编号被重新编号", () => {
  const [cards] = parse(payload([{ ...GOOD, id: "E1" }, { ...GOOD, id: "E1" }]));
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0]!.card_id, cards[1]!.card_id);
});

test("claim 截断到 120 个码点", () => {
  const [cards] = parse(payload([{ ...GOOD, claim: "字".repeat(130) }]));
  assert.equal(Array.from(cards[0]!.claim).length, 120);
});

test("超过上限的卡片被截断并上报", () => {
  const many = Array.from({ length: MAX_CARDS + 5 }, (_, index) => ({
    ...GOOD,
    id: `E${index + 1}`,
    quote: `${GOOD.quote} #${index + 1}`,
  }));
  const [cards, issues] = parse(payload(many));
  assert.equal(cards.length, MAX_CARDS);
  assert.ok(issues.some((item) => item.includes("已截断")));
});

test("空卡片数组直接失败，不返回空结果", () => {
  assert.throws(() => parse(payload([])), /没有解析出任何证据卡/);
});

test("非 JSON 输出直接失败", () => {
  assert.throws(() => parse("模型今天不想说话"), /不是合法 JSON/);
});

test("字符串值内未转义的英文双引号按结构修复后解析", () => {
  const raw = '{"cards":[{"id":"E1","page":1,"quote":"We recruited 128 participants aged between 20 and 34 years.","claim":"作者说"结果显著"，需要复核。","kind":"method"}]}';
  const [cards, issues] = parse(raw);
  assert.deepEqual(issues, []);
  assert.equal(cards[0]!.claim, '作者说"结果显著"，需要复核。');
});

test("修复不了的残缺 JSON 仍然失败", () => {
  assert.throws(() => parse('{"cards":[{"id":"E1","claim":"未闭合'), /不是合法 JSON/);
});

test("能定位的摘句标记为 verified 并给出偏移与上下文", () => {
  const [cards] = parse(payload([GOOD]));
  const [verified, issues] = verify(cards, [PAGE], "p_test");
  assert.deepEqual(issues, []);
  assert.equal(verified[0]!.status, "verified");
  assert.deepEqual(verified[0]!.char_span, [9, 68]);
  assert.ok(verified[0]!.context!.includes("All gave written consent."));
});

test("编造的摘句标记为 unverified", () => {
  const [cards] = parse(payload([{ ...GOOD, quote: "We recruited 130 participants aged between 20 and 34 years." }]));
  const [verified, issues] = verify(cards, [PAGE], "p_test");
  assert.equal(verified[0]!.status, "unverified");
  assert.ok(verified[0]!.reason!.includes("未能在第 1 页定位"));
  assert.ok(issues[0]!.startsWith("E1："));
});

test("页码越界被拒绝", () => {
  const [cards] = parse(payload([{ ...GOOD, page: 2 }]));
  const [verified] = verify(cards, [PAGE], "p_test");
  assert.equal(verified[0]!.status, "unverified");
  assert.ok(verified[0]!.reason!.includes("超出范围"));
});

test("摘句过短不能作为证据", () => {
  const [cards] = parse(payload([{ ...GOOD, quote: "short" }]));
  const [verified] = verify(cards, [PAGE], "p_test");
  assert.equal(verified[0]!.status, "unverified");
  assert.ok(verified[0]!.reason!.includes("摘句过短"));
});

test("重复摘句只保留第一张", () => {
  const [cards] = parse(payload([
    { ...GOOD, id: "E1" },
    { ...GOOD, id: "E2", quote: "We recruited 128 participants aged between 20 and 34 years.  " },
  ]));
  const [verified] = verify(cards, [PAGE], "p_test");
  assert.equal(verified[0]!.status, "verified");
  assert.equal(verified[1]!.status, "unverified");
  assert.ok(verified[1]!.reason!.includes("重复"));
});

// 该值与 Python 版 make_anchor_id 的输出一致，哈希口径变化会让它失败。
test("anchor_id 与 Python 黄金实现一致", () => {
  assert.equal(
    makeAnchorId("p_0123456789", 3, "We recruited 128 participants aged between 20 and 34 years."),
    "a_248f506e",
  );
});

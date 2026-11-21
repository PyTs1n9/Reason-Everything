/**
 * 证据卡：抽取结果的结构校验与逐字回查。
 *
 * 这里是整条链的地基。模型说什么不重要，重要的是 quote 能不能在这一页的原文里
 * 被机械地定位到。定位不到就标记 unverified，并且不进入写作阶段。
 *
 * 移植自 app/cards.py。anchor_id 的哈希输入与 Python 版逐字节一致：
 * `${paper_id}|${page}|${canonical(quote)}` 的 UTF-8 字节的 SHA-256 前 8 位。
 */

import { createHash } from "node:crypto";

import { canonical, codePointLength, contextFor, locate, normalized, pySplit, pyStrip } from "./grounding.ts";
import { isRecord, loadJson } from "./json.ts";
import type { CardKind, ParsedCard, VerifiedCard } from "./types.ts";

export const CARD_KINDS: ReadonlySet<string> = new Set<CardKind>([
  "background",
  "method",
  "result",
  "number",
  "limitation",
  "definition",
]);

export const MAX_CARDS = 24;
export const MIN_QUOTE = 10;

/** 锚点编号由位置与摘句内容决定，同一段原文永远得到同一个编号。 */
export function makeAnchorId(paperId: string, page: number, quote: string): string {
  const seed = `${paperId}|${page}|${canonical(quote)}`;
  return "a_" + createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 8);
}

/** 把模型输出变成卡片列表；结构问题作为 issues 返回，不静默丢弃。 */
export function parse(raw: string): [ParsedCard[], string[]] {
  const data = loadJson(raw, "抽取结果");
  if (!isRecord(data) || !Array.isArray(data.cards)) {
    throw new Error("抽取结果缺少 cards 数组");
  }

  const cards: ParsedCard[] = [];
  const issues: string[] = [];
  const seenIds = new Set<string>();

  data.cards.forEach((item, offset) => {
    const position = offset + 1;
    if (!isRecord(item)) {
      issues.push(`第 ${position} 项不是对象，已跳过`);
      return;
    }
    const quote = item.quote;
    const claim = item.claim;
    const page = item.page;
    const kind = item.kind;
    if (typeof quote !== "string" || !pyStrip(quote)) {
      issues.push(`第 ${position} 项缺少 quote，已跳过`);
      return;
    }
    if (typeof claim !== "string" || !pyStrip(claim)) {
      issues.push(`第 ${position} 项缺少 claim，已跳过`);
      return;
    }
    if (typeof page !== "number" || !Number.isInteger(page)) {
      issues.push(`第 ${position} 项 page 不是整数，已跳过`);
      return;
    }
    let cardId = String(item.id || `E${position}`).trim();
    if (!cardId || seenIds.has(cardId)) {
      cardId = `E${cards.length + 1}`;
    }
    seenIds.add(cardId);
    cards.push({
      card_id: cardId,
      page,
      quote: pySplit(quote).join(" "),
      claim: Array.from(pySplit(claim).join(" ")).slice(0, 120).join(""),
      kind: (typeof kind === "string" && CARD_KINDS.has(kind) ? kind : "background") as CardKind,
    });
  });

  let kept = cards;
  if (kept.length > MAX_CARDS) {
    issues.push(`卡片超过 ${MAX_CARDS} 张，已截断`);
    kept = kept.slice(0, MAX_CARDS);
  }
  if (kept.length === 0) throw new Error("没有解析出任何证据卡");
  return [kept, issues];
}

/** 逐张回查：页码是否存在、摘句能否在该页定位。定位成功即产出锚点。 */
export function verify(
  cards: ParsedCard[],
  pages: string[],
  paperId = "",
): [VerifiedCard[], string[]] {
  const verified: VerifiedCard[] = [];
  const issues: string[] = [];
  const seenQuotes = new Set<string>();

  for (const card of cards) {
    const page = card.page;
    const current: VerifiedCard = {
      ...card,
      status: "unverified",
      reason: null,
      context: null,
      anchor_id: makeAnchorId(paperId, page, card.quote),
      char_span: null,
    };

    if (page < 1 || page > pages.length) {
      current.reason = `页码 ${page} 超出范围（共 ${pages.length} 页）`;
      issues.push(`${current.card_id}：${current.reason}`);
      verified.push(current);
      continue;
    }
    const text = pages[page - 1] ?? "";
    if (!pyStrip(text)) {
      current.reason = `第 ${page} 页没有可提取文字`;
      issues.push(`${current.card_id}：${current.reason}`);
      verified.push(current);
      continue;
    }
    if (codePointLength(current.quote) < MIN_QUOTE) {
      current.reason = `摘句过短（少于 ${MIN_QUOTE} 字符），无法作为证据`;
      issues.push(`${current.card_id}：${current.reason}`);
      verified.push(current);
      continue;
    }
    const fold = normalized(current.quote);
    if (seenQuotes.has(fold)) {
      current.reason = "与其他卡片摘句重复，已合并";
      issues.push(`${current.card_id}：${current.reason}`);
      verified.push(current);
      continue;
    }
    const span = locate(text, current.quote);
    if (span === null) {
      current.reason = `摘句未能在第 ${page} 页定位（可能被改写或页码错误）`;
      issues.push(`${current.card_id}：${current.reason}`);
    } else {
      current.status = "verified";
      current.context = contextFor(text, current.quote);
      current.char_span = span;
      seenQuotes.add(fold);
    }
    verified.push(current);
  }

  return [verified, issues];
}

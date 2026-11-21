/**
 * 论断审计：把「这段话说得有道理」换成「这条论断引用了哪张卡、引文是否逐字对得上」。
 *
 * 协议移植自 app/audit.py：段落必须全覆盖，摘句必须原样出现在段内，
 * 证据必须能回引到卡片上下文。
 */

import { canonical, PY_SPACE_SOURCE, pyStrip } from "./grounding.ts";
import { isRecord, loadJson } from "./json.ts";
import type { ClaimRecord, ClaimStatus, Paragraph, ReviewSummary, VerifiedCard } from "./types.ts";

export const STATUS: ReadonlySet<string> = new Set<ClaimStatus>([
  "supported",
  "needs_qualification",
  "insufficient_evidence",
  "illustration",
]);

export const PENDING: ReadonlySet<ClaimStatus> = new Set<ClaimStatus>([
  "needs_qualification",
  "insufficient_evidence",
]);

export const ILLUSTRATION_MARKERS = [
  "例如",
  "假设",
  "比作",
  "可以把",
  "可把",
  "设想",
  "类比",
  "自拟",
  "示意",
  "这像",
] as const;

const BLANK_LINE = new RegExp(`\\n${PY_SPACE_SOURCE}*\\n`);

/** 按空行切段，跳过小标题，给每段一个稳定编号。 */
export function paragraphsFrom(sections: Record<string, string>): Paragraph[] {
  const result: Paragraph[] = [];
  for (const content of Object.values(sections)) {
    const prose = content
      .split("\n")
      .filter((line) => !/^#{1,6}/.test(line.trimStart()))
      .join("\n");
    for (const block of prose.split(BLANK_LINE)) {
      const text = pyStrip(block);
      if (!text) continue;
      result.push({ id: `P${String(result.length + 1).padStart(2, "0")}`, text });
    }
  }
  return result;
}

/**
 * 校验审计结果并摊平成论断列表。
 * 返回 [claims, issues, summary]，与 Python 版的三元组一一对应。
 */
export function review(
  raw: string,
  paragraphs: Paragraph[],
  cards: VerifiedCard[],
): [ClaimRecord[], string[], ReviewSummary] {
  const data = loadJson(raw, "审计结果");
  if (!isRecord(data) || !Array.isArray(data.paragraphs)) {
    throw new Error("审计结果缺少 paragraphs 数组");
  }

  const expected = new Map<string, string>(paragraphs.map((item) => [item.id, item.text]));
  const byCard = new Map<string, VerifiedCard>(
    cards.filter((card) => card.status === "verified").map((card) => [card.card_id, card]),
  );
  const issues: string[] = [];
  const claims: ClaimRecord[] = [];

  const seen = data.paragraphs.filter(isRecord).map((entry) => String(entry.id ?? ""));
  const seenSet = new Set(seen);
  if (
    data.paragraphs.length !== expected.size ||
    seenSet.size !== expected.size ||
    [...seenSet].some((id) => !expected.has(id)) ||
    seen.length !== seenSet.size
  ) {
    issues.push("段落覆盖不完整：审计结果的段落编号与待核查段落不一致");
  }

  for (const entry of data.paragraphs) {
    if (!isRecord(entry)) {
      issues.push("审计结果中存在非对象段落");
      continue;
    }
    const pid = String(entry.id ?? "");
    if (!expected.has(pid)) {
      issues.push(`${pid}：未知段落编号`);
      continue;
    }
    const paragraphClaims = entry.claims;
    if (!Array.isArray(paragraphClaims)) {
      issues.push(`${pid}：claims 不是数组`);
      continue;
    }
    if (paragraphClaims.length === 0 && !pyStrip(String(entry.no_factual_claim_reason ?? ""))) {
      issues.push(`${pid}：claims 为空但未说明原因`);
    }

    paragraphClaims.forEach((claim, offset) => {
      const label = `${pid}/C${offset + 1}`;
      if (!isRecord(claim)) {
        issues.push(`${label}：不是对象`);
        return;
      }
      const excerpt = claim.article_excerpt;
      if (typeof excerpt !== "string" || !pyStrip(excerpt)) {
        issues.push(`${label}：缺少 article_excerpt`);
        return;
      }
      const paragraphText = expected.get(pid) ?? "";
      if (!paragraphText.includes(excerpt)) {
        issues.push(`${label}：摘句不在该段落原文中`);
      }
      const status = claim.status;
      if (typeof status !== "string" || !STATUS.has(status)) {
        issues.push(`${label}：status 非法（${status}）`);
        return;
      }

      let refs: unknown[] = [];
      const rawRefs = claim.evidence;
      if (Array.isArray(rawRefs)) {
        refs = rawRefs;
      } else if (rawRefs) {
        issues.push(`${label}：evidence 不是数组`);
      }

      if (status === "supported" && refs.length === 0) {
        issues.push(`${label}：supported 但没有给出证据`);
      }
      if (
        status === "illustration" &&
        !ILLUSTRATION_MARKERS.some((marker) => excerpt.includes(marker))
      ) {
        issues.push(`${label}：标为类比但摘句中没有类比标记`);
      }

      const cardIds: string[] = [];
      for (const ref of refs) {
        if (!isRecord(ref)) {
          issues.push(`${label}：证据引用不是对象`);
          continue;
        }
        const card = byCard.get(String(ref.card_id || ""));
        if (card === undefined) {
          issues.push(`${label}：引用了不存在或未通过回查的卡片 ${ref.card_id}`);
          continue;
        }
        const quote = ref.quote;
        if (typeof quote !== "string" || !pyStrip(quote)) {
          issues.push(`${label}：证据缺少 quote`);
          continue;
        }
        if (ref.page !== card.page) {
          issues.push(`${label}：证据页码与卡片不一致`);
          continue;
        }
        if (!canonical(card.context || card.quote).includes(canonical(quote))) {
          issues.push(`${label}：证据引文未在卡片上下文中逐字出现`);
          continue;
        }
        cardIds.push(card.card_id);
      }

      claims.push({
        paragraph_id: pid,
        excerpt,
        status: status as ClaimStatus,
        reason: pyStrip(String(claim.reason ?? "")),
        cards: [...new Set(cardIds)].sort(),
      });
    });
  }

  const counts: Record<ClaimStatus, number> = {
    supported: 0,
    needs_qualification: 0,
    insufficient_evidence: 0,
    illustration: 0,
  };
  for (const claim of claims) counts[claim.status] += 1;

  const cited = new Set(claims.flatMap((claim) => claim.cards));
  const verifiedIds = new Set(byCard.keys());
  const summary: ReviewSummary = {
    claims: claims.length,
    by_status: counts,
    cards_cited: [...cited].filter((id) => verifiedIds.has(id)).length,
    cards_verified: verifiedIds.size,
    cards_unused: [...verifiedIds].filter((id) => !cited.has(id)).sort(),
  };
  return [claims, issues, summary];
}

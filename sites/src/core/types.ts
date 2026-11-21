/**
 * 跨层共用的数据形状。
 *
 * 命名与 Python 版保持一致（snake_case），原因只有一个：
 * 两边要能被同一个差分测试逐字段比对，字段名不一致会让比对失去意义。
 */

export type CardKind =
  | "background"
  | "method"
  | "result"
  | "number"
  | "limitation"
  | "definition";

export type ClaimStatus =
  | "supported"
  | "needs_qualification"
  | "insufficient_evidence"
  | "illustration";

/** 抽取阶段的卡片：只有模型给出的四个字段，尚未回查。 */
export interface ParsedCard {
  card_id: string;
  page: number;
  quote: string;
  claim: string;
  kind: CardKind;
}

/** 回查之后的卡片：定位成功才有 char_span 与 context。 */
export interface VerifiedCard extends ParsedCard {
  status: "verified" | "unverified";
  reason: string | null;
  context: string | null;
  anchor_id: string;
  char_span: [number, number] | null;
}

export interface Paragraph {
  id: string;
  text: string;
}

/** 审计摊平后的单条论断。 */
export interface ClaimRecord {
  paragraph_id: string;
  excerpt: string;
  status: ClaimStatus;
  reason: string;
  cards: string[];
}

export interface ReviewSummary {
  claims: number;
  by_status: Record<ClaimStatus, number>;
  cards_cited: number;
  cards_verified: number;
  cards_unused: string[];
}

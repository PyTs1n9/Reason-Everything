/* AgentFlow 核心层（浏览器版）——逐行移植自 sites/src/core（TypeScript），
   再向上对齐 app/*.py 黄金实现。两处 Python 语义必须显式还原，否则会静默漂移：
   1. Python 按 Unicode 码点遍历与切片，JS 按 UTF-16 码元；统一用码点下标，
      切片走 Array.from。
   2. Python str.isspace() 与 JS \s 的字符集不同（前者含 \x1c-\x1f 与 \x85，
      后者含 ﻿）。空白判定按 Python 集合实现。
   anchor_id 的哈希输入与 Python 版一致：
   `${paper_id}|${page}|${canonical(quote)}` 的 UTF-8 字节 SHA-256 前 8 位；
   浏览器无 node:crypto，改用 crypto.subtle 异步实现（同输入同截断）。 */

/* ---------------- grounding ---------------- */

const SOFT_HYPHEN = "\u00ad";

const PY_SPACE_CLASS =
  "\\x20\\t\\n\\v\\f\\r\\x1c-\\x1f\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

export const PY_SPACE_SOURCE = `[${PY_SPACE_CLASS}]`;

const PY_SPACE_ONE = new RegExp(PY_SPACE_SOURCE);
const PY_SPACE_RUN = new RegExp(`${PY_SPACE_SOURCE}+`);
const PY_SPACE_TRIM = new RegExp(`^${PY_SPACE_SOURCE}+|${PY_SPACE_SOURCE}+$`, "g");

function isPySpace(char) {
  return PY_SPACE_ONE.test(char);
}

function pySplit(text) {
  return text.split(PY_SPACE_RUN).filter((part) => part.length > 0);
}

export function pyStrip(text) {
  return text.replace(PY_SPACE_TRIM, "");
}

function codePointLength(text) {
  return Array.from(text).length;
}

function codePointSlice(text, start, end) {
  return Array.from(text).slice(start, end).join("");
}

export function normalized(text) {
  return pySplit(text.split(SOFT_HYPHEN).join("")).join(" ");
}

function canonicalize(text) {
  const chars = [];
  const index = [];
  Array.from(text).forEach((char, position) => {
    if (char === SOFT_HYPHEN || isPySpace(char)) return;
    for (const folded of Array.from(char.normalize("NFKC"))) {
      if (isPySpace(folded)) continue;
      chars.push(folded);
      index.push(position);
    }
  });
  return { text: chars.join(""), chars, index };
}

export function canonical(text) {
  return canonicalize(text).text;
}

export function locate(pageText, quote) {
  if (!pyStrip(quote)) return null;
  const haystack = canonicalize(pageText);
  const needle = canonicalize(quote);
  if (needle.chars.length === 0) return null;
  const atUtf16 = haystack.text.indexOf(needle.text);
  if (atUtf16 < 0) return null;
  const at = codePointLength(haystack.text.slice(0, atUtf16));
  const last = at + needle.chars.length - 1;
  const start = haystack.index[at];
  const end = haystack.index[last];
  if (start === undefined || end === undefined) return null;
  return [start, end + 1];
}

function windowOf(pageText, start, end, radius = 700) {
  const points = Array.from(pageText);
  const left = Math.max(0, start - radius);
  const right = Math.min(points.length, end + radius);
  return normalized(points.slice(left, right).join(""));
}

export function contextFor(pageText, quote, radius = 700) {
  const span = locate(pageText, quote);
  if (span === null) return null;
  return windowOf(pageText, span[0], span[1], radius);
}

export { codePointLength as codePointLen, codePointSlice };

/* ---------------- cards ---------------- */

export const CARD_KINDS = new Set([
  "background", "method", "result", "number", "limitation", "definition",
]);

export const MAX_CARDS = 24;
export const MIN_QUOTE = 10;

export async function makeAnchorId(paperId, page, quote) {
  const seed = `${paperId}|${page}|${canonical(quote)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return "a_" + hex.slice(0, 8);
}

/** 模型偶发把英文双引号直接写进字符串值（如 中文"引号"），JSON.parse 会断在
 * 处。按结构逐字符重写：字符串内的裸引号，只有后继非空白字符不是 : , } ] 或结束
 * 时才判为值内引号并转义；转不出合法 JSON 时上层仍如实失败。 */
function repairUnescapedQuotes(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString && char === "\\") {
      out += char + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === '"') {
      if (!inString) {
        inString = true;
        out += char;
        continue;
      }
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      const ahead = text[next];
      if (ahead === undefined || ahead === ":" || ahead === "," || ahead === "}" || ahead === "]") {
        inString = false;
        out += char;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += char;
  }
  return out;
}

function loadJson(raw, label) {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`${label}不是合法 JSON`);
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      try {
        return JSON.parse(repairUnescapedQuotes(slice));
      } catch {
        throw new Error(`${label}不是合法 JSON`);
      }
    }
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCards(raw) {
  const data = loadJson(raw, "抽取结果");
  if (!isRecord(data) || !Array.isArray(data.cards)) {
    throw new Error("抽取结果缺少 cards 数组");
  }

  const cards = [];
  const issues = [];
  const seenIds = new Set();

  data.cards.forEach((item, offset) => {
    const position = offset + 1;
    if (!isRecord(item)) {
      issues.push(`第 ${position} 项不是对象，已跳过`);
      return;
    }
    const { quote, claim, page, kind } = item;
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
      kind: typeof kind === "string" && CARD_KINDS.has(kind) ? kind : "background",
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

export async function verifyCards(cards, pages, paperId = "") {
  const verified = [];
  const issues = [];
  const seenQuotes = new Set();

  for (const card of cards) {
    const page = card.page;
    const current = {
      ...card,
      status: "unverified",
      reason: null,
      context: null,
      anchor_id: await makeAnchorId(paperId, page, card.quote),
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

/* ---------------- audit ---------------- */

export const CLAIM_STATUS = new Set([
  "supported", "needs_qualification", "insufficient_evidence", "illustration",
]);

export const PENDING = new Set(["needs_qualification", "insufficient_evidence"]);

export const ILLUSTRATION_MARKERS = [
  "例如", "假设", "比作", "可以把", "可把", "设想", "类比", "自拟", "示意", "这像",
];

const BLANK_LINE = new RegExp(`\\n${PY_SPACE_SOURCE}*\\n`);

export function paragraphsFrom(sections) {
  const result = [];
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

export function reviewClaims(raw, paragraphs, cards) {
  const data = loadJson(raw, "审计结果");
  if (!isRecord(data) || !Array.isArray(data.paragraphs)) {
    throw new Error("审计结果缺少 paragraphs 数组");
  }

  const expected = new Map(paragraphs.map((item) => [item.id, item.text]));
  const byCard = new Map(
    cards.filter((card) => card.status === "verified").map((card) => [card.card_id, card]),
  );
  const issues = [];
  const claims = [];

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
      if (typeof status !== "string" || !CLAIM_STATUS.has(status)) {
        issues.push(`${label}：status 非法（${status}）`);
        return;
      }

      let refs = [];
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

      const cardIds = [];
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
        status,
        reason: pyStrip(String(claim.reason ?? "")),
        cards: [...new Set(cardIds)].sort(),
      });
    });
  }

  const counts = { supported: 0, needs_qualification: 0, insufficient_evidence: 0, illustration: 0 };
  for (const claim of claims) counts[claim.status] += 1;

  const cited = new Set(claims.flatMap((claim) => claim.cards));
  const verifiedIds = new Set(byCard.keys());
  const summary = {
    claims: claims.length,
    by_status: counts,
    cards_cited: [...cited].filter((id) => verifiedIds.has(id)).length,
    cards_verified: verifiedIds.size,
    cards_unused: [...verifiedIds].filter((id) => !cited.has(id)).sort(),
  };
  return [claims, issues, summary];
}

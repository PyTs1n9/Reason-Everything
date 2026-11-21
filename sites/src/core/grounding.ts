/**
 * 引文定位：把「这句话是否真的出现在这一页」变成机械判定。
 *
 * 逐行移植自 app/grounding.py。两处 Python 语义必须显式还原，否则移植会静默漂移：
 * 1. Python 按 Unicode 码点遍历与切片，JS 按 UTF-16 码元；星平面字符（emoji、
 *    部分 CJK 扩展）会让偏移差一位。这里统一用码点下标，切片走 Array.from。
 * 2. Python str.isspace() 与 JS \s 的字符集不同（前者含 \x1c-\x1f 与 \x85，
 *    后者含 \ufeff）。空白判定按 Python 集合实现，保证归一化结果一致。
 */

export const SOFT_HYPHEN = "\u00ad";

/** Python str.isspace() 的字符集合，写成正则字符类的内容。 */
const PY_SPACE_CLASS =
  "\\x20\\t\\n\\v\\f\\r\\x1c-\\x1f\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** 供 audit 等模块复用：段落切分同样按 Python 的空白定义。 */
export const PY_SPACE_SOURCE = `[${PY_SPACE_CLASS}]`;

const PY_SPACE_ONE = new RegExp(PY_SPACE_SOURCE);
const PY_SPACE_RUN = new RegExp(`${PY_SPACE_SOURCE}+`);
const PY_SPACE_TRIM = new RegExp(`^${PY_SPACE_SOURCE}+|${PY_SPACE_SOURCE}+$`, "g");

export function isPySpace(char: string): boolean {
  return PY_SPACE_ONE.test(char);
}

/** 等价于 Python 的 str.split()（无参数版）。 */
export function pySplit(text: string): string[] {
  return text.split(PY_SPACE_RUN).filter((part) => part.length > 0);
}

/** 等价于 Python 的 str.strip()。 */
export function pyStrip(text: string): string {
  return text.replace(PY_SPACE_TRIM, "");
}

/** 等价于 Python 的 len(text)：按码点计数。 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** 等价于 Python 的 text[start:end]：按码点切片。 */
export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

/** 折叠空白、去软连字符，保留原有的段落边界。 */
export function normalized(text: string): string {
  return pySplit(text.split(SOFT_HYPHEN).join("")).join(" ");
}

interface CanonicalForm {
  text: string;
  chars: string[];
  /** 每个归一化字符在原文中的码点位置。 */
  index: number[];
}

function canonicalize(text: string): CanonicalForm {
  const chars: string[] = [];
  const index: number[] = [];
  // Array.from 按码点迭代，等价于 Python 的 for char in text。
  Array.from(text).forEach((char, position) => {
    if (char === SOFT_HYPHEN || isPySpace(char)) return;
    // NFKC 把连字 ﬁ 还原为 fi，使跨行断词的引文仍可匹配。
    for (const folded of Array.from(char.normalize("NFKC"))) {
      if (isPySpace(folded)) continue;
      chars.push(folded);
      index.push(position);
    }
  });
  return { text: chars.join(""), chars, index };
}

/**
 * 排版归一化：只消除排版差异，不改动字符内容。
 *
 * 因此编造的引文仍然无法匹配，而「foresee- able」与「foresee-able」、
 * 「arti ﬁcial」与「artificial」会被视为同一串。
 */
export function canonical(text: string): string {
  return canonicalize(text).text;
}

/** 返回引文在原文中的 (起, 止) 码点偏移；定位失败返回 null。 */
export function locate(pageText: string, quote: string): [number, number] | null {
  if (!pyStrip(quote)) return null;
  const haystack = canonicalize(pageText);
  const needle = canonicalize(quote);
  if (needle.chars.length === 0) return null;
  const atUtf16 = haystack.text.indexOf(needle.text);
  if (atUtf16 < 0) return null;
  // indexOf 给的是 UTF-16 偏移，换算成码点下标后才能索引 index 数组。
  const at = codePointLength(haystack.text.slice(0, atUtf16));
  const last = at + needle.chars.length - 1;
  const start = haystack.index[at];
  const end = haystack.index[last];
  if (start === undefined || end === undefined) return null;
  return [start, end + 1];
}

/** 引文所在的原文窗口，按码点切片后归一化。 */
export function window(pageText: string, start: number, end: number, radius = 700): string {
  const points = Array.from(pageText);
  const left = Math.max(0, start - radius);
  const right = Math.min(points.length, end + radius);
  return normalized(points.slice(left, right).join(""));
}

/** 引文所在的原文窗口；引文不在该页时返回 null。 */
export function contextFor(pageText: string, quote: string, radius = 700): string | null {
  const span = locate(pageText, quote);
  if (span === null) return null;
  return window(pageText, span[0], span[1], radius);
}

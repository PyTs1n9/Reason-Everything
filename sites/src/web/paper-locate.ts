import { codePointLength, locateAll } from "../core/grounding.ts";

export interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

export interface PdfViewportLike {
  width: number;
  height: number;
  transform: number[];
}

export interface PositionedRegion {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocatedQuote {
  precision: "exact" | "page";
  rects: PageRect[];
  matchCount: number;
  reason: string;
}

export function paperTextFromItems(items: readonly PdfTextItemLike[]): string {
  return items.filter((item) => typeof item.str === "string")
    .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : " "))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

interface TextSpan {
  start: number;
  end: number;
  value: PdfTextItemLike;
}

function textSpans(items: readonly PdfTextItemLike[]): { text: string; spans: TextSpan[] } {
  let text = "";
  const spans: TextSpan[] = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const start = codePointLength(text);
    text += (item.str ?? "") + (item.hasEOL ? "\n" : " ");
    spans.push({ start, end: codePointLength(text), value: item });
  }
  return { text, spans };
}

function multiply(left: readonly number[], right: readonly number[]): number[] {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function point(matrix: readonly number[], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function itemRect(item: PdfTextItemLike, viewport: PdfViewportLike): PageRect | null {
  const transform = item.transform;
  const width = item.width;
  if (!transform || transform.length < 6 || typeof width !== "number" || !Number.isFinite(width) || width <= 0) return null;
  const height = typeof item.height === "number" && Number.isFinite(item.height) && item.height > 0
    ? item.height
    : Math.hypot(transform[2], transform[3]);
  if (!Number.isFinite(height) || height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const xScale = Math.hypot(transform[0], transform[1]) || 1;
  const yScale = Math.hypot(transform[2], transform[3]) || 1;
  const itemMatrix = [
    transform[0] / xScale * width,
    transform[1] / xScale * width,
    transform[2] / yScale * height,
    transform[3] / yScale * height,
    transform[4],
    transform[5],
  ];
  const matrix = multiply(viewport.transform, itemMatrix);
  const corners = [
    point(matrix, 0, 0),
    point(matrix, 1, 0),
    point(matrix, 1, 1),
    point(matrix, 0, 1),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: clamp(left / viewport.width, 0, 1),
    y: clamp(top / viewport.height, 0, 1),
    width: clamp((right - left) / viewport.width, 0, 1),
    height: clamp((bottom - top) / viewport.height, 0, 1),
  };
}

function overlapping<T>(spans: Array<{ start: number; end: number; value: T }>, start: number, end: number): T[] {
  return spans.filter((span) => span.start < end && span.end > start).map((span) => span.value);
}

export function locateInTextItems(
  items: readonly PdfTextItemLike[],
  quote: string,
  viewport: PdfViewportLike,
): LocatedQuote {
  const { text, spans } = textSpans(items);
  const matches = locateAll(text, quote);
  if (matches.length === 0) return { precision: "page", rects: [], matchCount: 0, reason: "未在文字层找到这段摘录" };
  if (matches.length > 1) return { precision: "page", rects: [], matchCount: matches.length, reason: `该页有 ${matches.length} 处相同摘录` };
  const [start, end] = matches[0];
  const rects = overlapping(spans, start, end)
    .map((item) => itemRect(item, viewport))
    .filter((rect): rect is PageRect => rect !== null);
  if (!rects.length) return { precision: "page", rects: [], matchCount: 1, reason: "文字层没有可用坐标" };
  return { precision: "exact", rects, matchCount: 1, reason: "已高亮引用位置" };
}

export function locateInRegions(regions: readonly PositionedRegion[], quote: string): LocatedQuote {
  const text = regions.map((region) => region.text).join(" ");
  const matches = locateAll(text, quote);
  if (matches.length === 0) return { precision: "page", rects: [], matchCount: 0, reason: "未在 OCR 文字中找到这段摘录" };
  if (matches.length > 1) return { precision: "page", rects: [], matchCount: matches.length, reason: `该页有 ${matches.length} 处相同摘录` };
  const [start, end] = matches[0];
  let offset = 0;
  const spans: Array<{ start: number; end: number; value: PositionedRegion }> = [];
  for (const region of regions) {
    const length = codePointLength(region.text);
    spans.push({ start: offset, end: offset + length, value: region });
    offset += length + 1;
  }
  const rects = overlapping(spans, start, end).map((region) => ({
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  }));
  if (!rects.length) return { precision: "page", rects: [], matchCount: 1, reason: "OCR 没有返回区域坐标" };
  return { precision: "exact", rects, matchCount: 1, reason: "已高亮引用位置" };
}

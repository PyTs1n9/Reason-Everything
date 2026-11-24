import { isRecord } from "../core/json.ts";
import type { PaperPageSource, PaperRegion, PaperSource } from "./paper-study.ts";

export const PAPER_OCR_PATH = "/functions/v1/app/paper-ocr";
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;

export interface OcrBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrRegion {
  text: string;
  box: OcrBox;
}

export interface OcrResult {
  text: string;
  regions: OcrRegion[];
  width: number;
  height: number;
}

export interface OcrRequest {
  page: number;
  image: string;
  width: number;
  height: number;
  rotation: number;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function readOcrRequest(value: unknown): OcrRequest {
  if (!isRecord(value) || !Number.isSafeInteger(value.page) || Number(value.page) < 1) throw new Error("OCR 页码无效");
  if (typeof value.image !== "string" || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value.image)) {
    throw new Error("OCR 需要 PNG 或 JPEG 图片");
  }
  if (value.image.length > MAX_IMAGE_CHARS) throw new Error("OCR 图片超出请求大小限制");
  if (!positiveNumber(value.width) || !positiveNumber(value.height) || value.width > 12_000 || value.height > 12_000) {
    throw new Error("OCR 图片尺寸无效");
  }
  if (!Number.isSafeInteger(value.rotation) || Number(value.rotation) < 0 || Number(value.rotation) > 360) {
    throw new Error("OCR 页面旋转无效");
  }
  return {
    page: Number(value.page),
    image: value.image,
    width: value.width,
    height: value.height,
    rotation: Number(value.rotation),
  };
}

export function readOcrResult(value: unknown): OcrResult {
  if (!isRecord(value) || typeof value.text !== "string" || !positiveNumber(value.width) || !positiveNumber(value.height)) {
    throw new Error("OCR 返回格式无效");
  }
  if (!Array.isArray(value.regions) || value.regions.length > 20_000) throw new Error("OCR 区域列表无效");
  const regions = value.regions.map((item: unknown): OcrRegion => {
    if (!isRecord(item) || typeof item.text !== "string" || !item.text.trim() || !isRecord(item.box)) throw new Error("OCR 区域无效");
    const box = item.box;
    if (![box.left, box.top, box.width, box.height].every((part) => typeof part === "number" && Number.isFinite(part) && part >= 0)) {
      throw new Error("OCR 区域坐标无效");
    }
    if (!positiveNumber(box.width) || !positiveNumber(box.height)) throw new Error("OCR 区域尺寸无效");
    return {
      text: item.text.trim(),
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
    };
  });
  return { text: value.text.trim(), regions, width: value.width, height: value.height };
}

export function ocrPageText(result: OcrResult): string {
  return result.regions.length ? result.regions.map((region) => region.text).join(" ").trim() : result.text.trim();
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function toPaperRegions(result: OcrResult): PaperRegion[] {
  return result.regions.map((region) => ({
    text: region.text,
    x: unit(region.box.left / result.width),
    y: unit(region.box.top / result.height),
    width: unit(Math.min(region.box.width, result.width - region.box.left) / result.width),
    height: unit(Math.min(region.box.height, result.height - region.box.top) / result.height),
  }));
}

export function paperPageSource(paper: PaperSource, index: number): PaperPageSource {
  return paper.pageSources?.[index] ?? (paper.pages[index]?.trim() ? "text" : "pending");
}

export function pagesNeedingOcr(paper: PaperSource): number[] {
  const pages: number[] = [];
  paper.pages.forEach((text, index) => {
    const source = paperPageSource(paper, index);
    if (source === "pending" || source === "failed" || !text.trim()) pages.push(index + 1);
  });
  return pages;
}

export async function requestPaperOcr(
  input: OcrRequest,
  complete: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<OcrResult> {
  const response = await complete(PAPER_OCR_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: init.signal ?? AbortSignal.timeout(90_000),
    ...init,
  });
  if (response.status === 404 || response.status === 405 || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("站点的 OCR 接口未接通，原版页面仍可查看");
  }
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 504) throw new Error("OCR 请求超时，可单页重试");
    throw new Error(typeof payload?.error === "string" ? payload.error : `OCR 请求失败（HTTP ${response.status}）`);
  }
  const result = readOcrResult(payload);
  const text = ocrPageText(result);
  if (!text) throw new Error("OCR 未识别到文字，可单页重试");
  return { ...result, text };
}

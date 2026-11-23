/**
 * 文献元数据抓取（Crossref 公共 API，仅取元数据不取全文）。
 * fetch 由调用方注入：浏览器传 window.fetch，离线测试传 mock；请求失败如实抛错，不返回伪造数据。
 */

export interface LiteratureInfo {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
}

export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface LiteratureClient {
  fetchByDoi(doi: string): Promise<LiteratureInfo>;
  searchByTitle(query: string): Promise<LiteratureInfo[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = firstString(entry);
      if (text) return text;
    }
  }
  return "";
}

/** Crossref work 对象 → 文献信息；缺题名视为无效记录并如实抛错。 */
export function mapCrossrefWork(raw: unknown): LiteratureInfo {
  const work = asRecord(raw);
  const title = work ? firstString(work.title) : "";
  if (!title) throw new Error("文献元数据缺题名");
  const authorList = work?.author;
  const authors = Array.isArray(authorList)
    ? authorList
        .map((entry) => {
          const person = asRecord(entry);
          if (!person) return "";
          return `${firstString(person.given)} ${firstString(person.family)}`.trim();
        })
        .filter((name) => name.length > 0)
        .join("、")
    : "";
  const issued = asRecord(work?.issued);
  const dateParts = issued && Array.isArray(issued["date-parts"]) ? issued["date-parts"] : [];
  const firstDate = Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined;
  return {
    title,
    authors,
    year: typeof firstDate === "number" ? String(firstDate) : "",
    venue: firstString(work?.["container-title"]),
    doi: firstString(work?.DOI),
  };
}

/**
 * Crossref 客户端：DOI 精确查询 + 标题模糊检索（返回最多 5 条）。
 * 超时/网络失败/非 200 一律带原始原因抛错。
 */
export function createLiteratureClient(
  fetchImpl: FetchLike,
  options: { timeoutMs?: number; baseUrl?: string } = {},
): LiteratureClient {
  const timeoutMs = options.timeoutMs ?? 8000;
  const baseUrl = (options.baseUrl ?? "https://api.crossref.org").replace(/\/+$/, "");

  async function request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      const reason = error && (error as Error).message ? (error as Error).message : String(error);
      if (controller.signal.aborted) throw new Error(`抓取失败：请求超时（${timeoutMs}ms）`);
      throw new Error(`抓取失败：${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  function messageOf(payload: unknown): Record<string, unknown> {
    const envelope = asRecord(payload);
    const message = envelope ? asRecord(envelope.message) : null;
    return message ?? {};
  }

  return {
    async fetchByDoi(doi: string): Promise<LiteratureInfo> {
      const clean = doi.trim();
      if (!clean) throw new Error("请填写 DOI");
      const message = messageOf(await request(`${baseUrl}/works/${encodeURIComponent(clean)}`));
      if (!asRecord(message) || Object.keys(message).length === 0) {
        throw new Error("抓取失败：响应缺少文献记录");
      }
      return mapCrossrefWork(message);
    },

    async searchByTitle(query: string): Promise<LiteratureInfo[]> {
      const clean = query.trim();
      if (!clean) throw new Error("请填写检索词");
      const message = messageOf(
        await request(`${baseUrl}/works?query.bibliographic=${encodeURIComponent(clean)}&rows=5`),
      );
      const items = Array.isArray(message.items) ? message.items : null;
      if (!items) throw new Error("抓取失败：响应缺少检索结果");
      // 边界数据校验（外部 API）：缺题名的条目不可用，剔除而非吞错
      const valid = items.filter((item) => {
        const record = asRecord(item);
        return record ? firstString(record.title).length > 0 : false;
      });
      if (items.length > 0 && valid.length === 0) throw new Error("抓取失败：检索结果均缺题名");
      return valid.map((item) => mapCrossrefWork(item));
    },
  };
}

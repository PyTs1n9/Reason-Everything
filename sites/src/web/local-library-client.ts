import { cleanLocalLibraryPath, LOCAL_LIBRARY_PATH } from "./local-library-path.ts";

export interface LocalLibraryPaper {
  sha256: string;
  filename: string;
  size: number;
  savedAt: string;
}

export interface LocalLibrarySnapshot {
  configured: boolean;
  path: string;
  papersDirectory: string;
  modelKeyFile: string;
  encryptionKeyFile: string;
  paperCount: number;
  papers: LocalLibraryPaper[];
}

export interface LocalLibraryClientOptions {
  fetchImpl?: typeof fetch;
  getToken: (refresh?: boolean) => Promise<string>;
}

export function createLocalLibraryClient(options: LocalLibraryClientOptions) {
  const complete = options.fetchImpl ?? fetch;

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const request = async (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("x-agentflow-local-token", token);
      return complete(`${LOCAL_LIBRARY_PATH}${path}`, { ...init, headers });
    };
    let response = await request(await options.getToken());
    if (response.status === 401) response = await request(await options.getToken(true));
    return response;
  }

  async function json(path: string, init: RequestInit = {}) {
    const response = await send(path, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `本地知识库请求失败（HTTP ${response.status}）`);
    return payload;
  }

  return {
    async status(): Promise<LocalLibrarySnapshot> {
      return json("");
    },
    async select(path: unknown): Promise<LocalLibrarySnapshot> {
      return json("", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: cleanLocalLibraryPath(path) }),
      });
    },
    async browse(): Promise<string | null> {
      const result = await json("/browse", { method: "POST" });
      if (typeof result.path !== "string" && result.path !== null) throw new Error("本地文件夹选择结果无效");
      return result.path;
    },
    async savePaper(input: { filename: string; sha256: string; bytes: Uint8Array }): Promise<LocalLibraryPaper> {
      return json(`/papers?filename=${encodeURIComponent(input.filename)}`, {
        method: "POST",
        headers: { "content-type": "application/pdf", "x-agentflow-paper-sha256": input.sha256 },
        body: input.bytes,
      });
    },
    async readPaper(sha256: string): Promise<Blob> {
      const response = await send(`/papers/${encodeURIComponent(sha256)}`);
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || `PDF 取回失败（HTTP ${response.status}）`);
      }
      return response.blob();
    },
  };
}

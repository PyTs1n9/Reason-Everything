import type { ModelAdapter } from "../agent/adapter.ts";
import { MODEL_CONFIG_PATH } from "./model-config-path.ts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createSameOriginModelAdapter(fetchImpl: FetchLike = fetch): ModelAdapter {
  async function request(messages: Array<{ role: string; content: string }>): Promise<{ text: string; provider: string; model: string }> {
    const getToken = async (): Promise<string> => {
      const bootstrap = await fetchImpl("/__agentflow_local.json", { cache: "no-store" });
      if (!bootstrap.ok) throw new Error("本地模型服务未启动，请从项目根目录运行 node scripts/serve-web.mjs");
      const { token } = await bootstrap.json();
      if (typeof token !== "string" || !token) throw new Error("本地服务身份信息无效");
      return token;
    };
    const send = async (token: string) => fetchImpl(`${MODEL_CONFIG_PATH}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentflow-local-token": token },
      body: JSON.stringify({ messages }),
    });
    let response = await send(await getToken());
    if (response.status === 401) response = await send(await getToken());
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `模型请求失败（HTTP ${response.status}）`);
    if (typeof payload.text !== "string" || typeof payload.provider !== "string" || typeof payload.model !== "string") {
      throw new Error("模型服务返回格式无效");
    }
    return payload;
  }

  return {
    async parse(input) {
      const result = await request([
        { role: "system", content: input.systemPrompt },
        { role: "user", content: JSON.stringify({ rawClaim: input.rawClaim, fieldDict: input.fieldDict, ...(input.repairFeedback ? { errors: input.repairFeedback } : {}) }) },
      ]);
      return result;
    },
    async analyze(input) {
      const result = await request([
        { role: "system", content: input.systemPrompt },
        { role: "user", content: JSON.stringify({
          question: input.question,
          evidence: input.evidence,
          facts: input.facts,
          allowedEvidenceIds: input.allowedEvidenceIds,
          rulesVersion: input.rulesVersion,
          ...(input.repairFeedback ? { errors: input.repairFeedback } : {}),
        }) },
      ]);
      return result;
    },
  };
}

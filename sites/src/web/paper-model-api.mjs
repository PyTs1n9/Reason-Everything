import { PAPER_SYSTEM_PROMPT, readPaperModelInput } from "./paper-study.ts";

const MAX_REQUEST_BYTES = 128 * 1024;

export async function handlePaperModel(request, config, complete = fetch) {
  if (request.method !== "POST") return Response.json({ error: "请使用 POST" }, { status: 405 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "请从同源工作台发起模型请求" }, { status: 403 });
  }
  if (!config.url || !config.key || !config.model) {
    return Response.json({ error: "论文模型未配置，全文已保存在本机" }, { status: 503 });
  }
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) {
    return Response.json({ error: "需要 JSON 论文资料" }, { status: 415 });
  }

  let input;
  try {
    const decoder = new TextDecoder();
    let json = "";
    let size = 0;
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_REQUEST_BYTES) return Response.json({ error: "论文批次超出请求大小限制" }, { status: 413 });
      json += decoder.decode(chunk, { stream: true });
    }
    input = readPaperModelInput(JSON.parse(json + decoder.decode()));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  try {
    const upstream = await complete(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.key}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: PAPER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok) return Response.json({ error: `模型 API 返回 HTTP ${upstream.status}` }, { status: 502 });
    const payload = await upstream.json();
    const choice = payload?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string" || !text.trim() || choice.finish_reason === "length") {
      return Response.json({ error: "模型 API 没有返回完整的候选内容" }, { status: 502 });
    }
    const model = typeof payload.model === "string" && payload.model ? payload.model : config.model;
    return Response.json({ text, model });
  } catch (error) {
    if (error?.name === "TimeoutError") return Response.json({ error: "模型 API 请求超时" }, { status: 504 });
    return Response.json({ error: "无法读取模型 API 响应" }, { status: 502 });
  }
}

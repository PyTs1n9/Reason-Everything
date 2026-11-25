import { PAPER_SYSTEM_PROMPT, readPaperModelInput } from "./paper-study.ts";
import { authorizeLocalModelRequest, createModelConfigService } from "./model-config.ts";

const MAX_REQUEST_BYTES = 128 * 1024;

export async function handlePaperModel(request, options = {}, service = createModelConfigService(options)) {
  const authError = authorizeLocalModelRequest(request, options.token);
  if (authError) return authError;
  if (request.method !== "POST") return Response.json({ error: "请使用 POST" }, { status: 405 });
  let active;
  try {
    active = await service.list();
  } catch (error) {
    return Response.json({ error: `模型配置读取失败：${error.message}` }, { status: 500 });
  }
  if (!active.activeServiceId) {
    return Response.json({ error: "论文模型未配置，请先在模型服务中添加服务并选择模型" }, { status: 503 });
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
    const result = await service.complete([
      { role: "system", content: PAPER_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ], active.services.find((item) => item.id === active.activeServiceId)?.model);
    return Response.json({ text: result.text, model: result.model });
  } catch (error) {
    const timeout = /超时/.test(error.message);
    return Response.json({ error: error.message }, { status: timeout ? 504 : 502 });
  }
}

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readOcrRequest, readOcrResult } from "./paper-ocr.ts";

const execFileAsync = promisify(execFile);
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;

function json(error, status) {
  return Response.json({ error }, { status });
}

async function readBody(request) {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("OCR 图片超出请求大小限制");
    text += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export async function runWindowsOcr(input, config, runner = execFileAsync) {
  const directory = await mkdtemp(join(tmpdir(), "agentflow-ocr-"));
  const imagePath = join(directory, "page.png");
  try {
    const base64 = input.image.slice(input.image.indexOf(",") + 1);
    await writeFile(imagePath, Buffer.from(base64, "base64"));
    const { stdout } = await runner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      config.scriptPath,
      "-Path",
      imagePath,
    ], {
      timeout: config.timeoutMs ?? 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return readOcrResult(JSON.parse(String(stdout).replace(/^\uFEFF/, "").trim()));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function handlePaperOcr(request, config, localRun = runWindowsOcr) {
  if (request.method !== "POST") return json("请使用 POST", 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json("请从同源工作台发起 OCR 请求", 403);
  if (!config.localWindows) return json("本机 OCR 未启用，原版页面仍可查看", 503);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) {
    return json("需要 JSON OCR 图片", 415);
  }

  let input;
  try {
    input = readOcrRequest(await readBody(request));
  } catch (error) {
    return json(error.message, 400);
  }

  try {
    const result = await localRun(input, config);
    return Response.json(result);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.code === "ETIMEDOUT" || error?.killed) {
      return json("OCR 请求超时，可单页重试", 504);
    }
    return json("本机 OCR 识别失败，请检查 Windows OCR 语言包", 502);
  }
}

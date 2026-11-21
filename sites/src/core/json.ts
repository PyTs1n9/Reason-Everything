/**
 * 模型输出的 JSON 解析：容忍 ```json 围栏与前后闲话，其余一律视为失败。
 *
 * 与 app/cards.py、app/audit.py 里的 _load_json 等价；不静默兜底成空对象——
 * 解析失败必须让上层看见，否则会退化成「模型自己审自己」。
 */

export function loadJson(raw: string, label: string): unknown {
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
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error(`${label}不是合法 JSON`);
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

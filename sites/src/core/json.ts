/**
 * 模型输出的 JSON 解析：容忍 ```json 围栏与前后闲话，其余一律视为失败。
 *
 * 与 app/cards.py、app/audit.py 里的 _load_json 等价；不静默兜底成空对象——
 * 解析失败必须让上层看见，否则会退化成「模型自己审自己」。
 */

/** 模型偶发把英文双引号直接写进字符串值（如 中文"引号"），JSON.parse 会断在
 * 处。按结构逐字符重写：字符串内的裸引号，只有后继非空白字符不是 : , } ] 或结束
 * 时才判为值内引号并转义；转不出合法 JSON 时上层仍如实失败。 */
function repairUnescapedQuotes(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString && char === "\\") {
      out += char + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === '"') {
      if (!inString) {
        inString = true;
        out += char;
        continue;
      }
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      const ahead = text[next];
      if (ahead === undefined || ahead === ":" || ahead === "," || ahead === "}" || ahead === "]") {
        inString = false;
        out += char;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += char;
  }
  return out;
}

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
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      try {
        return JSON.parse(repairUnescapedQuotes(slice));
      } catch {
        throw new Error(`${label}不是合法 JSON`);
      }
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

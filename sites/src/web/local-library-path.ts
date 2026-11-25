export const LOCAL_LIBRARY_PATH = "/api/local-library";
export const LOCAL_LIBRARY_SETTINGS_FILE = ".agentflow-local-library.json";
export const MODEL_KEY_FILENAME = ".model-keys.json";
export const MODEL_ENCRYPTION_KEY_FILENAME = ".agentflow-model-keys.key";

export function cleanLocalLibraryPath(value: unknown): string {
  if (typeof value !== "string") throw new Error("请选择本地知识库文件夹");
  const path = value.trim();
  if (!path) throw new Error("请选择本地知识库文件夹");
  if (path.length > 4096) throw new Error("本地知识库路径过长");
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error("本地知识库路径包含无效字符");
  return path;
}

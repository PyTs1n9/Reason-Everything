export const SIDEBAR_DEFAULT_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 208;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_KEYBOARD_STEP = 16;
export const SIDEBAR_WIDTH_KEY = "agentflow-sidebar-width";
export const SIDEBAR_COLLAPSED_KEY = "agentflow-sidebar-collapsed";

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value)));
}

export function parseSidebarWidth(raw: string | null): number {
  if (raw === null || !raw.trim()) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(Number(raw));
}

export function sidebarWidthFromKey(width: number, key: string): number {
  const current = clampSidebarWidth(width);
  if (key === "ArrowLeft") return clampSidebarWidth(current - SIDEBAR_KEYBOARD_STEP);
  if (key === "ArrowRight") return clampSidebarWidth(current + SIDEBAR_KEYBOARD_STEP);
  if (key === "Home") return SIDEBAR_MIN_WIDTH;
  if (key === "End") return SIDEBAR_MAX_WIDTH;
  return current;
}

// ===== 设备参数统一口径（服务端与客户端共用，唯一实现）=====
//
// 背景（2026-11-01 验收 DEF-02）：页面内部状态是 `PC` / `移动端`，
// 而 /api/keywords/expand 的对外契约返回 `desktop` / `mobile`；
// /api/seo/serp 只接受 `PC` / `移动端`。前端把 expand 的 `desktop` 直接转给 SERP
// 接口 → 400「device 必须是 PC 或 移动端」，分页静默清空。
//
// 修法：两侧都经过本模块归一化，而不是在某个组件里写一张局部映射表。
// 对外契约（expand 返回 desktop/mobile）保持不变，避免破坏既有调用方。

export type SerpDevice = "PC" | "移动端";

/** 接受页面口径、expand 对外口径与常见别名，返回页面口径；无法识别返回 null */
export function normalizeDeviceParam(input: string | null | undefined): SerpDevice | null {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "pc" || v === "desktop" || v === "桌面" || v === "电脑" || v === "desktop_pc") return "PC";
  if (v === "mobile" || v === "移动端" || v === "移动" || v === "手机" || v === "m" || v === "smartphone") {
    return "移动端";
  }
  return null;
}

/** 页面口径 → expand 对外契约口径（desktop / mobile） */
export function toApiDeviceValue(device: SerpDevice): "desktop" | "mobile" {
  return device === "PC" ? "desktop" : "mobile";
}

/** 任意口径 → 页面口径，无法识别时退回 PC（与页面默认值一致，不静默改语义） */
export function toSerpDevice(input: string | null | undefined): SerpDevice {
  return normalizeDeviceParam(input) ?? "PC";
}

/** 展示用标签：PC / 移动端（英文环境 Mobile） */
export function deviceDisplayLabel(device: SerpDevice, zh: boolean): string {
  return device === "PC" ? "PC" : zh ? "移动端" : "Mobile";
}

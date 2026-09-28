// ===== G｜社区 UTM 生成（复用 B 的 attribution）=====
// 规则（§18）：全部复用 B 已有的来源标准化，不建立第二套 analytics。
//   utm_source   = 平台对应的 canonical source（reddit / indiehackers / linkedin / x / producthunt）
//   utm_medium   = community（Product Hunt 用 launch）
//   utm_campaign = community（Product Hunt 用 launch）
//   utm_content  = <content_id>（可选，但强烈建议，便于回溯到 F 的主题）

import { CANONICAL_SOURCES } from "../analytics/sources.ts";
import { PLATFORM_UTM_SOURCE, type Platform } from "./schema.ts";

export const APP_URL_FALLBACK = "https://www.seeo.asia";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || APP_URL_FALLBACK;
}

/** Product Hunt 是一次性 launch，campaign 与 medium 都用 launch 以便区分 */
export function campaignFor(platform: Platform): { medium: string; campaign: string } {
  return platform === "product_hunt"
    ? { medium: "launch", campaign: "launch" }
    : { medium: "community", campaign: "community" };
}

export interface CommunityUrlOptions {
  platform: Platform;
  /** 站内路径，如 "/"、"/features/seo-audit" */
  path: string;
  /** F 的 content_id（C001…），用于回溯内容来源 */
  contentId?: string;
}

/** 生成带 UTM 的社区链接 */
export function buildCommunityUrl(opts: CommunityUrlOptions): string {
  const base = opts.path.startsWith("http") ? opts.path : `${appUrl()}${opts.path}`;
  const { medium, campaign } = campaignFor(opts.platform);
  try {
    const url = new URL(base);
    url.searchParams.set("utm_source", PLATFORM_UTM_SOURCE[opts.platform]);
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", campaign);
    if (opts.contentId) url.searchParams.set("utm_content", opts.contentId);
    return url.toString();
  } catch {
    return base;
  }
}

/** 平台的 utm_source 是否是 B 认可的 canonical source（防拼写漂移） */
export function isCanonicalSourceFor(platform: Platform): boolean {
  return (CANONICAL_SOURCES as readonly string[]).includes(PLATFORM_UTM_SOURCE[platform]);
}

/** 供报告/测试使用：全部平台的映射快照 */
export function utmSourceMap(): Record<string, string> {
  return { ...PLATFORM_UTM_SOURCE };
}

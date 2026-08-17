// ===== 相对时间格式化（Dashboard UI 共享）=====
// t 来自 messages dashboard.common（justNow/minutesAgo/hoursAgo/daysAgo），
// 超过 30 天回退为当前 locale 的日期显示。

import { formatDate, type Locale } from "./ui-locale";

export type RelativeTimeT = (
  key: "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo",
  values?: { n: number }
) => string;

export function formatRelativeTime(
  isoStr: string,
  locale: Locale,
  t: RelativeTimeT
): string {
  const then = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z").getTime();
  if (Number.isNaN(then)) return isoStr;
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return t("minutesAgo", { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("hoursAgo", { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return t("daysAgo", { n: diffDay });
  return formatDate(new Date(then), locale);
}

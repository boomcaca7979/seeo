// ===== next-intl 请求级配置 =====
// 由 next.config.ts 的 createNextIntlPlugin 挂载（默认路径 src/i18n/request.ts）。
// Phase 0：messages 仅含骨架 key，业务页面文案尚未迁移。

import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

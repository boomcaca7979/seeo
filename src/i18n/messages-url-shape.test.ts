// ===== messages 值不得形如 URL 路径（GSC 404 根因契约）=====
//
// 事故：zh 文案值 "plans.priceUnit": "/30天" 与 "dashboard.settings.priceUnitDays":
// "/{n}天"（ICU 模板）被 next-intl 整包序列化进每个 ZH 页面的 RSC flight payload；
// 两个斜杠开头的字符串被爬虫当相对路径抓取 → GSC 报 Not found (404)：
// /30天 与 /{n}天（2026-10-24）。文案里的斜杠已在渲染侧补回
// （CustomService / settings）。
//
// 本测试钉住整类问题：任何 message 字符串值不得以 "/" 开头，
// 白名单仅限「真的是路由数据」的字段（它们渲染为真实内链，且目标真实存在）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MESSAGES_DIR = fileURLToPath(new URL("../../messages/", import.meta.url));

/** 允许以 "/" 开头的字段：值为真实站内路由或指向真实存在的页面 */
const PATH_DATA_ALLOWLIST = [
  "features.cards[", // .href → /app/audit（游客可用审计入口，真实路由）
  "aboutPage.capabilities[", // .href → /features/*（暂缓页由 isPublicPathEnabled gating）
  "backlinkChecker.related.items[", // .path → feature/guide 路由（工具停用时整组不渲染）
  "dashboard.audit.llmsTxtSub", // 说明文字以 /llms.txt 开头；该路径真实存在（200），无 404 风险
];

function isAllowlisted(path: string): boolean {
  return PATH_DATA_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}

for (const lang of ["en", "zh"] as const) {
  describe(`messages/${lang}.json 值形态`, () => {
    const bundle = JSON.parse(readFileSync(`${MESSAGES_DIR}${lang}.json`, "utf-8")) as unknown;

    it("没有任何文案值以 / 开头（会被爬虫当相对路径抓取）", () => {
      const offenders: string[] = [];
      const walk = (obj: unknown, path: string) => {
        if (Array.isArray(obj)) {
          obj.forEach((v, i) => walk(v, `${path}[${i}]`));
        } else if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
        } else if (typeof obj === "string" && obj.startsWith("/") && obj.length > 1) {
          if (!isAllowlisted(path)) offenders.push(`${path} = ${JSON.stringify(obj)}`);
        }
      };
      walk(bundle, "");
      expect(offenders).toEqual([]);
    });
  });
}

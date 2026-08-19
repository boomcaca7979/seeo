// ===== UI Refresh contract（字体体系 + 首页 Hero 重构 + Dashboard Logo 返回首页）=====
// 覆盖：
// 1. Dashboard Sidebar Logo → localePath(locale, "/")：EN → / · ZH → /zh（不硬编码 href）
// 2. 首页结构：Ticker 动态卡片彻底移除（组件删除 + 无引用）；
//    原页面最底部 CTA 卡片整体上移至 Hero 之后（原 Ticker 位置），且全页仅渲染一次
// 3. Hero 信息层级：UrlAuditBox 搜索入口先于次级按钮与深色视觉面板（首屏第一互动 CTA）
// 4. 文案删除：hint（"输入域名即可快速审计，无需注册" / EN 对应）从中英文 messages 移除
// 5. UrlAuditBox：输入框与提交按钮一体（同一表单容器内，submit 按钮存在）

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { localePath } from "@/i18n/seo";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME_PAGE = readFileSync(join(ROOT, "src/app/[locale]/page.tsx"), "utf-8");
const HERO = readFileSync(join(ROOT, "src/components/Hero.tsx"), "utf-8");
const URL_AUDIT_BOX = readFileSync(join(ROOT, "src/components/UrlAuditBox.tsx"), "utf-8");
const SIDEBAR = readFileSync(join(ROOT, "src/components/dashboard/Sidebar.tsx"), "utf-8");
const EN_MESSAGES = readFileSync(join(ROOT, "messages/en.json"), "utf-8");
const ZH_MESSAGES = readFileSync(join(ROOT, "messages/zh.json"), "utf-8");

/** 递归收集 src 下所有 .tsx/.ts 源码（不含测试） */
function collectSources(dir: string, exts: string[] = [".tsx", ".ts"]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectSources(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe("Dashboard Logo 返回首页（localePath 复用）", () => {
  it("localePath 单元行为：EN → / · ZH → /zh（营销首页，非 /app）", () => {
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("zh", "/")).toBe("/zh");
    // 非 /en 前缀
    expect(localePath("en", "/")).not.toBe("/en");
    expect(localePath("zh", "/")).not.toBe("/en");
  });

  it("Sidebar Logo 使用 localePath(locale, \"/\") 且带 aria-label（不硬编码 href）", () => {
    expect(SIDEBAR).toContain('localePath(locale, "/")');
    expect(SIDEBAR).toContain('aria-label="SeeO home"');
    // 不允许硬编码首页/审计路径
    expect(SIDEBAR).not.toMatch(/href="\/"\s*>/);
  });

  it("Sidebar 引入 localePath（来自 @/i18n/seo 统一 helper）", () => {
    expect(SIDEBAR).toContain('from "@/i18n/seo"');
  });
});

describe("首页顶部动态卡片（Ticker）彻底移除", () => {
  it("Ticker 组件文件已删除", () => {
    expect(existsSync(join(ROOT, "src/components/Ticker.tsx"))).toBe(false);
  });

  it("全站源码无 Ticker import / 引用（不含注释）", () => {
    const offenders = collectSources(join(ROOT, "src"))
      .filter((p) => {
        let code = readFileSync(p, "utf-8");
        // 去掉注释后仍出现 Ticker 视为引用：行注释 / 块注释 / JSX 注释
        code = code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
        code = code
          .split("\n")
          .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
          .join("\n");
        return /\bTicker\b/.test(code);
      })
      .map((p) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("messages 中不再有 ticker 文案 key（中英同步清理或本就未使用则不要求）", () => {
    // ticker 文案 key 若残留且无引用即为死键；这里只断言首页 page 不引用 ticker 命名空间
    expect(HOME_PAGE).not.toContain('useTranslations("ticker"');
  });
});

describe("原最底部 CTA 卡片整体上移至顶部（原 Ticker 位置）", () => {
  it("首页渲染顺序：Hero → CTA → FeatureCards → DashboardPreview（CTA 紧随 Hero）", () => {
    const heroIdx = HOME_PAGE.indexOf("<Hero />");
    const ctaIdx = HOME_PAGE.indexOf("<CTA />");
    const featureIdx = HOME_PAGE.indexOf("<FeatureCards />");
    const previewIdx = HOME_PAGE.indexOf("<DashboardPreview />");
    expect(heroIdx).toBeGreaterThan(-1);
    expect(ctaIdx).toBeGreaterThan(-1);
    expect(featureIdx).toBeGreaterThan(-1);
    expect(previewIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeLessThan(ctaIdx);
    expect(ctaIdx).toBeLessThan(featureIdx);
    expect(featureIdx).toBeLessThan(previewIdx);
  });

  it("CTA 全页仅渲染一次（原底部位置不再重复出现）", () => {
    const count = (HOME_PAGE.match(/<CTA \/>/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("CTA 组件保留原有功能（域名输入 + submit 跳转审计页）", () => {
    const cta = readFileSync(join(ROOT, "src/components/CTA.tsx"), "utf-8");
    expect(cta).toContain('type="text"');
    expect(cta).toContain('type="submit"');
    expect(cta).toContain("/app/audit?domain=");
  });
});

describe("Hero 信息层级（搜索入口为第一互动 CTA）", () => {
  it("UrlAuditBox 位于 Hero 中，且先于次级按钮区与深色视觉面板", () => {
    const auditIdx = HERO.indexOf("<UrlAuditBox />");
    const buttonsIdx = HERO.indexOf('className="btn-secondary btn-lg');
    const panelIdx = HERO.indexOf("bg-ink");
    expect(auditIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeLessThan(buttonsIdx);
    expect(auditIdx).toBeLessThan(panelIdx);
  });

  it("UrlAuditBox：输入框与提交按钮在同一 form 容器内（视觉一体）", () => {
    expect(URL_AUDIT_BOX).toContain("<form");
    expect(URL_AUDIT_BOX).toContain('type="text"');
    expect(URL_AUDIT_BOX).toContain('type="submit"');
    // placeholder 保留（用户引导），占位文字不使用过浅 token
    expect(URL_AUDIT_BOX).toContain("placeholder={t(\"placeholder\")}");
    expect(URL_AUDIT_BOX).not.toContain("placeholder:text-ink-25");
  });

  it("UrlAuditBox 提交走域名审计路径（demo 直达 / auth 先登录）", () => {
    expect(URL_AUDIT_BOX).toContain("/app/audit?domain=");
    expect(URL_AUDIT_BOX).toContain("isAuthEnabled");
  });
});

describe("hint 文案删除（中英同步）", () => {
  it("中文 messages 不含『输入域名即可快速审计，无需注册』", () => {
    expect(ZH_MESSAGES).not.toContain("输入域名即可快速审计，无需注册");
  });

  it("英文 messages 不含对应 EN hint 文案", () => {
    expect(EN_MESSAGES).not.toContain("no sign-up required");
  });

  it("auditBox 命名空间保留其余 key（placeholder/submit/错误提示不误删）", () => {
    const zh = JSON.parse(ZH_MESSAGES);
    const en = JSON.parse(EN_MESSAGES);
    expect(zh.hero.auditBox).not.toHaveProperty("hint");
    expect(en.hero.auditBox).not.toHaveProperty("hint");
    for (const key of ["placeholder", "submit", "submitting", "errEmpty", "errInvalid", "errPrivate", "label"]) {
      expect(zh.hero.auditBox).toHaveProperty(key);
      expect(en.hero.auditBox).toHaveProperty(key);
    }
  });

  it("全站源码与 messages 均无 hint key 消费（hero.auditBox.hint / t(\"hint\")）", () => {
    const offenders = collectSources(join(ROOT, "src"))
      .filter((p) => /auditBox\.hint|t\("hint"\)/.test(readFileSync(p, "utf-8")))
      .map((p) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

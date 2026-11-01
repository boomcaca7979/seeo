// ===== 第十六阶段：/unsubscribe 本地化 + dashboard.sidebar 无引用键清理 =====
// 覆盖：
//   1. unsubscribePage 文案 en/zh 齐备，EN 措辞与改造前逐字一致（中文修改不外溢）
//   2. page.tsx 走现有 next-intl 机制，无第二套语言判断、无残留硬编码 UI 文案
//   3. 退订分支（done/already/invalid/未知回落入口态）与 noindex 语义不变
//   4. dashboard.sidebar 只保留被真实引用的键，5 个无引用键与 accountMenu 残留已清除

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const EN = JSON.parse(readFileSync(`${ROOT}messages/en.json`, "utf-8"));
const ZH = JSON.parse(readFileSync(`${ROOT}messages/zh.json`, "utf-8"));
const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const API_SRC = readFileSync(
  fileURLToPath(new URL("../../api/email/unsubscribe/route.ts", import.meta.url)),
  "utf-8"
);

const ZH_HAS_CHINESE = (s: string) => /[\u4e00-\u9fff]/.test(s);

describe("unsubscribePage：messages 双语齐备", () => {
  const KEYS = [
    "metaTitle",
    "entryTitle",
    "doneTitle",
    "doneBody",
    "alreadyTitle",
    "alreadyBody",
    "invalidTitle",
    "invalidBody",
    "back",
  ] as const;

  it("en/zh 键位完全一致", () => {
    expect(Object.keys(EN.unsubscribePage).sort()).toEqual(Object.keys(ZH.unsubscribePage).sort());
  });

  it("中文环境每个键都有中文", () => {
    for (const k of KEYS) {
      expect(ZH.unsubscribePage[k], `zh.${k}`).toBeTruthy();
      expect(ZH_HAS_CHINESE(ZH.unsubscribePage[k]), `zh.${k} 未汉化`).toBe(true);
    }
  });

  it("英文文案与改造前逐字一致（不被中文改动影响）", () => {
    expect(EN.unsubscribePage.metaTitle).toBe("Unsubscribed — SeeO");
    expect(EN.unsubscribePage.entryTitle).toBe("Unsubscribe");
    expect(EN.unsubscribePage.doneTitle).toBe("You're unsubscribed");
    expect(EN.unsubscribePage.doneBody).toBe(
      "You will no longer receive marketing and lifecycle emails from SeeO. Account and security emails (like sign-in) are not affected."
    );
    expect(EN.unsubscribePage.alreadyTitle).toBe("You were already unsubscribed");
    expect(EN.unsubscribePage.alreadyBody).toBe("Marketing emails were already turned off for this address.");
    expect(EN.unsubscribePage.invalidTitle).toBe("This unsubscribe link is not valid");
    expect(EN.unsubscribePage.invalidBody).toBe(
      "The link seems broken or incomplete. If you keep receiving marketing emails, contact support@seeo.asia."
    );
    expect(EN.unsubscribePage.back).toBe("Back to SeeO");
    for (const k of KEYS) expect(ZH_HAS_CHINESE(EN.unsubscribePage[k])).toBe(false);
  });

  it("入口态无说明段落（沿用原有 body 为空的行为）", () => {
    expect(EN.unsubscribePage.entryBody).toBeUndefined();
    expect(ZH.unsubscribePage.entryBody).toBeUndefined();
  });

  it("无效链接文案保留支持邮箱，退订范围表述不扩大到事务邮件", () => {
    for (const dict of [EN, ZH]) {
      expect(dict.unsubscribePage.invalidBody).toContain("support@seeo.asia");
      expect(dict.unsubscribePage.doneBody).toMatch(/sign-in|登录验证/);
    }
  });
});

describe("unsubscribe 页面：沿用现有 i18n 机制、不改退订语义", () => {
  it("通过 getTranslations(\"unsubscribePage\") 取文案，不建第二套语言判断", () => {
    expect(PAGE_SRC).toContain('getTranslations("unsubscribePage")');
    expect(PAGE_SRC).not.toMatch(/useLocale\s*\(/);
    expect(PAGE_SRC).not.toMatch(/from "next\/headers"/);
  });

  it("标题、说明、按钮全部走翻译键，无残留硬编码 UI 文案", () => {
    for (const key of ["entryTitle", "doneTitle", "doneBody", "alreadyTitle", "alreadyBody", "invalidTitle", "invalidBody", "back"]) {
      expect(PAGE_SRC, key).toContain(`t("${key}")`);
    }
    expect(PAGE_SRC).not.toMatch(/>\s*(Unsubscribe|Back to SeeO|退订)\s*</);
  });

  it("四个分支齐备且未知 status 回落入口态", () => {
    for (const s of ["done", "already", "invalid"]) expect(PAGE_SRC).toContain(`status === "${s}"`);
    expect(PAGE_SRC).toMatch(/:\s*\{\s*title:\s*t\("entryTitle"\),\s*body:\s*""\s*\}/);
  });

  it("noindex 保持，token 仍在 API 侧处理", () => {
    expect(PAGE_SRC).toContain("index: false");
    expect(API_SRC).toContain('status=invalid');
    expect(API_SRC).toMatch(/unsubscribeByToken\(token\)/);
  });
});

// ---------- dashboard.sidebar 无引用键清理 ----------

/** 仅这 4 个文件绑定 dashboard.sidebar 命名空间（新增消费方需同步本表） */
const SIDEBAR_CONSUMERS = [
  "src/components/dashboard/Sidebar.tsx",
  "src/components/dashboard/WorkspaceHeader.tsx",
  "src/app/(default)/(dashboard)/app/layout.tsx",
  "src/app/(default)/(dashboard)/app/page.tsx",
];

function sourceFiles(): string[] {
  const srcRoot = `${ROOT}src`;
  return readdirSync(srcRoot, { recursive: true, withFileTypes: true })
    .filter(
      (e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)
    )
    .map((e) => `${e.parentPath.slice(ROOT.length)}/${e.name}`);
}

describe("dashboard.sidebar：只保留被真实引用的键", () => {
  // keywordExpand：2026-11 关键词研究导航重构（概览/魔法工具/策略构造器/已保存四页）后，
  // 侧边栏不再有独立「拓词建议」入口，键随入口一并移除。
  const REMOVED = ["currentPlan", "upgradeCta", "login", "logout", "demoToast", "accountMenu", "keywordExpand"] as const;

  it("消费方集合未变化（否则引用扫描结论失效）", () => {
    const binders = sourceFiles()
      .filter((p) =>
        /(?:use|get)Translations\((?:await )?"dashboard\.sidebar"\)/.test(readFileSync(`${ROOT}${p}`, "utf-8"))
      )
      .sort();
    expect(binders).toEqual([...SIDEBAR_CONSUMERS].sort());
  });

  it("已确认无引用的键在中英文目录中都已移除", () => {
    for (const k of REMOVED) {
      expect(EN.dashboard.sidebar[k], `en.sidebar.${k}`).toBeUndefined();
      expect(ZH.dashboard.sidebar[k], `zh.sidebar.${k}`).toBeUndefined();
    }
  });

  it("保留下来的每个键都能在消费方源码中找到字面引用", () => {
    const corpus = SIDEBAR_CONSUMERS.map((p) => readFileSync(`${ROOT}${p}`, "utf-8")).join("\n");
    for (const k of Object.keys(ZH.dashboard.sidebar)) {
      expect(corpus, `dashboard.sidebar.${k} 无引用`).toContain(`"${k}"`);
    }
  });

  it("布局仍在使用的键未被误删", () => {
    for (const k of ["demoUser", "demoEmail", "guestUser"]) {
      expect(ZH.dashboard.sidebar[k]).toBeTruthy();
      expect(EN.dashboard.sidebar[k]).toBeTruthy();
    }
  });

  it("Topbar 的 login/logout 属于 dashboard.topbar，清理未波及", () => {
    for (const k of ["login", "logout"]) {
      expect(EN.dashboard.topbar[k]).toBeTruthy();
      expect(ZH.dashboard.topbar[k]).toBeTruthy();
    }
  });
});

// ===== BUG-42 / BUG-43：Dashboard 表单控件可访问名回归 =====
// 实测缺陷：多页的「市场 / 设备 / 关键词 / 历史」<select> 要么完全没有可访问名，
// 要么把页面标题当成 aria-label（屏幕阅读器读出 "Keyword Overview" 而非「这是市场选择器」），
// 还有 <label> 写了却没和控件关联。读屏用户无法区分这些控件。
// BUG-43 把同一条规则推广到 <input> / <textarea>，并覆盖共享组件 DomainSelect
// （它渲染的 select/input 只是页面 <label> 的相邻兄弟，等于没有名字）。
// 约定：每个控件必须有 aria-label / aria-labelledby，或被 <label> 包裹，或与带 htmlFor 的 <label> 成对。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import EN_MESSAGES from "../../../../../messages/en.json";
import ZH_MESSAGES from "../../../../../messages/zh.json";

const APP_DIR = join(process.cwd(), "src/app/(default)/(dashboard)/app");
const DOMAIN_SELECT = join(process.cwd(), "src/components/dashboard/DomainSelect.tsx");

const PAGES = [
  "keyword-overview/page.tsx",
  "keyword-expand/page.tsx",
  "rank-check/page.tsx",
  "competitors/page.tsx",
  "content/page.tsx",
  "position-tracking/page.tsx",
  "settings/page.tsx",
  "reports/page.tsx",
  "audit/page.tsx",
  "backlinks/page.tsx",
];

const FIELD_TAGS = ["select", "input", "textarea"];

/** 取出每个开标签的属性串（跳过 JSX 表达式里的 `=>`，只在大括号外找闭合 `>`） */
function fieldTags(src: string, tag: string): { attrs: string; before: string }[] {
  const out: { attrs: string; before: string }[] = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let attrs = "";
    while (i < src.length) {
      const ch = src[i];
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      else if (ch === ">" && depth === 0) break;
      attrs += ch;
      i++;
    }
    out.push({ attrs, before: src.slice(Math.max(0, m.index - 220), m.index) });
  }
  return out;
}
const selectTags = (src: string) => fieldTags(src, "select");

/** 控件是否被 <label> 隐式包裹（label 开标签之后、控件之前没有 </label>） */
function wrappedInLabel(before: string): boolean {
  const open = before.lastIndexOf("<label");
  if (open === -1) return false;
  return !before.slice(open).includes("</label>");
}

/** 某文件里所有表单控件的命名情况 */
function unnamedControls(src: string): string[] {
  const labels = new Set([...src.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]));
  const bad: string[] = [];
  for (const tag of FIELD_TAGS) {
    fieldTags(src, tag).forEach(({ attrs, before }, i) => {
      if (/type="hidden"/.test(attrs)) return;
      const named =
        /aria-label=|aria-labelledby=/.test(attrs) ||
        wrappedInLabel(before) ||
        Boolean(attrs.match(/\bid="([^"]+)"/)?.[1] && labels.has(attrs.match(/\bid="([^"]+)"/)![1]));
      if (!named) bad.push(`${tag} #${i + 1}: ${attrs.replace(/\s+/g, " ").trim().slice(0, 70)}`);
    });
  }
  return bad;
}

describe("BUG-42：Dashboard select 可访问名", () => {
  it.each(PAGES)("%s 的每个 select 都有 aria-label 或关联 label", (file) => {
    const src = readFileSync(join(APP_DIR, file), "utf8");
    const labels = new Set([...src.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]));
    const bad: string[] = [];
    selectTags(src).forEach(({ attrs, before }, i) => {
      const hasAria = /aria-label=/.test(attrs);
      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      const labelledById = /aria-labelledby=/.test(attrs);
      const paired = Boolean(id && labels.has(id));
      const implicit = wrappedInLabel(before);
      if (!hasAria && !paired && !labelledById && !implicit) bad.push(`${file} #${i + 1}: ${attrs.trim().slice(0, 60)}`);
    });
    expect(bad).toEqual([]);
  });

  it.each(PAGES)("%s 的每个 htmlFor 都指向同文件内存在的控件 id", (file) => {
    const src = readFileSync(join(APP_DIR, file), "utf8");
    const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const dangling = [...src.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
    expect(dangling).toEqual([]);
  });

  it("市场/设备选择器不再复用页面标题作为可访问名", () => {
    for (const file of ["keyword-overview/page.tsx", "keyword-expand/page.tsx"]) {
      const src = readFileSync(join(APP_DIR, file), "utf8");
      expect(src).toContain('aria-label={t("marketLabel")}');
      expect(src).toContain('aria-label={t("deviceLabel")}');
      expect(src).not.toContain('aria-label={t("title")}');
    }
  });

  it("市场/设备可访问名双语齐备", () => {
    const en = EN_MESSAGES.dashboard.keywords as unknown as Record<string, Record<string, string>>;
    const zh = ZH_MESSAGES.dashboard.keywords as unknown as Record<string, Record<string, string>>;
    for (const ns of ["overview", "expand"]) {
      for (const key of ["marketLabel", "deviceLabel"]) {
        expect(en[ns][key], `EN ${ns}.${key}`).toBeTruthy();
        expect(zh[ns][key], `ZH ${ns}.${key}`).toBeTruthy();
      }
    }
    expect(en.overview.marketLabel).toBe("Search market");
    expect(zh.overview.marketLabel).toBe("搜索市场");
  });

  it("rank-check 设备切换组有分组语义与按压状态", () => {
    const src = readFileSync(join(APP_DIR, "rank-check/page.tsx"), "utf8");
    expect(src).toContain('role="group"');
    expect(src).toContain("aria-pressed={device === d}");
    expect(src).toContain('htmlFor="rc-region"');
    expect(src).toContain('id="rc-region"');
  });
});

describe("BUG-43：输入框 / 文本域 / 共享域名选择器的可访问名", () => {
  it("每个 Dashboard 页面的 input/textarea/select 都有可访问名", () => {
    const pages = readdirSync(APP_DIR, { recursive: true })
      .filter((f) => typeof f === "string" && f.endsWith("page.tsx"))
      .map((f) => String(f));
    expect(pages.length).toBeGreaterThanOrEqual(14);
    const bad: string[] = [];
    for (const rel of pages) {
      const src = readFileSync(join(APP_DIR, rel), "utf8");
      for (const item of unnamedControls(src)) bad.push(`${rel} ${item}`);
    }
    expect(bad).toEqual([]);
  });

  it("DomainSelect 的两个分支（下拉与手动输入）都自带可访问名", () => {
    const src = readFileSync(DOMAIN_SELECT, "utf8");
    expect(src).toContain('aria-label={label ?? t("selectLabel")}');
    expect(src).toContain('aria-label={label ?? t("inputLabel")}');
    // 组件不渲染 <label htmlFor>：可见标签在各页面里只是相邻兄弟，名字必须由 aria-label 提供
    expect(src).not.toContain("htmlFor=");
  });

  it("DomainSelect 与 GitHub 连接表单的可访问名文案双语齐备", () => {
    type Table = Record<string, Record<string, Record<string, Record<string, string>>>>;
    const enDs = (EN_MESSAGES as unknown as Table).dashboard.shared.domainSelect;
    const zhDs = (ZH_MESSAGES as unknown as Table).dashboard.shared.domainSelect;
    for (const key of ["selectLabel", "inputLabel"]) {
      expect(enDs[key], `EN domainSelect.${key}`).toBeTruthy();
      expect(zhDs[key], `ZH domainSelect.${key}`).toBeTruthy();
    }
    expect(enDs.selectLabel).toBe("Project domain");
    expect(zhDs.selectLabel).toBe("项目域名");

    const enGh = (EN_MESSAGES as unknown as Table).dashboard.opportunities.github;
    const zhGh = (ZH_MESSAGES as unknown as Table).dashboard.opportunities.github;
    for (const key of ["ownerLabel", "repoLabel", "tokenLabel"]) {
      expect(enGh[key], `EN github.${key}`).toBeTruthy();
      expect(zhGh[key], `ZH github.${key}`).toBeTruthy();
      // 名字必须是字段名，不能与 placeholder 同义复用（placeholder 只是浏览器的最后兜底）
      expect(enGh[key]).not.toBe(enGh[key.replace("Label", "Placeholder")]);
    }
    const opp = readFileSync(join(APP_DIR, "opportunities/page.tsx"), "utf8");
    for (const key of ["ownerLabel", "repoLabel", "tokenLabel"]) {
      expect(opp).toContain(`aria-label={t("github.${key}")}`);
    }
  });

  it("页面级可见 label 与控件成对关联（rank-check / content / position-tracking / reports）", () => {
    const pairs: Record<string, string[]> = {
      "rank-check/page.tsx": ["rc-keyword", "rc-region"],
      "content/page.tsx": ["content-url", "content-keywords"],
      "position-tracking/page.tsx": ["pt-add-keyword", "pt-group-name", "pt-group-desc", "pt-region-select", "pt-group-select"],
      "reports/page.tsx": ["report-email"],
    };
    for (const [file, ids] of Object.entries(pairs)) {
      const src = readFileSync(join(APP_DIR, file), "utf8");
      for (const id of ids) {
        expect(src, `${file} #${id}`).toContain(`htmlFor="${id}"`);
        expect(src, `${file} control #${id}`).toContain(`id="${id}"`);
      }
    }
  });
});

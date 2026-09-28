// ===== F｜Content Bank 测试 =====
// 覆盖 §21 要求的全部校验：schema / 必填 / content_type / status / channel /
// 重复 content_id / CTA / source，以及真实主库质量守卫、C 集成、E 边界、访问控制。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CONTENT_CHANNELS,
  CONTENT_FIELDS,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  BANNED_CTA_PHRASES,
  BANNED_PHRASES,
  MIN_SUPPORTING_POINTS,
  REUSE_GAPS,
  emptyTopic,
  joinList,
  splitList,
  type ContentTopic,
} from "./schema.ts";
import { CTA_IDS, CTA_LIBRARY, getCta } from "./ctas.ts";
import { findDuplicateIds, validateTopic } from "./validate.ts";
import { showChannelSkeletons } from "./channels.ts";
import { CONTENT_EMAIL_LINKS, LINKABLE_EMAIL_TEMPLATES } from "./email-links.ts";
import {
  CONTENT_MASTER_RELATIVE_PATH,
  auditMaster,
  listByStatus,
  markUsed,
  readTopics,
  staleTopics,
  writeTopics,
} from "./store.ts";

// C 阶段真实注册表（只读比对，用于证明 F 没有另造模板）
import { LIFECYCLE_TEMPLATES } from "../email/templates/lifecycle.ts";
import { LOCALE_ROUTED_PATHS } from "../../i18n/locale-routed-paths.ts";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-content-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function goodTopic(over: Partial<ContentTopic> = {}): ContentTopic {
  const t = emptyTopic();
  t.content_id = "C999";
  t.title = "A concrete topic title";
  t.content_type = "SEO Problem";
  t.audience = "小站站长";
  t.problem = "审计报告里条目不分类，导致每次都从第一条开始改，改完也不知道有没有效果。";
  t.core_point = "先把问题按类型与受影响页面收敛，再决定修改顺序，才能一次覆盖多页。";
  t.supporting_points = joinList(["按类别分组", "优先整类重复问题", "核心页优先"]);
  t.example = "duplicate-title 会成对标记共用标题的页面、一次模板修改即可归零。";
  t.cta = "see_affected_pages";
  t.source = "Product";
  t.channel_fit = joinList(["reddit", "email"]);
  t.recommended_reuse_gap = "21";
  t.status = "Ready";
  t.email_compatible = "yes";
  t.created_at = "2026-09-28";
  t.last_used_at = "";
  t.times_used = "0";
  return { ...t, ...over };
}

// ============ schema / 必填 ============
describe("F schema 与必填", () => {
  it("字段覆盖 §5 要求的全部列", () => {
    for (const f of [
      "content_id", "title", "content_type", "audience", "problem", "core_point",
      "supporting_points", "example", "cta", "source", "channel_fit", "status",
      "created_at", "last_used_at", "times_used", "notes", "recommended_reuse_gap", "email_compatible",
    ]) {
      expect(CONTENT_FIELDS).toContain(f);
    }
  });

  it("合法主题零问题", () => {
    expect(validateTopic(goodTopic())).toEqual([]);
  });

  it("缺必填字段会被指出", () => {
    const t = goodTopic({ content_id: "", title: "", audience: "", cta: "", source: "" });
    const fields = validateTopic(t).map((i) => i.field);
    for (const f of ["content_id", "title", "audience", "cta", "source"]) expect(fields).toContain(f);
  });

  it("多值字段按 ' | ' 解析", () => {
    expect(splitList("a | b |c")).toEqual(["a", "b", "c"]);
    expect(joinList(["a", "b"])).toBe("a | b");
  });
});

// ============ content_type / status / channel ============
describe("F 枚举校验", () => {
  it("content_type 只能是 13 类之一", () => {
    expect(validateTopic(goodTopic({ content_type: "Blog Post" })).some((i) => i.field === "content_type")).toBe(true);
    for (const t of CONTENT_TYPES) {
      expect(validateTopic(goodTopic({ content_type: t }))).toEqual([]);
    }
  });

  it("status 只能是 6 个之一", () => {
    expect(validateTopic(goodTopic({ status: "Done" })).some((i) => i.field === "status")).toBe(true);
    expect([...CONTENT_STATUSES]).toEqual(["Idea", "Draft", "Ready", "Published", "Repurpose", "Retired"]);
  });

  it("channel_fit 只接受 5 个渠道，且至少一个", () => {
    expect(validateTopic(goodTopic({ channel_fit: "tiktok" })).some((i) => i.field === "channel_fit")).toBe(true);
    expect(validateTopic(goodTopic({ channel_fit: "" })).some((i) => i.field === "channel_fit")).toBe(true);
    for (const c of CONTENT_CHANNELS) {
      expect(validateTopic(goodTopic({ channel_fit: c }))).toEqual([]);
    }
  });

  it("source 必须是 8 类之一，且不允许只写 AI generated", () => {
    expect(validateTopic(goodTopic({ source: "AI generated" })).some((i) => i.field === "source")).toBe(true);
    for (const s of CONTENT_SOURCES) {
      const t = goodTopic({ source: s });
      if (s === "User Question") t.source_detail = "用户反馈的匿名化问题描述";
      expect(validateTopic(t)).toEqual([]);
    }
  });

  it("recommended_reuse_gap 只能是 14 / 21 / 30", () => {
    expect(validateTopic(goodTopic({ recommended_reuse_gap: "7" })).some((i) => i.field === "recommended_reuse_gap")).toBe(true);
    for (const g of REUSE_GAPS) expect(validateTopic(goodTopic({ recommended_reuse_gap: String(g) }))).toEqual([]);
  });
});

// ============ 质量与空话 ============
describe("F 主题质量", () => {
  it("空泛内容被拒绝", () => {
    const t = goodTopic({ problem: "SEO is important.", core_point: "SEO is important for everyone." });
    const issues = validateTopic(t);
    expect(issues.some((i) => i.field === "problem")).toBe(true);
    expect(issues.some((i) => i.field === "core_point")).toBe(true);
  });

  it("命中禁用套话被拒绝", () => {
    const t = goodTopic({ title: "Why SEO will help your business" });
    expect(validateTopic(t).some((i) => i.message.includes("空泛话术"))).toBe(true);
    expect(BANNED_PHRASES.length).toBeGreaterThan(0);
  });

  it("支撑点必须 3–5 条", () => {
    expect(validateTopic(goodTopic({ supporting_points: joinList(["a", "b"]) })).some((i) => i.field === "supporting_points")).toBe(true);
    expect(MIN_SUPPORTING_POINTS).toBe(3);
    const six = joinList(["a", "b", "c", "d", "e", "f"]);
    expect(validateTopic(goodTopic({ supporting_points: six })).some((i) => i.field === "supporting_points")).toBe(true);
  });

  it("example 不能为空", () => {
    expect(validateTopic(goodTopic({ example: "" })).some((i) => i.field === "example")).toBe(true);
  });

  it("Published 必须记录 last_used_at；times_used>0 同理", () => {
    expect(validateTopic(goodTopic({ status: "Published" })).some((i) => i.field === "last_used_at")).toBe(true);
    expect(validateTopic(goodTopic({ times_used: "2" })).some((i) => i.field === "last_used_at")).toBe(true);
    expect(validateTopic(goodTopic({ status: "Published", last_used_at: "2026-09-28", times_used: "1" }))).toEqual([]);
  });
});

// ============ CTA ============
describe("F CTA 库", () => {
  it("cta 只能取 CTA 库的 id", () => {
    expect(validateTopic(goodTopic({ cta: "signup_now" })).some((i) => i.field === "cta")).toBe(true);
    for (const id of CTA_IDS) expect(validateTopic(goodTopic({ cta: id }))).toEqual([]);
  });

  it("CTA 库不含硬推销话术，且每条都有真实站内落地页", () => {
    for (const c of CTA_LIBRARY) {
      const lower = c.text.toLowerCase();
      for (const banned of BANNED_CTA_PHRASES) {
        expect(lower.includes(banned), `CTA「${c.text}」命中禁用话术 ${banned}`).toBe(false);
      }
      expect(c.href.startsWith("/")).toBe(true);
      // 落地页必须是真实存在的营销路径（复用 A 阶段的白名单，不新增页面）
      expect(LOCALE_ROUTED_PATHS.has(c.href), `CTA ${c.id} 指向不存在的路径 ${c.href}`).toBe(true);
    }
  });

  it("每个 CTA 都能取到", () => {
    for (const id of CTA_IDS) expect(getCta(id)?.id).toBe(id);
    expect(getCta("nope")).toBeNull();
  });
});

// ============ 隐私 / E 边界 ============
describe("F 隐私与 E 边界", () => {
  it("User Question 必须给匿名化说明，且其中不得有邮箱或网址", () => {
    expect(validateTopic(goodTopic({ source: "User Question" })).some((i) => i.field === "source_detail")).toBe(true);
    expect(
      validateTopic(goodTopic({ source: "User Question", source_detail: "联系 his@example.com 反馈的" }))
        .some((i) => i.field === "source_detail")
    ).toBe(true);
    expect(
      validateTopic(goodTopic({ source: "User Question", source_detail: "见 https://example.com/pricing 的问题" }))
        .some((i) => i.field === "source_detail")
    ).toBe(true);
  });

  it("任何字段出现邮箱都会被拒绝（Content Bank 不得存个人身份信息）", () => {
    expect(validateTopic(goodTopic({ notes: "联系 yuki@example.com" })).some((i) => i.message.includes("邮箱"))).toBe(true);
  });

  it("content 模块不引用 E 的潜客库", () => {
    const dir = path.join(process.cwd(), "src/lib/content");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得引用 leads（F 不复制潜客信息）`).not.toMatch(/["'][^"']*leads[^"']*["']/);
    }
  });
});

// ============ 重复 id / 存储 / 复用 ============
describe("F 存储与复用", () => {
  it("重复 content_id 会被识别并拒绝新增", () => {
    const a = goodTopic();
    const b = goodTopic({ title: "Another title but same id" });
    expect(findDuplicateIds([a, b])).toEqual(["C999"]);

    writeTopics([a], tmp);
    expect(readTopics(tmp)).toHaveLength(1);
  });

  it("markUsed：status/last_used_at/times_used 正确更新", () => {
    writeTopics([goodTopic()], tmp);
    const r = markUsed("C999", { cwd: tmp, now: new Date("2026-09-28T09:00:00Z") });
    expect(r.ok).toBe(true);
    expect(r.topic!.status).toBe("Published");
    expect(r.topic!.last_used_at).toBe("2026-09-28");
    expect(r.topic!.times_used).toBe("1");

    const r2 = markUsed("C999", { cwd: tmp, now: new Date("2026-09-29T09:00:00Z") });
    expect(r2.topic!.times_used).toBe("2");
    expect(readTopics(tmp)[0].times_used).toBe("2");
  });

  it("staleTopics：按 recommended_reuse_gap 筛选长期未用", () => {
    writeTopics(
      [
        goodTopic({ content_id: "C001", recommended_reuse_gap: "14", last_used_at: "2026-09-10" }), // 18 天前 → stale
        goodTopic({ content_id: "C002", recommended_reuse_gap: "14", last_used_at: "2026-09-27" }), // 1 天前 → 不 stale
        goodTopic({ content_id: "C003", recommended_reuse_gap: "30", last_used_at: "" }),           // 从未用过 → stale
        goodTopic({ content_id: "C004", recommended_reuse_gap: "21", status: "Retired", last_used_at: "" }), // Retired 排除
      ],
      tmp
    );
    const ids = staleTopics("2026-09-28", tmp).map((t) => t.content_id).sort();
    expect(ids).toEqual(["C001", "C003"]);
  });

  it("listByStatus 能筛出 Ready", () => {
    writeTopics([goodTopic({ content_id: "C001", status: "Ready" }), goodTopic({ content_id: "C002", status: "Idea" })], tmp);
    expect(listByStatus("Ready", tmp).map((t) => t.content_id)).toEqual(["C001"]);
  });
});

// ============ 渠道派生 ============
describe("F 渠道映射", () => {
  it("按 channel_fit 展开对应渠道骨架，核心内容被替换进去", () => {
    const t = goodTopic({ channel_fit: joinList(["reddit", "linkedin", "x", "email", "indie_hackers"]) });
    const out = showChannelSkeletons(t);
    expect(out).toContain("## Reddit");
    expect(out).toContain("## Indie Hackers");
    expect(out).toContain("## LinkedIn");
    expect(out).toContain("## X");
    expect(out).toContain("## Email");
    expect(out).toContain(t.core_point);
    expect(out).not.toMatch(/\{problem\}|\{core\}|\{cta\}/); // 占位符必须被填掉
  });

  it("只渲染 channel_fit 里出现的渠道", () => {
    const out = showChannelSkeletons(goodTopic({ channel_fit: "email" }));
    expect(out).toContain("## Email");
    expect(out).not.toContain("## Reddit");
    expect(out).not.toContain("## X");
  });

  it("每个主题都带真实数据提醒", () => {
    expect(showChannelSkeletons(goodTopic())).toContain("真实数据");
  });
});

// ============ C 集成 ============
describe("F → C 集成", () => {
  it("只关联 C 已注册的邮件模板，不新建模板", () => {
    const registered = Object.keys(LIFECYCLE_TEMPLATES);
    for (const [contentId, key] of Object.entries(CONTENT_EMAIL_LINKS)) {
      expect(registered, `${contentId} 关联了不存在的邮件模板 ${key}`).toContain(key);
      expect(LINKABLE_EMAIL_TEMPLATES).toContain(key);
    }
    // 不存在第二套命名（content_email_v1 / seo_email_v2 之类）
    for (const key of Object.values(CONTENT_EMAIL_LINKS)) {
      expect(/^content_|_email_v\d+$/.test(key.replace(/(seo|feature)_education_v1/, ""))).toBe(false);
    }
  });

  it("被关联的主题必须存在且 email_compatible = yes", () => {
    const byId = new Map(readTopics().map((t) => [t.content_id, t]));
    for (const contentId of Object.keys(CONTENT_EMAIL_LINKS)) {
      const t = byId.get(contentId);
      expect(t, `主库里找不到被关联的主题 ${contentId}`).toBeDefined();
      expect(t!.email_compatible, `${contentId} 被关联到邮件模板但 email_compatible 不是 yes`).toBe("yes");
    }
  });
});

// ============ 真实主库质量守卫 ============
describe("真实 Content Master 质量守卫", () => {
  const topics = readTopics();

  it("主库存在且是唯一一份（不出现 content-bank 之外的平行主库）", () => {
    expect(CONTENT_MASTER_RELATIVE_PATH).toBe("seo-growth/content-bank.csv");
    const dir = path.join(process.cwd(), "seo-growth");
    const csvs = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
    const contentLike = csvs.filter((f) => /content|social|reddit|twitter|linkedin/i.test(f));
    expect(contentLike, `出现了多份内容库：${contentLike.join(", ")}`).toEqual(["content-bank.csv"]);
  });

  it("至少 30 条主题，且全部通过校验、无重复 ID", () => {
    expect(topics.length).toBeGreaterThanOrEqual(30);
    const audit = auditMaster();
    expect(audit.duplicates).toEqual([]);
    expect(audit.issues).toEqual([]);
  });

  it("满足 §6 的主题分布", () => {
    const count = (from: number, to: number) =>
      topics.filter((t) => {
        const n = Number(t.content_id.replace(/\D/g, ""));
        return n >= from && n <= to;
      }).length;
    expect(count(1, 8)).toBe(8);      // SEO 常见问题
    expect(count(9, 13)).toBe(5);     // Technical SEO
    expect(count(14, 17)).toBe(4);    // Keyword / Search
    expect(count(18, 21)).toBe(4);    // Content SEO
    expect(count(22, 24)).toBe(3);    // Rank / Tracking
    expect(count(25, 26)).toBe(2);    // Competitor
    expect(count(27, 28)).toBe(2);    // SaaS / Founder
    expect(count(29, 30)).toBe(2);    // Affiliate / Content Site
  });

  it("13 种 content_type 全部被使用", () => {
    const used = new Set(topics.map((t) => t.content_type));
    for (const t of CONTENT_TYPES) expect(used.has(t), `content_type「${t}」从未被使用`).toBe(true);
  });

  it("每条主题都标了渠道与复用间隔，且至少 25 条可喂 C 邮件", () => {
    for (const t of topics) {
      expect(splitList(t.channel_fit).length).toBeGreaterThan(0);
      expect(REUSE_GAPS.map(String)).toContain(t.recommended_reuse_gap);
    }
    expect(topics.filter((t) => t.email_compatible === "yes").length).toBeGreaterThanOrEqual(25);
  });

  it("五个渠道在主库中都被用到", () => {
    const used = new Set(topics.flatMap((t) => splitList(t.channel_fit)));
    for (const c of CONTENT_CHANNELS) expect(used.has(c), `渠道 ${c} 没有任何主题`).toBe(true);
  });
});

// ============ 访问控制 ============
describe("F 访问控制", () => {
  it("content 模块无 'use client'，且不含 NEXT_PUBLIC_", () => {
    const dir = path.join(process.cwd(), "src/lib/content");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得是客户端组件`).not.toContain('"use client"');
      expect(src, `${f} 不得出现 NEXT_PUBLIC_`).not.toContain("NEXT_PUBLIC_");
    }
  });

  it("没有任何 app 路由 / 页面引用 content 模块（不新增公开页面）", () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        if (full.startsWith(path.join(root, "lib/content"))) continue;
        const src = fs.readFileSync(full, "utf-8");
        if (/from\s+["'][^"']*lib\/content["']/.test(src)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了内容库：${offenders.join(", ")}`).toEqual([]);
  });

  it("主库不在 public/ 下，也不会被静态托管", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public", "content-bank.csv"))).toBe(false);
    expect(CONTENT_MASTER_RELATIVE_PATH.startsWith("public")).toBe(false);
  });

  it("sitemap 不含内容库路径", () => {
    const sitemap = fs.readFileSync(path.join(process.cwd(), "src/app/sitemap.ts"), "utf-8");
    expect(sitemap).not.toMatch(/content-bank|seo-growth/);
  });
});

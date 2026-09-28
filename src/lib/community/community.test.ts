// ===== G｜社区基地 测试 =====
// 覆盖 §20：platform/status 枚举、content_id 必须存在、post_id 去重、
// Published 必须有 URL、UTM 生成、无隐私数据、不引用 E；
// 另加：Community Master 质量守卫、F/B 一致性、Product Hunt 素材一致性、访问控制。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCOUNT_STATUSES,
  CTA_LEVELS,
  FIT_LEVELS,
  MASTER_FIELDS,
  PLATFORMS,
  PLATFORM_LABEL,
  PLATFORM_UTM_SOURCE,
  POST_FIELDS,
  POST_STATUSES,
  PROFILE_STATUSES,
  SELF_PROMO_LEVELS,
  BANNED_PROMO_PHRASES,
  emptyAccount,
  emptyPost,
  isAccountStatus,
  isPlatform,
  isPostStatus,
  isProfileStatus,
  joinList,
  splitList,
  type CommunityAccount,
  type CommunityPost,
} from "./schema.ts";
import { PLATFORM_FIT, PLATFORM_RULES, matrixCoversAllTypes, strongTypesFor } from "./rules.ts";
import { findDuplicatePlatforms, findDuplicatePostIds, validateAccount, validatePost } from "./validate.ts";
import { buildCommunityUrl, campaignFor, isCanonicalSourceFor } from "./utm.ts";
import {
  COMMUNITY_MASTER_RELATIVE_PATH,
  COMMUNITY_POSTS_RELATIVE_PATH,
  addPost,
  auditCommunity,
  markPublished,
  postsForContent,
  readAccounts,
  readPosts,
  writeAccounts,
} from "./store.ts";

// 只读比对：F 的内容库与 B 的 attribution（证明 G 没有另造一套）
import { CONTENT_TYPES } from "../content/schema.ts";
import { CTA_IDS } from "../content/ctas.ts";
import { readTopics } from "../content/store.ts";
import { CANONICAL_SOURCES } from "../analytics/sources.ts";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-community-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function goodAccount(over: Partial<CommunityAccount> = {}): CommunityAccount {
  const a = emptyAccount();
  a.platform = "reddit";
  a.account_name = "u/seeo (planned)";
  a.profile_url = "";
  a.profile_status = "not_created";
  a.status = "Planned";
  a.audience = "r/SEO 的站长";
  a.purpose = "参与排障讨论";
  a.positioning = "Affordable SEO tools for site owners, founders, and SEO practitioners.";
  a.bio = "SeeO — technical audits, rank tracking and keyword research in one workbench.";
  a.website = "https://www.seeo.asia";
  a.primary_cta = "free_audit";
  a.content_types = joinList(["SEO Problem", "Technical SEO"]);
  a.posting_frequency = "每周 1–2 次";
  a.rules_checked_at = "";
  a.self_promo_notes = "Needs Manual Check — 尚未核对";
  a.link_policy = "Needs Manual Check";
  a.frequency_notes = "不重复同一 subreddit";
  return { ...a, ...over };
}

function goodPost(over: Partial<CommunityPost> = {}): CommunityPost {
  const p = emptyPost();
  p.post_id = "C005-R1";
  p.content_id = "C005";
  p.platform = "reddit";
  p.community = "r/SEO";
  p.status = "Draft";
  return { ...p, ...over };
}

// ============ 枚举 ============
describe("G1/G2 platform 与 status 枚举", () => {
  it("只覆盖 5 个渠道，多一个都不要", () => {
    expect([...PLATFORMS]).toEqual(["reddit", "indie_hackers", "linkedin", "x", "product_hunt"]);
    expect(Object.keys(PLATFORM_LABEL)).toEqual([...PLATFORMS]);
    for (const p of PLATFORMS) expect(isPlatform(p)).toBe(true);
    expect(isPlatform("tiktok")).toBe(false);
    expect(isPlatform("threads")).toBe(false);
  });

  it("账号状态 / 资料状态 / 帖子状态枚举完整", () => {
    expect([...ACCOUNT_STATUSES]).toEqual(["Planned", "Ready", "Active", "Paused"]);
    expect([...PROFILE_STATUSES]).toEqual(["not_created", "created", "needs_manual_check"]);
    expect([...POST_STATUSES]).toEqual(["Draft", "Ready", "Published", "Removed", "Archived"]);
    for (const s of ACCOUNT_STATUSES) expect(isAccountStatus(s)).toBe(true);
    for (const s of PROFILE_STATUSES) expect(isProfileStatus(s)).toBe(true);
    for (const s of POST_STATUSES) expect(isPostStatus(s)).toBe(true);
    expect(isAccountStatus("Live")).toBe(false);
    expect(isPostStatus("Deleted")).toBe(false);
  });

  it("自我推广等级包含 needs_manual_check（不允许默认假设允许）", () => {
    expect([...SELF_PROMO_LEVELS]).toContain("needs_manual_check");
    expect([...CTA_LEVELS]).toEqual(["none", "soft", "direct"]);
    expect([...FIT_LEVELS]).toEqual(["strong", "ok", "weak"]);
  });

  it("字段表覆盖 §4 与 §13 要求", () => {
    for (const f of ["platform", "account_name", "profile_url", "profile_status", "audience", "purpose", "positioning", "bio", "website", "primary_cta", "content_types", "posting_frequency", "notes", "status", "rules_checked_at", "self_promo_notes", "link_policy", "frequency_notes"]) {
      expect(MASTER_FIELDS).toContain(f);
    }
    expect([...POST_FIELDS]).toEqual(["post_id", "content_id", "platform", "community", "published_at", "url", "status", "cta", "notes"]);
  });
});

// ============ 资料定位 ============
describe("G3 profile positioning", () => {
  it("合法账号零问题；每个平台的 Bio 互不相同", () => {
    expect(validateAccount(goodAccount())).toEqual([]);
    const bios = readAccounts().map((a) => a.bio);
    expect(new Set(bios).size).toBe(bios.length);
  });

  it("定位句在所有平台统一", () => {
    const positions = new Set(readAccounts().map((a) => a.positioning));
    expect(positions.size).toBe(1);
  });

  it("缺必填 + 非法枚举被指出", () => {
    const fields = validateAccount(goodAccount({ account_name: "", bio: "", primary_cta: "", status: "Live" })).map((i) => i.field);
    for (const f of ["account_name", "bio", "primary_cta", "status"]) expect(fields).toContain(f);
  });

  it("CTA 必须来自 F 的 CTA 库", () => {
    const bad = validateAccount(goodAccount({ primary_cta: "signup_now" }));
    expect(bad.some((i) => i.field === "primary_cta")).toBe(true);
    for (const id of CTA_IDS) expect(validateAccount(goodAccount({ primary_cta: id }))).toEqual([]);
  });

  it("无证据的夸大宣传被拒绝", () => {
    for (const phrase of ["The Best SEO Tool", "#1 SEO platform", "revolutionary SEO"]) {
      const issues = validateAccount(goodAccount({ bio: phrase }));
      expect(issues.some((i) => i.message.includes("无证据宣传")), `${phrase} 应被拒绝`).toBe(true);
    }
    expect(BANNED_PROMO_PHRASES.length).toBeGreaterThan(0);
  });

  it("不得出现邮箱与凭据", () => {
    expect(validateAccount(goodAccount({ notes: "联系 me@example.com" })).some((i) => i.field === "notes")).toBe(true);
    expect(validateAccount(goodAccount({ notes: "api_key: abc123" })).some((i) => i.field === "notes")).toBe(true);
  });
});

// ============ Playbook / 契合度 ============
describe("G4–G8 playbook 与契合度矩阵", () => {
  it("矩阵覆盖 F 的全部 13 种内容类型（每个平台）", () => {
    for (const p of PLATFORMS) {
      expect(matrixCoversAllTypes(p), `${p} 矩阵不完整`).toBe(true);
      for (const t of CONTENT_TYPES) expect(PLATFORM_FIT[p][t]).toBeDefined();
    }
  });

  it("矩阵里的类型名必须与 F 的 content_type 完全一致（否则是第二套分类）", () => {
    for (const p of PLATFORMS) {
      for (const t of Object.keys(PLATFORM_FIT[p])) {
        expect(CONTENT_TYPES, `${p} 用了 F 里不存在的类型 ${t}`).toContain(t);
      }
    }
  });

  it("每个平台都有 strong 类型，且规则结构完整", () => {
    for (const p of PLATFORMS) {
      expect(strongTypesFor(p).length, `${p} 没有 strong 类型`).toBeGreaterThan(0);
      const r = PLATFORM_RULES[p];
      expect(r.platform).toBe(p);
      expect(r.audienceFocus.length).toBeGreaterThan(0);
      expect(r.frequencyNote.length).toBeGreaterThan(0);
    }
  });

  it("社区 CTA 强度不使用 direct（第一目标是访问/审计/注册，不是付费）", () => {
    for (const p of PLATFORMS) {
      for (const [type, cell] of Object.entries(PLATFORM_FIT[p])) {
        expect(cell.cta, `${p} / ${type} 使用了 direct CTA`).not.toBe("direct");
      }
    }
  });

  it("五个 playbook 文件存在，且 Product Hunt 素材与站上描述逐字一致", () => {
    const file = path.join(process.cwd(), "seo-growth/community/PRODUCT_HUNT_KIT.md");
    expect(fs.existsSync(file)).toBe(true);
    const kit = fs.readFileSync(file, "utf-8");
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/en.json"), "utf-8")) as {
      meta: { siteDescription: string };
    };
    expect(kit).toContain(messages.meta.siteDescription);

    const playbook = path.join(process.cwd(), "seo-growth/community/PLAYBOOK.md");
    expect(fs.existsSync(playbook)).toBe(true);
    const pb = fs.readFileSync(playbook, "utf-8");
    for (const label of ["Reddit", "Indie Hackers", "LinkedIn", "Product Hunt"]) {
      expect(pb).toContain(label);
    }
    // 不重复定义写作格式：必须指回 F
    expect(pb).toContain("CHANNEL_PLAYBOOK");
  });
});

// ============ F 集成 ============
describe("G9 F integration", () => {
  it("每个平台的内容类型都是 F 真实存在的类型", () => {
    for (const a of readAccounts()) {
      const types = splitList(a.content_types);
      expect(types.length).toBeGreaterThan(0);
      for (const t of types) expect(CONTENT_TYPES).toContain(t);
    }
  });

  it("content_id 必须存在于 F 的 Content Master", () => {
    const known = readTopics().map((t) => t.content_id);
    expect(known.length).toBeGreaterThanOrEqual(30);
    expect(validatePost(goodPost({ content_id: "C999" }), known).some((i) => i.field === "content_id")).toBe(true);
    expect(validatePost(goodPost({ content_id: "" }), known).some((i) => i.field === "content_id")).toBe(true);
    expect(validatePost(goodPost({ content_id: known[0] }), known)).toEqual([]);
  });

  it("登记帖子时后端同样校验 content_id（不存在则拒绝）", () => {
    writeAccounts(readAccounts(), tmp);
    fs.mkdirSync(path.join(tmp, "seo-growth"), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "seo-growth/content-bank.csv"),
      path.join(tmp, "seo-growth/content-bank.csv")
    );
    const bad = addPost(goodPost({ content_id: "NOPE" }), { cwd: tmp });
    expect(bad.ok).toBe(false);
    expect(bad.reasons?.join(" ")).toContain("F 的 Content Master 里不存在 NOPE");

    // 对照：真实存在的 content_id 可以登记
    const ok = addPost(goodPost({ content_id: "C005" }), { cwd: tmp });
    expect(ok.ok).toBe(true);
  });
});

// ============ B attribution ============
describe("G10 B attribution", () => {
  it("每个平台的 utm_source 都是 B 认可的 canonical source", () => {
    for (const p of PLATFORMS) {
      expect(isCanonicalSourceFor(p), `${p} 的 source 不在 B 的集合里`).toBe(true);
      expect(CANONICAL_SOURCES).toContain(PLATFORM_UTM_SOURCE[p]);
    }
    expect(PLATFORM_UTM_SOURCE.indie_hackers).toBe("indiehackers");
    expect(PLATFORM_UTM_SOURCE.product_hunt).toBe("producthunt");
  });

  it("community 用 medium/campaign=community；product hunt 用 launch", () => {
    for (const p of PLATFORMS) {
      const c = campaignFor(p);
      if (p === "product_hunt") {
        expect(c.medium).toBe("launch");
        expect(c.campaign).toBe("launch");
      } else {
        expect(c.medium).toBe("community");
        expect(c.campaign).toBe("community");
      }
    }
  });

  it("生成的链接带齐四个参数，且能回溯 content_id", () => {
    for (const p of PLATFORMS) {
      const url = buildCommunityUrl({ platform: p, path: "/features/seo-audit", contentId: "C005" });
      const u = new URL(url);
      expect(u.searchParams.get("utm_source")).toBe(PLATFORM_UTM_SOURCE[p]);
      expect(u.searchParams.get("utm_medium")).toBe(campaignFor(p).medium);
      expect(u.searchParams.get("utm_campaign")).toBe(campaignFor(p).campaign);
      expect(u.searchParams.get("utm_content")).toBe("C005");
      expect(u.pathname).toBe("/features/seo-audit");
    }
  });

  it("不传 content_id 时不产生空的 utm_content", () => {
    const url = buildCommunityUrl({ platform: "x", path: "/" });
    expect(url).not.toContain("utm_content=");
  });

  it("G 不建立第二套 analytics（不出现自造的 source 常量）", () => {
    const dir = path.join(process.cwd(), "src/lib/community");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得自己定义 source 集合`).not.toMatch(/CANONICAL_SOURCES\s*=/);
    }
  });
});

// ============ 发布记录 ============
describe("G11 publishing record", () => {
  it("post_id 重复被拒绝", () => {
    expect(findDuplicatePostIds([goodPost(), goodPost({ community: "r/TechSEO" })])).toEqual(["C005-R1"]);
  });

  it("Published 必须有 URL 与日期", () => {
    expect(validatePost(goodPost({ status: "Published" }), ["C005"]).some((i) => i.field === "url")).toBe(true);
    expect(
      validatePost(goodPost({ status: "Published", url: "https://www.reddit.com/r/SEO/comments/x" }), ["C005"])
        .some((i) => i.field === "published_at")
    ).toBe(true);
    expect(
      validatePost(
        goodPost({ status: "Published", url: "https://www.reddit.com/r/SEO/comments/x", published_at: "2026-09-28" }),
        ["C005"]
      )
    ).toEqual([]);
  });

  it("Removed 必须记录原因（不静默重发）", () => {
    expect(validatePost(goodPost({ status: "Removed" }), ["C005"]).some((i) => i.field === "notes")).toBe(true);
    expect(validatePost(goodPost({ status: "Removed", notes: "被 subreddit 规则移除" }), ["C005"])).toEqual([]);
  });

  it("URL 必须是完整链接；cta 必须来自 F 库", () => {
    expect(validatePost(goodPost({ status: "Published", url: "reddit.com/x", published_at: "2026-09-28" }), ["C005"]).some((i) => i.field === "url")).toBe(true);
    expect(validatePost(goodPost({ cta: "buy_now" }), ["C005"]).some((i) => i.field === "cta")).toBe(true);
    expect(validatePost(goodPost({ cta: "check_site" }), ["C005"])).toEqual([]);
  });

  it("完整流转：登记 → 回填 URL → 可按 content_id 追溯", () => {
    // 用临时目录，且把 F 的主库一起带过去（content_id 校验需要）
    fs.mkdirSync(path.join(tmp, "seo-growth"), { recursive: true });
    const src = path.join(process.cwd(), "seo-growth/content-bank.csv");
    fs.copyFileSync(src, path.join(tmp, "seo-growth/content-bank.csv"));

    const r1 = addPost(goodPost(), { cwd: tmp });
    expect(r1.ok).toBe(true);
    expect(readPosts(tmp)).toHaveLength(1);

    const r2 = addPost(goodPost(), { cwd: tmp });
    expect(r2.ok).toBe(false);
    expect(r2.reasons?.join(" ")).toContain("post_id 已存在");

    const r3 = markPublished("C005-R1", "https://www.reddit.com/r/SEO/comments/abc", { cwd: tmp, now: new Date("2026-09-28T00:00:00Z") });
    expect(r3.ok).toBe(true);
    expect(r3.post!.status).toBe("Published");
    expect(r3.post!.published_at).toBe("2026-09-28");

    const traced = postsForContent("C005", tmp);
    expect(traced).toHaveLength(1);
    expect(traced[0].url).toContain("reddit.com");
  });

  it("同一 F 主题可追溯到多个平台（C005 → Reddit / LinkedIn / X）", () => {
    fs.mkdirSync(path.join(tmp, "seo-growth"), { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), "seo-growth/content-bank.csv"), path.join(tmp, "seo-growth/content-bank.csv"));
    for (const [id, p] of [["C005-R1", "reddit"], ["C005-L1", "linkedin"], ["C005-X1", "x"]] as const) {
      expect(addPost(goodPost({ post_id: id, platform: p }), { cwd: tmp }).ok).toBe(true);
    }
    expect(postsForContent("C005", tmp).map((p) => p.platform).sort()).toEqual(["linkedin", "reddit", "x"]);
  });
});

// ============ 规则跟踪 ============
describe("G12 community rules tracking", () => {
  it("未核对的平台必须写 Needs Manual Check，不得声称已核对", () => {
    for (const p of PLATFORMS) {
      const r = PLATFORM_RULES[p];
      if (!r.rulesCheckedAt) {
        expect(r.selfPromoAllowed, `${p} 未核对却写了 ${r.selfPromoAllowed}`).toBe("needs_manual_check");
        expect(r.linkPolicy).toMatch(/Needs Manual Check/i);
      }
    }
  });

  it("主库里的规则字段与 rules.ts 一致（不允许两处漂移）", () => {
    for (const a of readAccounts()) {
      const rule = PLATFORM_RULES[a.platform as keyof typeof PLATFORM_RULES];
      expect(a.rules_checked_at).toBe(rule.rulesCheckedAt);
      expect(a.self_promo_notes).toMatch(/Needs Manual Check/i);
    }
  });

  it("声称已核对就必须写日期（当前应为空 = 未核对）", () => {
    for (const a of readAccounts()) {
      if (!a.rules_checked_at) {
        expect(validateAccount(a)).toEqual([]);
      } else {
        expect(/^\d{4}-\d{2}-\d{2}$/.test(a.rules_checked_at)).toBe(true);
      }
    }
  });
});

// ============ 隐私 / E 分离 ============
describe("G13 privacy 与 E 分离", () => {
  it("community 模块不引用 E 的 lead 库", () => {
    const dir = path.join(process.cwd(), "src/lib/community");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得引用 leads`).not.toMatch(/["'][^"']*leads[^"']*["']/);
    }
  });

  it("主库与发布记录里没有任何邮箱", () => {
    for (const f of [COMMUNITY_MASTER_RELATIVE_PATH, COMMUNITY_POSTS_RELATIVE_PATH]) {
      const text = fs.readFileSync(path.join(process.cwd(), f), "utf-8");
      expect(text, `${f} 出现邮箱`).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});

// ============ 真实主库质量守卫 ============
describe("G 真实主库质量守卫", () => {
  it("Community Master 恰好 5 行（每个平台一行），无重复 platform", () => {
    const accounts = readAccounts();
    expect(accounts).toHaveLength(5);
    expect(accounts.map((a) => a.platform).sort()).toEqual([...PLATFORMS].sort());
    expect(findDuplicatePlatforms(accounts)).toEqual([]);
  });

  it("主库与发布记录都不含平行副本", () => {
    const dir = path.join(process.cwd(), "seo-growth");
    const csvs = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
    const communityLike = csvs.filter((f) => /community|social|reddit|linkedin|twitter|post/i.test(f));
    expect(communityLike.sort()).toEqual(["community-master.csv", "community-posts.csv"]);
  });

  it("全部账号通过校验，发布记录为空且合法", () => {
    const r = auditCommunity();
    expect(r.accountIssues).toEqual([]);
    expect(r.postIssues).toEqual([]);
    expect(r.duplicatePlatforms).toEqual([]);
    expect(r.duplicatePostIds).toEqual([]);
    expect(r.posts).toBe(0);
  });

  it("所有账号都还没有真实主页 URL（未创建就不能假装已创建）", () => {
    for (const a of readAccounts()) {
      if (!a.profile_url) expect(a.profile_status).toBe("not_created");
    }
  });
});

// ============ 访问控制 ============
describe("G 访问控制", () => {
  it("community 模块无 'use client'，且不含任何 NEXT_PUBLIC_ 密钥", () => {
    const dir = path.join(process.cwd(), "src/lib/community");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得是客户端组件`).not.toContain('"use client"');
      // NEXT_PUBLIC_APP_URL 是公开的站点地址，允许；任何密钥类前缀都不允许
      expect(src, `${f} 不得出现 NEXT_PUBLIC_ 密钥`).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/);
    }
  });

  // 该用例要遍历整个 src 源码树逐文件读取；沙箱内文件系统经过 broker 代理，
  // 并发（例如同时跑 eslint）时会超过默认 5s，这里给出显式余量。
  it("没有任何 app 路由 / 页面引用 community 模块（不新增公开页面）", { timeout: 30_000 }, () => {
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
        if (full.startsWith(path.join(root, "lib/community"))) continue;
        const src = fs.readFileSync(full, "utf-8");
        if (/from\s+["'][^"']*lib\/community["']/.test(src)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了社区模块：${offenders.join(", ")}`).toEqual([]);
  });

  it("sitemap 不含社区相关路径", () => {
    const sitemap = fs.readFileSync(path.join(process.cwd(), "src/app/sitemap.ts"), "utf-8");
    expect(sitemap).not.toMatch(/community|community-master/);
  });
});

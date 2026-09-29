// ===== K｜Referral Base 验收测试 =====
// 原则：验证**真实行为**，不是「字符串存在」。
// 覆盖：URL 解析 / 合法 code 保存 / 非法 code 安全忽略 / 匿名归因 /
// signup 承接 / activation 不重复 / self-referral / 重复注册不累计 /
// 刷新不重复 / 不泄露身份 / 不污染 UTM / 复用 B 的 contract /
// 不进 sitemap / 不自动做任何事 / 不改现有 Audit·Signup·Login 行为。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  B_MAPPING,
  CODE_ALPHABET,
  CODE_LENGTH,
  FORBIDDEN_IN_URL,
  MANUAL_CHECKS,
  OPEN_ITEMS,
  REFERRAL_QUERY_PARAM,
  REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_DAYS,
  REFERRAL_RULES,
  buildShareUrl,
  buildTouchFromReferral,
  conversionKey,
  deriveReferralViews,
  generateReferralCode,
  isAttributionFresh,
  isOpaqueCode,
  isSelfReferral,
  isValidReferralCode,
  normalizeReferralCode,
  parseReferralFromUrl,
  recordReferralSeen,
  referralCodeFromTouchContent,
  shouldCountConversion,
  urlPrivacyIssues,
} from "./index";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const gen = () => generateReferralCode((n) => randomBytes(n));
const NOW = new Date("2026-09-28T12:00:00Z");

// ================= code：生成 / 不透明 / 不可递增 =================
describe("K code 生成与校验", () => {
  it("生成的 code 合法、长度固定、只含去歧义字符", () => {
    for (let i = 0; i < 50; i++) {
      const code = gen();
      expect(code.length).toBe(CODE_LENGTH);
      expect(isValidReferralCode(code), `${code} 应合法`).toBe(true);
      expect(isOpaqueCode(code)).toBe(true);
      // 除前缀外不得出现易混字符
      expect(/[0O1ILU]/.test(code.slice(1))).toBe(false);
      for (const ch of code.slice(1)) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("不暴露身份：code 里没有邮箱 / uuid 形态", () => {
    for (let i = 0; i < 20; i++) {
      const code = gen();
      expect(code).not.toContain("@");
      expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(code).not.toMatch(/[._-]/);
    }
  });

  it("不可通过递增推测：随机源下两次结果不相关", () => {
    const codes = new Set(Array.from({ length: 200 }, gen));
    expect(codes.size).toBe(200); // 无碰撞
    const a = gen();
    const b = gen();
    expect(a).not.toBe(b);
    // 与「顺序自增」无关：不同前缀体之间没有连续关系
    expect(a.slice(1, 5)).not.toBe(b.slice(1, 5));
  });

  it("校验位能挡住手抄错误", () => {
    const code = gen();
    const body = code.slice(1, -1);
    // 改掉 body 里的一个字符 → 校验失败
    const idx = CODE_ALPHABET.indexOf(body[0]);
    const swapped = CODE_ALPHABET[(idx + 1) % CODE_ALPHABET.length];
    const typo = `R${swapped}${body.slice(1)}${code.slice(-1)}`;
    expect(isValidReferralCode(typo)).toBe(false);
  });

  it("规范化：大小写与空格容错，但非法输入一律拒绝", () => {
    const code = gen();
    expect(normalizeReferralCode(`  ${code.toLowerCase()} `)).toBe(code);
    expect(isValidReferralCode(code.toLowerCase())).toBe(true);
    for (const bad of ["", "R", "REFERRAL", "R000000000O2", "RS7Z4C7YJKQ", gen().slice(0, -1) + "A"]) {
      expect(isValidReferralCode(bad), `${bad} 应被拒绝`).toBe(false);
    }
  });
});

// ================= share link：构造 / 解析 =================
describe("K share link", () => {
  it("链接只带 ?ref=，不带任何 utm_ 参数", () => {
    const url = buildShareUrl({ code: gen() });
    expect(url).toContain(`?${REFERRAL_QUERY_PARAM}=`);
    expect(url).not.toContain("utm_");
    expect(url.startsWith("https://www.seeo.asia/")).toBe(true);
  });

  it("支持中文路径（/zh），且不建 referral landing page", () => {
    const code = gen();
    expect(buildShareUrl({ code, locale: "zh" })).toContain("https://www.seeo.asia/zh?ref=");
    expect(buildShareUrl({ code, locale: "en" })).toContain("https://www.seeo.asia/?ref=");
  });

  it("能被解析回来：合法 / 缺失 / 非法三种情况", () => {
    const code = gen();
    expect(parseReferralFromUrl(buildShareUrl({ code }))).toEqual({ code, reason: "ok" });
    expect(parseReferralFromUrl("https://www.seeo.asia/")).toEqual({ code: null, reason: "missing" });
    expect(parseReferralFromUrl("https://www.seeo.asia/?ref=NOTACODE")).toEqual({ code: null, reason: "invalid" });
  });

  it("非法/畸形输入安全降级，不抛错", () => {
    for (const bad of ["", "not a url", "https://www.seeo.asia/?ref=", "::::", "https://x.y/?ref=%"]) {
      expect(() => parseReferralFromUrl(bad)).not.toThrow();
      const r = parseReferralFromUrl(bad);
      expect(r.code).toBeNull();
    }
  });
});

// ================= 归因真实行为 =================
describe("K attribution 生命周期", () => {
  it("首次记录即固定 first-touch，再次访问只更新时间与次数", () => {
    const code = gen();
    const first = recordReferralSeen(null, code, NOW);
    expect(first).not.toBeNull();
    expect(first!.code).toBe(code);
    expect(first!.seenCount).toBe(1);
    expect(first!.firstSeenAt).toBe(NOW.toISOString());

    const later = new Date(NOW.getTime() + 3600_000);
    const second = recordReferralSeen(first, code, later);
    expect(second!.firstSeenAt, "firstSeenAt 不得被覆盖").toBe(first!.firstSeenAt);
    expect(second!.lastSeenAt).toBe(later.toISOString());
    expect(second!.seenCount).toBe(2);

    // 刷新 N 次：只增加 seenCount，不产生新的 first-touch
    const many = recordReferralSeen(second, code, new Date(NOW.getTime() + 7200_000));
    expect(many!.firstSeenAt).toBe(first!.firstSeenAt);
    expect(many!.seenCount).toBe(3);
  });

  it("已有有效归因时，另一个 code 不覆盖（first-touch wins）", () => {
    const a = gen();
    const b = gen();
    const current = recordReferralSeen(null, a, NOW)!;
    const after = recordReferralSeen(current, b, new Date(NOW.getTime() + 60_000));
    expect(after!.code).toBe(a);
    expect(after!.firstSeenAt).toBe(current.firstSeenAt);
  });

  it("非法 code 被安全忽略：不改动已有归因、也不建档", () => {
    const current = recordReferralSeen(null, gen(), NOW)!;
    expect(recordReferralSeen(current, "BADCODE", NOW)).toEqual(current);
    expect(recordReferralSeen(null, "", NOW)).toBeNull();
    expect(recordReferralSeen(null, "not-a-code", NOW)).toBeNull();
  });

  it("过期归因按新归因处理（TTL 生效）", () => {
    const old = recordReferralSeen(null, gen(), new Date(NOW.getTime() - (REFERRAL_TTL_DAYS + 1) * 86_400_000))!;
    expect(isAttributionFresh(old, NOW)).toBe(false);
    const fresh = recordReferralSeen(old, gen(), NOW)!;
    expect(fresh.firstSeenAt).toBe(NOW.toISOString());
    expect(fresh.seenCount).toBe(1);

    const justInTime = recordReferralSeen(null, gen(), new Date(NOW.getTime() - (REFERRAL_TTL_DAYS - 1) * 86_400_000))!;
    expect(isAttributionFresh(justInTime, NOW)).toBe(true);
  });

  it("不泄露身份：保存下来的归因里没有邮箱 / user id / token", () => {
    const attr = recordReferralSeen(null, gen(), NOW)!;
    const json = JSON.stringify(attr);
    expect(json).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(json).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(Object.keys(attr).sort()).toEqual(["code", "firstSeenAt", "lastSeenAt", "seenCount", "source"]);
  });
});

// ================= 与 B 的映射（不污染 UTM、不造第二套） =================
describe("K → B mapping", () => {
  it("只有本次没有任何真实 UTM 时才注入，避免污染真实渠道归因", () => {
    const code = gen();
    expect(buildTouchFromReferral(code, {})).toEqual({ utmSource: "referral", utmContent: code });
    expect(buildTouchFromReferral(code, { utmSource: "reddit" })).toBeNull();
    expect(buildTouchFromReferral(code, { utmCampaign: "community" })).toBeNull();
    expect(buildTouchFromReferral(code, { utmContent: "C005" })).toBeNull();
    expect(buildTouchFromReferral("BAD", {})).toBeNull();
    expect(buildTouchFromReferral(null, {})).toBeNull();
  });

  it("code 经 utm_content 无损落库并可反解（K 不另存一份）", () => {
    const code = gen();
    const touch = buildTouchFromReferral(code, {})!;
    expect(B_MAPPING.codeCarrier).toBe("utm_content");
    expect(B_MAPPING.persistedColumn).toBe("first_touch_content");
    expect(referralCodeFromTouchContent(touch.utmContent)).toBe(code);
    expect(referralCodeFromTouchContent("C005")).toBeNull();
    expect(referralCodeFromTouchContent(null)).toBeNull();
  });

  it("实测确认的 B 行为：referral 不在 canonical source 里 → 归一化为 other", () => {
    const sources = read("src/lib/analytics/sources.ts");
    // 精确断言：CANONICAL_SOURCES **数组**里没有 referral
    // （"referral" 作为 medium 取值确实存在于该文件，那是既有设计，不受影响）
    const block = sources.slice(sources.indexOf("CANONICAL_SOURCES = ["), sources.indexOf("] as const"));
    expect(block).not.toContain('"referral"');
    for (const s of ["google", "reddit", "producthunt", "email", "other"]) expect(block).toContain(`"${s}"`);
    expect(B_MAPPING.normalizedSource).toBe("other");
    expect(B_MAPPING.utmSourceValue).toBe("referral");
  });

  it("K 不新增事件名、不新增 canonical source", () => {
    expect(B_MAPPING.newEventNames).toHaveLength(0);
    expect(B_MAPPING.newCanonicalSources).toHaveLength(0);
    const server = read("src/lib/analytics/server.ts");
    // 复用点必须真实存在
    for (const fn of B_MAPPING.reusedFunctions) expect(server).toContain(`export async function ${fn}`);
    expect(server).toContain("analytics_identities");
  });

  it("三个视图由 B 的数据派生，activation 沿用 B 的定义", () => {
    const code = gen();
    // 只访问：只有 visit
    expect(deriveReferralViews({ anonymousId: "aid", userId: null, firstTouchContent: code, hasActivationEvent: false }))
      .toEqual({ visit: true, signup: false, activation: false, code });
    // 注册后：visit + signup，未激活
    expect(deriveReferralViews({ anonymousId: "aid", userId: "u1", firstTouchContent: code, hasActivationEvent: false }))
      .toEqual({ visit: true, signup: true, activation: false, code });
    // 激活后：三者都成立
    expect(deriveReferralViews({ anonymousId: "aid", userId: "u1", firstTouchContent: code, hasActivationEvent: true }))
      .toEqual({ visit: true, signup: true, activation: true, code });
    // 没有 code：全部为 false
    expect(deriveReferralViews({ anonymousId: "aid", userId: "u1", firstTouchContent: "C005", hasActivationEvent: true }))
      .toEqual({ visit: false, signup: false, activation: false, code: null });
    // 没有身份就没有 visit
    expect(deriveReferralViews({ anonymousId: null, userId: null, firstTouchContent: code, hasActivationEvent: false }).visit).toBe(false);
  });
});

// ================= 反作弊 =================
describe("K anti-abuse", () => {
  it("self-referral 不计转化", () => {
    expect(isSelfReferral({ viewerUserId: "u1", ownerUserId: "u1" })).toBe(true);
    expect(isSelfReferral({ viewerUserId: "u1", ownerUserId: "u2" })).toBe(false);
    // 未知归属不判为自share，但也不会据此计转化（见下一个用例）
    expect(isSelfReferral({ viewerUserId: "u1", ownerUserId: null })).toBe(false);
    expect(isSelfReferral({ viewerUserId: null, ownerUserId: "u1" })).toBe(false);
  });

  it("没有身份只算 visit，不算 signup/activation", () => {
    const code = gen();
    expect(shouldCountConversion({ seenKeys: [], eventView: "referral_signup", userId: null, code })).toBe(false);
    expect(shouldCountConversion({ seenKeys: [], eventView: "referral_activation", userId: null, code })).toBe(false);
  });

  it("刷新 / 重复注册不重复累计（同一身份同一 code 只计一次）", () => {
    const code = gen();
    const key = conversionKey("referral_signup", "u1", code);
    expect(shouldCountConversion({ seenKeys: [], eventView: "referral_signup", userId: "u1", code })).toBe(true);
    expect(shouldCountConversion({ seenKeys: [key], eventView: "referral_signup", userId: "u1", code })).toBe(false);
    // 同一身份换一个 code 仍可计（不同归因）
    expect(shouldCountConversion({ seenKeys: [key], eventView: "referral_signup", userId: "u1", code: gen() })).toBe(true);
    // 不同身份可各计一次
    expect(shouldCountConversion({ seenKeys: [key], eventView: "referral_signup", userId: "u2", code })).toBe(true);
  });

  it("activation 与 signup 是独立计数（激活不会把 signup 再加一次）", () => {
    const code = gen();
    const signupKey = conversionKey("referral_signup", "u1", code);
    expect(shouldCountConversion({ seenKeys: [signupKey], eventView: "referral_activation", userId: "u1", code })).toBe(true);
  });
});

// ================= 隐私 =================
describe("K privacy", () => {
  it("生成的分享链接通过隐私检查", () => {
    for (let i = 0; i < 20; i++) {
      const url = buildShareUrl({ code: gen() });
      expect(urlPrivacyIssues(url), url).toEqual([]);
    }
  });

  it("隐私检查能抓到邮箱 / 手机 / token / UUID / 未许可参数", () => {
    const code = gen();
    const base = `https://www.seeo.asia/?ref=${code}`;
    expect(urlPrivacyIssues(`${base}&email=a@b.com`).join(" ")).toContain("邮箱");
    expect(urlPrivacyIssues(`${base}&u=${"a".repeat(0)}&phone=13800138000`).join(" ")).toContain("手机号");
    expect(urlPrivacyIssues(`${base}&token=eyJhbGciOiJIUzI1NiJ9.abcdef`).join(" ")).toMatch(/token|凭据/);
    expect(urlPrivacyIssues(`${base}&uid=123e4567-e89b-12d3-a456-426614174000`).join(" ")).toContain("UUID");
    expect(urlPrivacyIssues(`${base}&other=1`).join(" ")).toContain("未许可的参数");
    expect(urlPrivacyIssues(`${base}&user_id=42`).join(" ")).toContain("未许可的参数");
  });

  it("禁止项清单覆盖了用户要求的全部类别", () => {
    const whys = FORBIDDEN_IN_URL.map((f) => f.why).join(" ");
    for (const want of ["邮箱", "手机号", "token / key", "凭据类参数名", "UUID"]) {
      expect(whys).toContain(want);
    }
  });

  it("内部规则文本与存储键不会被误当作公开数据", () => {
    expect(REFERRAL_STORAGE_KEY).toBe("seeo:ref");
    const src = read("src/lib/referral/index.ts");
    expect(src).not.toContain('"use client"');
    expect(src).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
  });
});

// ================= 无推广能力 / 不改现有行为 / SEO =================
describe("K 边界与不变量", () => {
  const targets = ["src/lib/referral/index.ts", "scripts/referral.mts"];

  it("没有任何自动推广能力（无网络调用、无邀请、无奖励）", () => {
    // 只匹配**真实调用形态**：按词面匹配会把扫描器自身的模式定义当成违规（自查自报）。
    // 因此扫描前先剔掉「定义检测模式」的那几行。
    const netPattern = new RegExp(
      [String.raw`\bfetch\s*\(`, "axios\\.", "new " + "XMLH" + "ttpRequest", String.raw`sendBeacon\s*\(`].join("|")
    );
    for (const t of targets) {
      const src = read(t)
        .split("\n")
        .filter((l) => !/const pattern\s*=|new RegExp\(/.test(l))
        .join("\n");
      expect(src, `${t} 出现对外调用`).not.toMatch(netPattern);
      // 也不允许引入会发请求的依赖
      expect(src).not.toMatch(/from\s+["'](axios|node-fetch|got|undici|nodemailer|resend)["']/);
    }
    // 不得出现自动邀请 / 自动发信 / 自动发奖 / 自动发帖 / 请求 upvote 的实现
    const combined = targets.map(read).join("\n").toLowerCase();
    for (const bad of ["sendinvite", "sendreferralemail", "grantreward", "addcredits", "issuecoupon", "autopost", "requestupvote", "inviteuser("]) {
      expect(combined, `命中自动化实现 ${bad}`).not.toContain(bad);
    }
  });

  it("没有数据库迁移", () => {
    const dbMigrations = read("src/lib/db/migrations.ts");
    expect(dbMigrations.toLowerCase()).not.toContain("referral");
    const dir = path.join(ROOT, "supabase/migrations");
    const hits = fs.readdirSync(dir).filter((f) => /referral|ref_/i.test(f));
    expect(hits).toEqual([]);
    for (const f of fs.readdirSync(dir)) {
      expect(read(path.join("supabase/migrations", f)).toLowerCase()).not.toContain("referral");
    }
  });

  it("不进入 sitemap、不创建任何 referral 路由或 landing page", () => {
    expect(read("src/app/sitemap.ts")).not.toMatch(/referral|\bref\b/);
    for (const p of ["referral", "invite", "ref", "share", "r"]) {
      expect(fs.existsSync(path.join(ROOT, "src/app/(default)", p)), `不应存在公开路由 /${p}`).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "src/app/[locale]", p))).toBe(false);
    }
    expect(read("src/app/robots.ts")).not.toMatch(/referral/);
  });

  it("没有任何 app 页面/路由引用 referral 模块（不接入现有核心流程）", () => {
    const root = path.join(ROOT, "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        if (full.startsWith(path.join(root, "lib/referral"))) continue;
        if (/from\s+["'][^"']*lib\/referral["']/.test(fs.readFileSync(full, "utf-8"))) offenders.push(path.relative(ROOT, full));
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了 referral：${offenders.join(", ")}`).toEqual([]);
  });

  it("未改动 Audit / Signup / Login 与 B / G / J 的核心行为", () => {
    // B：事件白名单不变
    const server = read("src/lib/analytics/server.ts");
    for (const e of ["page_view", "audit_started", "audit_completed", "signup_started", "signup_completed"]) {
      expect(server).toContain(`"${e}"`);
    }
    expect(server).not.toContain("referral_visit"); // 不新造事件
    // G：社区归因未动，J 的未决项仍在
    expect(read("src/lib/community/utm.ts")).toContain("producthunt");
    expect(read("src/lib/product-hunt/launch-kit.ts")).toContain("NEEDS RECONCILIATION");
  });

  it("规则、未决项、人工项都已声明（人工项不得被静默视为完成）", () => {
    expect(REFERRAL_RULES.ttlDays).toBe(REFERRAL_TTL_DAYS);
    expect(OPEN_ITEMS.length).toBeGreaterThanOrEqual(4);
    expect(OPEN_ITEMS.some((i) => i.status === "NEED MANUAL")).toBe(true);
    expect(MANUAL_CHECKS.length).toBeGreaterThanOrEqual(6);
    // 文档必须与代码同步（由 CLI render 生成）
    const doc = read("seo-growth/referral/RULES.md");
    expect(doc).toContain(`?${REFERRAL_QUERY_PARAM}=`);
    expect(doc).toContain(String(REFERRAL_TTL_DAYS));
    for (const item of OPEN_ITEMS) expect(doc, `文档缺少 ${item.id}`).toContain(item.id);
  });
});

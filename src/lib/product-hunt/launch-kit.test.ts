// ===== J｜Product Hunt Launch Kit 验收测试 =====
// 覆盖 §21：required fields / single source / Product URL / CTA / 无虚假声明 /
// 无虚假 testimonial / 无隐私数据 / UTM 正确 / B source = producthunt /
// 截图路径存在 / F 引用有效 / I 引用有效 / H URL 存在 / maker bio 不得被静默填成虚构身份。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  ANALYTICS_ATTRIBUTION,
  ANTI_ABUSE,
  ATTRIBUTION_OPEN_ITEM,
  CASE_USAGE,
  COMMENT_GUIDANCE,
  CONTENT_REFERENCES,
  DEMO_CHECKLIST,
  DESCRIPTIONS,
  FAQ,
  FINAL_PRE_LAUNCH_CHECKLIST,
  FIRST_COMMENT,
  FULL_DESCRIPTION_SECTIONS,
  KIT_VERSION,
  LAUNCH_TIMELINE,
  MAKER_BIO,
  PRIMARY_CTA,
  PRODUCT,
  RULES_TRACKING,
  SCREENSHOTS,
  SCREENSHOT_ASSET_STATUS,
  SCREENSHOT_MANUAL_CHECKS,
  TAGLINES,
  TAGLINE_RECOMMENDED_ID,
} from "./launch-kit";
import { renderKit } from "../../../scripts/product-hunt.mts";
import { CANONICAL_SOURCES } from "@/lib/analytics/sources";
import { LOCALE_ROUTED_PATHS } from "@/i18n/locale-routed-paths";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const KIT_PATH = "seo-growth/product-hunt/LAUNCH_KIT.md";

/** F 的 CTA 库 id（解析源码，避免运行时 import 触发 F 的访问控制约束） */
function fCtaIds(): Set<string> {
  return new Set([...read("src/lib/content/ctas.ts").matchAll(/id:\s*"([a-z_]+)"/g)].map((m) => m[1]));
}

/** F 的内容主题 id（真实主库） */
function fContentIds(): Set<string> {
  const csv = read("seo-growth/content-bank.csv");
  return new Set([...csv.matchAll(/^(C\d{3}),/gm)].map((m) => m[1]));
}

/** I 的 case id（真实主库，当前应为空） */
function caseRows(): string[] {
  const lines = read("seo-growth/case-studies.csv").split("\n").filter((l) => l.trim());
  return lines.slice(1);
}

// ================= J1：单一事实来源 =================
describe("J1 source of truth", () => {
  it("只存在一个 Product Hunt 内容源（代码）+ 一个渲染产物", () => {
    // 按**相对路径**匹配（不是文件名）：目录名 product-hunt 才是识别依据
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (/\.test\.tsx?$/.test(e.name)) continue; // 测试文件不是内容源
        const rel = path.relative(ROOT, full);
        if (/product[-_]?hunt|ph[-_]?launch|launch[-_]?copy/i.test(rel)) files.push(rel);
      }
    };
    walk(path.join(ROOT, "seo-growth"));
    walk(path.join(ROOT, "src/lib/product-hunt"));
    expect(new Set(files)).toEqual(
      new Set([KIT_PATH, "seo-growth/community/PRODUCT_HUNT_KIT.md", "src/lib/product-hunt/launch-kit.ts"])
    );
  });

  it("G 的那份已降级为指针，不再承载第二套文案", () => {
    const pointer = read("seo-growth/community/PRODUCT_HUNT_KIT.md");
    expect(pointer).toContain("src/lib/product-hunt/launch-kit.ts");
    expect(pointer).toContain(KIT_PATH);
    // 指针里不得再出现 tagline / first comment 这类 launch 文案
    expect(pointer).not.toContain(TAGLINES[0].text);
    expect(pointer).not.toContain(FIRST_COMMENT.slice(0, 60));
  });

  it("渲染产物与代码同步（漂移即失败）", () => {
    expect(fs.existsSync(path.join(ROOT, KIT_PATH))).toBe(true);
    expect(read(KIT_PATH)).toBe(renderKit());
  });

  it("kit 覆盖 §4 要求的 15 个区块", () => {
    const kit = read(KIT_PATH);
    const required = [
      "## 1. Product Name", "## 2. Tagline", "## 3. Short Description", "## 4. Full Description",
      "## 5. Maker Bio", "## 6. First Comment", "## 7. FAQ", "## 8. Product URL",
      "## 9. Primary CTA", "## 10. Screenshot checklist", "## 11. Demo checklist",
      "## 12. Launch-day checklist", "## 13. Comment / reply guidance",
      "## 14. Analytics attribution", "## 15. Final pre-launch checklist",
    ];
    for (const h of required) expect(kit, `缺少 ${h}`).toContain(h);
    expect(KIT_VERSION).toBeTruthy();
  });
});

// ================= J2/J3/J4：定位・Tagline・描述 =================
describe("J2/J3/J4 positioning · tagline · description", () => {
  it("三个候选、恰好一个推荐、长度 ≤60", () => {
    expect(TAGLINES).toHaveLength(3);
    expect(TAGLINES.map((t) => t.id).sort()).toEqual(["A", "B", "C"]);
    expect(["A", "B", "C"]).toContain(TAGLINE_RECOMMENDED_ID);
    for (const t of TAGLINES) {
      expect(t.text.length, `tagline ${t.id} 超长`).toBeLessThanOrEqual(60);
      expect(t.why.trim().length).toBeGreaterThan(10);
    }
  });

  it("长描述与站上 meta.siteDescription 逐字一致", () => {
    const messages = JSON.parse(read("messages/en.json")) as { meta: { siteDescription: string } };
    expect(DESCRIPTIONS.siteLong).toBe(messages.meta.siteDescription);
  });

  it("完整描述按 Problem → Product → workflow → capabilities → free → CTA 排列", () => {
    expect(FULL_DESCRIPTION_SECTIONS.map((s) => s.heading)).toEqual([
      "Problem", "Product", "Core workflow", "Main capabilities", "Free entry", "CTA",
    ]);
    for (const s of FULL_DESCRIPTION_SECTIONS) expect(s.body.trim().length).toBeGreaterThan(20);
  });

  it("定位与实际产品一致：六个模块都真实存在，且不出现禁止卖点", () => {
    const text = [
      JSON.stringify(DESCRIPTIONS),
      JSON.stringify(FULL_DESCRIPTION_SECTIONS),
      JSON.stringify(FAQ),
      FIRST_COMMENT,
    ].join("\n");

    // 六个真实模块
    for (const mod of ["audit", "rank", "keyword", "competitor", "content", "backlink"]) {
      expect(text.toLowerCase()).toContain(mod);
    }

    // 禁止的虚假能力与无证据断言
    const banned = [
      "best seo tool", "#1", "number one", "revolutionary", "the only seo tool",
      "ai-powered", "ai automatically", "automatically fix", "自动修复", "自动生成内容",
      "enterprise", "企业级", "guaranteed", "保证排名", "100% ",
    ];
    for (const b of banned) expect(text.toLowerCase(), `命中禁用说法「${b}」`).not.toContain(b);
  });

  it("免费额度与真实套餐口径一致（Free / Lite / Pro / Custom）", () => {
    const text = JSON.stringify(FAQ) + JSON.stringify(FULL_DESCRIPTION_SECTIONS);
    expect(text).toContain("2 projects, 3 tracked keywords and 3 audits per day");
    const plans = read("messages/en.json");
    for (const name of ["Free", "Lite", "Pro", "Custom Service"]) expect(plans).toContain(`"name": "${name}"`);
  });
});

// ================= J5/J6/J7：Maker bio・First comment・FAQ =================
describe("J5/J6/J7 maker bio · first comment · FAQ", () => {
  it("maker bio 必须保持人工占位，不得被静默填成虚构身份", () => {
    expect(MAKER_BIO.status).toBe("NEED MANUAL");
    const joined = Object.values(MAKER_BIO.placeholders).join(" ");
    expect(joined).toContain("[FILL IN");
    // 占位符里不得出现看起来像真实姓名的内容（只有方括号占位与说明）
    for (const v of Object.values(MAKER_BIO.placeholders)) {
      expect(v.startsWith("[FILL IN")).toBe(true);
    }
    expect(MAKER_BIO.forbidden.length).toBeGreaterThanOrEqual(3);
  });

  it("first comment 不索取投票、不是广告", () => {
    const c = FIRST_COMMENT.toLowerCase();
    for (const bad of ["upvote", "please vote", "help us get #1", "#1", "support us", "求投票", "冲榜"]) {
      expect(c, `first comment 含「${bad}」`).not.toContain(bad);
    }
    expect(FIRST_COMMENT).toContain("Where I would most like feedback");
  });

  it("FAQ 覆盖 §10 要求的 8 个问题，答案均非空", () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(8);
    for (const f of FAQ) {
      expect(f.q.trim().length).toBeGreaterThan(8);
      expect(f.a.trim().length).toBeGreaterThan(40);
    }
    const questions = FAQ.map((f) => f.q.toLowerCase()).join(" | ");
    for (const want of ["what is seeo", "who is it for", "free plan", "without paying", "seo audit work", "different", "after the audit", "feedback"]) {
      expect(questions, `FAQ 缺少「${want}」`).toContain(want);
    }
  });
});

// ================= J8/J9：截图・Demo =================
describe("J8/J9 screenshot · demo", () => {
  it("截图清单只保留结构：6 个槽位全部 NEED MANUAL，且不携带任何文件路径", () => {
    expect(SCREENSHOTS).toHaveLength(6);
    expect(SCREENSHOTS.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of SCREENSHOTS) {
      expect(s.status, `槽位 ${s.slot} 状态必须为 NEED MANUAL`).toBe("NEED MANUAL");
      expect(s.purpose.trim().length).toBeGreaterThan(5);
      // 结构里不得出现 path 之类的字段 —— 不能用路径（尤其不能指向已删除的文件）
      expect(Object.keys(s).sort()).toEqual(["purpose", "slot", "status"]);
    }
    expect(SCREENSHOT_ASSET_STATUS.status).toBe("NEED MANUAL");
    expect(SCREENSHOT_ASSET_STATUS.note).toMatch(/NEED MANUAL|不存在任何截图文件/);
  });

  it("仓库内不存在任何截图文件，且 kit 不引用任何图片路径（无死引用）", () => {
    // 1) 渲染产物里不得出现任何图片扩展名或已删除的目录
    const kit = read(KIT_PATH);
    expect(kit).not.toMatch(/\.(png|jpe?g|webp|avif|gif)\b/i);
    expect(kit).not.toContain("directory-assets/screenshots");
    expect(kit).toContain("NEED MANUAL");

    // 2) 全项目扫描：不得存在任何截图实体文件，且不得有源码/文档指向已删除的截图目录。
    //    产品资源（public/ 下的 brand logo、og image、SVG 图标等）不属于截图，予以保留。
    //
    //    性能：这里**一次遍历**同时收集两类结果，并只扫描「可能承载引用」的目录
    //    （src / scripts / seo-growth / public + 根目录文件），不遍历整个仓库。
    const PNG_DIR = "directory-assets/screenshots";
    const SCAN_DIRS = ["src", "scripts", "seo-growth", "public"];
    const images: string[] = [];
    const offenders: string[] = [];

    const visitFile = (full: string, name: string) => {
      const rel = path.relative(ROOT, full);
      if (/\.(png|jpe?g|webp|avif|gif)$/i.test(name)) images.push(rel);
      if (!/\.(ts|tsx|mjs|js|md|csv|json)$/.test(name)) return;
      if (rel === "src/lib/product-hunt/launch-kit.test.ts") return; // 本文件就是检查器
      // 允许清单（唯一一项）：截图**生成器脚本**。它是代码工具，不是截图产物；
      // 里面的路径是「运行时会创建的输出目标」，不是指向已删除文件的死引用。
      // 本阶段不执行它、也不删除它（未经授权不改工具脚本的功能）。
      if (rel === "scripts/capture-demo-screenshots.mjs") return;
      if (fs.readFileSync(full, "utf-8").includes(PNG_DIR)) offenders.push(rel);
    };

    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        visitFile(full, e.name);
      }
    };
    for (const d of SCAN_DIRS) {
      const abs = path.join(ROOT, d);
      if (fs.existsSync(abs)) walk(abs);
    }
    // 根目录下的文件（package.json / 配置文件等）也要看，但不下钻到无关目录
    for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (e.isDirectory()) continue;
      visitFile(path.join(ROOT, e.name), e.name);
    }

    // 允许清单：真正的产品资源（不是截图/screen capture）。
    // 用「精确相等」比较，两个方向都校验：仓库里不得多出其他图片，这 4 个也不得被误删。
    const PRODUCT_IMAGE_ALLOWLIST = [
      "public/brand/seeo-icon-1024.png",
      "public/brand/seeo-logo-256.png",
      "public/brand/seeo-logo-512.png",
      "public/og.jpg", // 营销页 OG / Twitter 卡片用（src/i18n/seo.ts 的 OG_IMAGE）
    ].sort();

    expect(images.sort(), `图片文件与「产品资源允许清单」不一致（多出的即为截图残留）：${images.join(", ")}`).toEqual(
      PRODUCT_IMAGE_ALLOWLIST
    );
    expect(offenders, `以下文件仍指向已删除的截图目录：${offenders.join(", ")}`).toEqual([]);
  });

  it("截图素材状态不得被写成 PASS（仓库里没有任何截图实体）", () => {
    const kit = read(KIT_PATH);
    // 渲染产物里截图小节必须标注 NEED MANUAL，而不是 READY / PASS
    const section = kit.slice(kit.indexOf("## 10. Screenshot checklist"), kit.indexOf("## 11. Demo checklist"));
    expect(section).toContain("NEED MANUAL");
    expect(section).not.toMatch(/\bPASS\b|\bREADY\b/);
  });

  it("截图使用前的人工确认项必须仍未勾选（未被假装确认）", () => {
    expect(SCREENSHOT_MANUAL_CHECKS.length).toBeGreaterThan(0);
    for (const c of SCREENSHOT_MANUAL_CHECKS) expect(c.manual).toBe(true);
    const kit = read(KIT_PATH);
    // 清单项在渲染产物里必须是未勾选状态
    expect(kit).toContain("- [ ] 每张图不含真实用户邮箱、域名或客户数据");
  });

  it("demo 明确 NEED MANUAL，不编造演示数据", () => {
    expect(DEMO_CHECKLIST.status).toBe("NEED MANUAL");
    expect(DEMO_CHECKLIST.note).toMatch(/NEED MANUAL/);
    expect(DEMO_CHECKLIST.steps.length).toBeGreaterThanOrEqual(4);
    for (const s of DEMO_CHECKLIST.steps) expect(s.manual).toBe(true);
  });
});

// ================= J10/J11/J12：F・H・I =================
describe("J10/J11/J12 F · H · I integration", () => {
  it("F 引用只写 id，且这些 content_id 真实存在于 F 的内容主库", () => {
    const ids = fContentIds();
    expect(ids.size).toBeGreaterThanOrEqual(30);
    for (const ref of CONTENT_REFERENCES.launchContentSource) {
      expect(ref.startsWith("F:")).toBe(true);
      expect(ids.has(ref.slice(2)), `F 主库不存在 ${ref}`).toBe(true);
    }
    // 不复制 F 的正文：kit 里不应出现 F 主题的长句
    const kit = read(KIT_PATH);
    const contentBank = read("seo-growth/content-bank.csv");
    const longFragment = contentBank.match(/"(SEO [^"]{40,})"/)?.[1];
    if (longFragment) expect(kit).not.toContain(longFragment);
  });

  it("C 的邮件模板口径有效（feature_education_v1 真实存在）", () => {
    const lifecycle = read("src/lib/email/templates/lifecycle.ts");
    expect(lifecycle).toContain(CONTENT_REFERENCES.featureEducationTemplate);
  });

  it("Product URL 必须指向真实收录的公开入口，且不是内部/测试路径", () => {
    expect(LOCALE_ROUTED_PATHS.has("/"), "首页不在白名单").toBe(true);
    const u = new URL(PRODUCT.productUrl);
    expect(LOCALE_ROUTED_PATHS.has(u.pathname === "" ? "/" : u.pathname)).toBe(true);
    for (const bad of ["/app", "/api", "/payment", "/login", "/signup", "seo-growth", "case-studies", "content-bank", "master"]) {
      expect(PRODUCT.productUrl, `Product URL 命中内部路径 ${bad}`).not.toContain(bad);
    }
  });

  it("CTA 必须来自 F 的 CTA 库，且指向 Product URL", () => {
    expect(fCtaIds().has(PRIMARY_CTA.ctaId), `F 的 CTA 库里没有 ${PRIMARY_CTA.ctaId}`).toBe(true);
    expect(PRIMARY_CTA.target).toBe(PRODUCT.productUrl);
  });

  it("I 集成：0 条真实案例时 kit 不得含任何客户证据", () => {
    expect(caseRows()).toHaveLength(0);
    expect(CASE_USAGE.approvedCasesUsed).toBe(0);
    const kit = read(KIT_PATH);

    // 1) 结构化层：没有案例就意味着没有任何可承载证据的字段被填
    expect(JSON.stringify(CASE_USAGE)).toContain("No customer proof available yet");

    // 2) 文本层校验「数据形态」而不是词面 —— kit 必然会包含禁止性说明
    //    （例如「不要加 testimonials / customer quotes」），所以不能按词面禁用
    expect(kit).not.toMatch(/\b\d{1,3}(\.\d+)?\s?%\s*(increase|growth|improvement|提升)/i);
    expect(kit).not.toMatch(/from \d+ to \d+/i);
    expect(kit).not.toMatch(/[""][^""]{20,}[""]\s*[—–-]\s*[A-Z]/); // 引用 + 署名形态
    expect(kit).not.toMatch(/^##\s.*(customer|testimonial|case stud)/im); // 没有「客户证据」小节

    // 3) 「testimonial」只允许出现在**禁止性语句**里（反作弊清单 / 「不要加」说明），
    //    绝不允许作为内容出现。逐行校验上下文，而不是数次数。
    const testimonialLines = kit
      .split("\n")
      .filter((l) => /testimonial/i.test(l) && !/^```/.test(l.trim()));
    expect(testimonialLines.length).toBeGreaterThan(0);
    for (const line of testimonialLines) {
      expect(line, `「testimonial」出现在非禁止语境：${line.slice(0, 60)}`).toMatch(/禁止|Do not|forbidden/i);
    }
    expect(kit).toContain("No customer proof available yet");
  });
});

// ================= J13：归因 =================
describe("J13 attribution", () => {
  it("utm_source 复用 B 的 canonical source = producthunt（不新建平行来源）", () => {
    expect(ANALYTICS_ATTRIBUTION.utmSource).toBe("producthunt");
    expect([...CANONICAL_SOURCES]).toContain(ANALYTICS_ATTRIBUTION.utmSource);
    for (const alias of ["product-hunt", "product_hunt", "ph"]) {
      expect(ANALYTICS_ATTRIBUTION.utmSource).not.toBe(alias);
    }
  });

  it("四个 UTM 参数齐全且 URL 拼装正确（复用现有 analytics）", () => {
    const url = new URL(ANALYTICS_ATTRIBUTION.url);
    expect(url.searchParams.get("utm_source")).toBe("producthunt");
    expect(url.searchParams.get("utm_medium")).toBe("community");
    expect(url.searchParams.get("utm_campaign")).toBe("launch");
    expect(url.searchParams.get("utm_content")).toBe(KIT_VERSION);
    expect(ANALYTICS_ATTRIBUTION.reusesExistingAnalytics).toBe(true);
  });

  it("与 G 的归因分歧被显式记录，不会被忘掉", () => {
    expect(ATTRIBUTION_OPEN_ITEM.status).toBe("NEEDS RECONCILIATION");
    expect(ATTRIBUTION_OPEN_ITEM.detail).toContain("campaignFor");
    // G 目前的实现确实是 medium=launch —— 记录冲突事实，不擅自改 G
    const gUtm = read("src/lib/community/utm.ts");
    expect(gUtm).toContain("launch");
    expect(RULES_TRACKING.rulesStatus).toBe("Needs Manual Check");
  });
});

// ================= J14/J15/J16：Checklist・规则・反作弊 =================
describe("J14/J15/J16 checklist · rules · anti-abuse", () => {
  it("Launch 时间线含 T-7 / T-1 / Launch Day / T+1 且每段有可执行项", () => {
    expect(LAUNCH_TIMELINE.map((t) => t.when)).toEqual(["T-7", "T-1", "Launch Day", "T+1"]);
    for (const t of LAUNCH_TIMELINE) expect(t.items.length).toBeGreaterThanOrEqual(4);
  });

  it("最终检查清单包含必须人工完成的项（不得全自动通过）", () => {
    expect(FINAL_PRE_LAUNCH_CHECKLIST.length).toBeGreaterThanOrEqual(8);
    expect(FINAL_PRE_LAUNCH_CHECKLIST.filter((i) => i.manual).length).toBeGreaterThanOrEqual(4);
  });

  it("评论指引明确不索取投票、不编造案例", () => {
    const g = COMMENT_GUIDANCE.join(" ");
    expect(g).toMatch(/不索取投票/);
    expect(g).toMatch(/没有真实案例/);
  });

  it("规则状态是 Needs Manual Check，不得伪装成已核对", () => {
    expect(RULES_TRACKING.rulesStatus).toBe("Needs Manual Check");
    expect(RULES_TRACKING.rulesCheckedAt).toBe("");
    expect(RULES_TRACKING.rulesSource).toBe("");
  });

  it("反作弊：只做 organic launch，且 kit 代码没有任何网络能力", () => {
    expect(ANTI_ABUSE.mode).toBe("Organic launch only");
    expect(ANTI_ABUSE.forbidden.length).toBeGreaterThanOrEqual(5);
    expect(ANTI_ABUSE.hasNetworkCapability).toBe(false);

    for (const rel of ["src/lib/product-hunt/launch-kit.ts", "scripts/product-hunt.mts"]) {
      const src = read(rel);
      expect(src, `${rel} 出现网络调用`).not.toMatch(/\bfetch\(|axios|https?\.request|webhook|xmlrpc/);
    }
    expect(ANTI_ABUSE.forbidden.join(" ")).toMatch(/upvote/);
  });
});

// ================= J17：隐私 =================
describe("J17 privacy", () => {
  it("kit 与代码里没有邮箱 / 密钥 / 凭据", () => {
    const kit = read(KIT_PATH);
    expect(kit).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(kit).not.toMatch(/(api[_-]?key|token|secret|password)\s*[:=]/i);
    expect(kit).not.toMatch(/\.env|BEGIN [A-Z ]*PRIVATE KEY|re_[A-Za-z0-9]{20,}/);
    // 内部 kit 引用 Master 路径是必要的（告诉你去哪查案例）；
    // 但不得把「用户私有数据入口」写进来
    for (const bad of ["lead_id", "guest:", "leads.csv"]) {
      expect(kit, `kit 泄漏私有数据入口 ${bad}`).not.toContain(bad);
    }
  });

  it("kit 不把任何私有路由当入口（Product URL 之外不出现应用内路径）", () => {
    const kit = read(KIT_PATH);
    for (const priv of ["/app/settings", "/app/reports", "/api/", "/payment"]) {
      expect(kit, `kit 出现私有路径 ${priv}`).not.toContain(priv);
    }
  });

  it("kit 不会被客户端组件或公开页面引用", () => {
    const root = path.join(ROOT, "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        if (full.startsWith(path.join(root, "lib/product-hunt"))) continue;
        if (/from\s+["'][^"']*lib\/product-hunt["']/.test(fs.readFileSync(full, "utf-8"))) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了 launch kit：${offenders.join(", ")}`).toEqual([]);
  });

  it("本轮未创建任何公开 Product Hunt 页面", () => {
    for (const p of ["product-hunt", "launch", "ph"]) {
      expect(fs.existsSync(path.join(ROOT, "src/app/(default)", p))).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "src/app/[locale]", p))).toBe(false);
    }
    expect(read("src/app/sitemap.ts")).not.toMatch(/product-hunt|launch/);
  });
});

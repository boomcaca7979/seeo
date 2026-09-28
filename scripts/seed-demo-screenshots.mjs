// ===== Directory Submission 截图专用 demo seed =====
// 仅写入本地 dev 数据库 data/seeo.db（demo 模式回退库，已 gitignore），
// 不触碰生产 Turso / Supabase，不影响真实用户逻辑。
// 用法：node scripts/seed-demo-screenshots.mjs
//
// 项目背景（模拟真实 SaaS 站点）：
//   Project:  Acme SaaS Platform
//   Domain:   acme-example.com（虚构，约 96 个页面）
//   Health:   78/100，Critical 5 / Warning 18 / Info 12

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "seeo.db");
const USER = "demo-user";
const DOMAIN = "acme-example.com";
const SITE = "https://www.acme-example.com";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- 日期工具（本地时区，与 SQLite date('now','localtime') 对齐） ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
const dateStr = (n) => ymd(daysAgo(n));
// SQLite datetime 格式 YYYY-MM-DD HH:MM:SS
const dtStr = (n, h = 10, m = 0) =>
  `${dateStr(n)} ${pad(h)}:${pad(m)}:${pad(Math.floor(Math.random() * 60))}`;

// ---------- 0. 清空 demo-user 旧测试数据 ----------
console.log("[seed] cleaning legacy demo data ...");
for (const t of [
  "audit_issues", "audits", "alerts", "reports", "competitor_ranks",
  "competitors", "rank_history", "keyword_group_members", "keyword_groups",
  "tracked_keywords", "content_checks", "backlinks", "backlink_summaries",
  "projects",
]) {
  db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(USER);
}
db.prepare("INSERT OR IGNORE INTO automation_settings (id) VALUES (1)").run();

// ---------- 1. Project ----------
const info = db.prepare(
  `INSERT INTO projects (name, domain, user_id, created_at) VALUES (?, ?, ?, ?)`
).run("Acme SaaS Platform", DOMAIN, USER, dtStr(35, 9, 12));
const projectId = Number(info.lastInsertRowid);
console.log(`[seed] project #${projectId}: Acme SaaS Platform (${DOMAIN})`);

// ---------- 2. Keywords + 30 天排名历史 ----------
// [keyword, todayPos, yesterdayPos, pos7dAgo, matchedPath]
const kws = [
  ["AI SEO software", 12, 15, 18, "/features/ai-seo"],
  ["SEO audit tool", 8, 10, 11, "/"],
  ["technical SEO checker", 15, 14, 14, "/features/technical-audit"],
  ["SEO reporting software", 21, 22, 24, "/features/reports"],
  ["AI SEO tools", 17, 19, 22, "/blog/ai-seo-tools-guide"],
  ["SEO audit software", 11, 13, 16, "/"],
  ["keyword rank tracker", 26, 25, 25, "/features/rank-tracking"],
  ["technical SEO audit tool", 9, 11, 13, "/features/technical-audit"],
  ["SEO workflow platform", 31, 32, 35, "/features"],
  ["competitor analysis SEO tool", 19, 21, 23, "/features/competitor-analysis"],
  ["website audit tool", 14, 15, 17, "/"],
  ["AI content optimization", 23, 25, 27, "/features/content"],
  ["SEO health score checker", 6, 7, 9, "/features/technical-audit"],
  ["core web vitals audit tool", 28, 29, 30, "/blog/core-web-vitals"],
  ["schema markup validator", 34, 36, 38, "/blog/schema-guide"],
  ["XML sitemap checker", 16, 15, 15, "/blog/sitemap-checklist"],
  ["backlink gap analysis tool", 37, 39, 41, "/features/backlinks"],
  ["white label SEO report tool", 22, 24, 26, "/features/reports"],
  ["SEO tools for SaaS companies", 13, 16, 19, "/blog/seo-for-saas"],
  ["affordable SEO platform", 10, 11, 12, "/pricing"],
];

const insKw = db.prepare(
  `INSERT INTO tracked_keywords (keyword, location, device, domain, created_at, last_refreshed_at, user_id)
   VALUES (?, 'United States', 'PC', ?, ?, ?, ?)`
);
const insRh = db.prepare(
  `INSERT INTO rank_history (keyword_id, date, position, url, user_id) VALUES (?, ?, ?, ?, ?)`
);
const keywordIds = [];
const txKw = db.transaction(() => {
  for (const [kw, today, yest, week1, matched] of kws) {
    const r = insKw.run(kw, DOMAIN, dtStr(28, 9, 30), `${dateStr(0)} 09:05:00`, USER);
    const kid = Number(r.lastInsertRowid);
    keywordIds.push(kid);
    const url = SITE + matched;
    // 30 天历史：从 today+14 附近波动收敛到 today
    for (let i = 29; i >= 0; i--) {
      const target = i === 0 ? today : i === 1 ? yest : i === 7 ? week1 : null;
      let pos;
      if (target !== null) {
        pos = target;
      } else {
        // 线性插值 + 噪声
        const frac = i / 29;
        const base = today + Math.round((today + 14 - today) * frac);
        pos = Math.max(1, base + (Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)) : 0));
      }
      insRh.run(kid, dateStr(i), pos, url, USER);
    }
  }
});
txKw();
console.log(`[seed] ${kws.length} keywords + 30d rank history`);

// ---------- 3. Competitors ----------
const compIns = db.prepare(
  `INSERT INTO competitors (project_id, domain, name, user_id, created_at) VALUES (?, ?, ?, ?, ?)`
);
const compRankIns = db.prepare(
  `INSERT INTO competitor_ranks (competitor_id, keyword_id, rank, target_url, checked_at, user_id)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const competitors = [
  { domain: "ahrefs.com", name: "Ahrefs", base: 4, spread: 5 },
  { domain: "semrush.com", name: "Semrush", base: 3, spread: 6 },
  { domain: "seranking.com", name: "SE Ranking", base: 12, spread: 10 },
];
const txComp = db.transaction(() => {
  for (const c of competitors) {
    const r = compIns.run(projectId, c.domain, c.name, USER, dtStr(30, 11, 0));
    const cid = Number(r.lastInsertRowid);
    kws.forEach(([, today], idx) => {
      // 竞品排名：基于自家排名偏移 + 抖动，头部竞品明显更强
      const offset = c.domain === "seranking.com" ? 3 : -6;
      const rank = Math.max(1, Math.round(today + offset + (Math.random() - 0.5) * c.spread));
      compRankIns.run(cid, keywordIds[idx], rank, `https://${c.domain}/`, `${dateStr(0)} ${pad(8 + Math.floor(Math.random() * 3))}:00:00`, USER);
    });
  }
});
txComp();
console.log(`[seed] 3 competitors x ${kws.length} ranks`);

// ---------- 4. Audits（历史 3 次，最新 78 分 full depth） ----------
const auditIns = db.prepare(`
  INSERT INTO audits (domain, started_at, finished_at, pages_crawled, health_score, status,
    errors, warnings, notices, comparison, depth, pages_detail, user_id)
  VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
`);

// 4.1 两次历史审计（供 history 列表）
auditIns.run(DOMAIN, dtStr(20, 9, 0), dtStr(20, 9, 7), 92, 71, 8, 24, 15, null, "full", null, USER);
auditIns.run(DOMAIN, dtStr(7, 9, 0), dtStr(7, 9, 6), 94, 74, 6, 21, 13, null, "full", null, USER);

// 4.2 最新审计
const pagesDetail = [
  { url: `${SITE}/`, responseTimeMs: 812, status: 200, ok: true },
  { url: `${SITE}/pricing`, responseTimeMs: 954, status: 200, ok: true },
  { url: `${SITE}/features`, responseTimeMs: 1102, status: 200, ok: true },
  { url: `${SITE}/features/ai-seo`, responseTimeMs: 1289, status: 200, ok: true },
  { url: `${SITE}/features/technical-audit`, responseTimeMs: 1176, status: 200, ok: true },
  { url: `${SITE}/features/rank-tracking`, responseTimeMs: 998, status: 200, ok: true },
  { url: `${SITE}/features/competitor-analysis`, responseTimeMs: 1341, status: 200, ok: true },
  { url: `${SITE}/features/reports`, responseTimeMs: 921, status: 200, ok: true },
  { url: `${SITE}/blog/ai-seo-tools-guide`, responseTimeMs: 1567, status: 200, ok: true },
  { url: `${SITE}/blog/seo-for-saas`, responseTimeMs: 1743, status: 200, ok: true },
  { url: `${SITE}/blog/core-web-vitals`, responseTimeMs: 2118, status: 200, ok: true },
  { url: `${SITE}/docs/api`, responseTimeMs: 1305, status: 200, ok: true },
  { url: `${SITE}/contact`, responseTimeMs: 887, status: 200, ok: true },
  { url: `${SITE}/about`, responseTimeMs: 795, status: 200, ok: true },
];
const comparison = {
  current: { score: 78, issues: 35, checkedAt: `${dateStr(0)} 08:41:12` },
  previous: { score: 74, issues: 40, checkedAt: `${dateStr(7)} 09:06:00` },
  scoreChange: 4,
  issuesChange: -5,
  newIssues: [
    { checkId: "missing-canonical", checkName: "missing-canonical", message: "Page has no canonical link tag", url: `${SITE}/blog/schema-guide`, severity: "warning", suggestion: "Add a rel=canonical link to the preferred URL" },
    { checkId: "slow-page", checkName: "slow-page", message: "Page load time exceeds 2 seconds", url: `${SITE}/blog/core-web-vitals`, severity: "notice", suggestion: "Optimize images and defer non-critical JS" },
  ],
  resolvedIssues: [
    { checkId: "missing-og-tags", checkName: "missing-og-tags", message: "Page has no Open Graph tags", url: `${SITE}/about`, severity: "notice", suggestion: "Add og:title and og:description meta tags" },
    { checkId: "title-length", checkName: "title-length", message: "Title length out of range", url: `${SITE}/docs/api`, severity: "warning", suggestion: "Keep title between 30 and 60 characters" },
  ],
  unchangedIssues: [
    { checkId: "missing-description", checkName: "missing-description", message: "Page has no meta description tag", url: `${SITE}/pricing`, severity: "error", suggestion: "Add a 120-160 character description with primary keyword and value proposition" },
    { checkId: "missing-alt", checkName: "missing-alt", message: "Image is missing alt text", url: `${SITE}/blog/seo-for-saas`, severity: "warning", suggestion: "Describe the image content in the alt attribute" },
    { checkId: "broken-links", checkName: "broken-links", message: "HTTP 404", url: `${SITE}/features/pricing-comparison`, severity: "error", suggestion: "Add a 301 redirect to a relevant page or restore the missing content" },
    { checkId: "no-structured-data", checkName: "no-structured-data", message: "Page has no JSON-LD structured data", url: `${SITE}/blog/ai-seo-tools-guide`, severity: "warning", suggestion: "Add Article or FAQPage schema to blog pages" },
  ],
};
const latestAudit = auditIns.run(
  DOMAIN, dtStr(0, 8, 30), `${dateStr(0)} 08:41:12`, 96, 78, 5, 18, 12,
  JSON.stringify(comparison), "full", JSON.stringify(pagesDetail), USER
);
const auditId = Number(latestAudit.lastInsertRowid);

// ---------- 5. audit_issues（error 5 / warning 18 / notice 12） ----------
const issueIns = db.prepare(
  `INSERT INTO audit_issues (audit_id, type, severity, url, detail, suggestion, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const issues = [
  // --- error (5) ---
  ["missing-description", "error", `${SITE}/pricing`, "Page has no meta description tag", "Add a 120-160 character description with primary keyword and value proposition"],
  ["missing-description", "error", `${SITE}/contact`, "Page has no meta description tag", "Add a 120-160 character description with primary keyword and value proposition"],
  ["missing-description", "error", `${SITE}/blog/2024-launch-notes`, "Page has no meta description tag", "Add a 120-160 character description with primary keyword and value proposition"],
  ["missing-title", "error", `${SITE}/blog/2024-launch-notes`, "Page has no <title> tag", "Add a 30-60 character title containing the primary keyword"],
  ["broken-links", "error", `${SITE}/features/pricing-comparison`, "HTTP 404", "Add a 301 redirect to a relevant page or restore the missing content"],
  // --- warning (18) ---
  ["broken-links", "warning", `${SITE}/docs/api-v1`, "HTTP 500", "Check server status and page availability"],
  ["broken-links", "warning", `${SITE}/resources/old-guide`, "HTTP 503", "Check server status and page availability"],
  ["missing-canonical", "warning", `${SITE}/blog/schema-guide`, "Page has no canonical link tag", "Add a rel=canonical link to the preferred URL"],
  ["missing-canonical", "warning", `${SITE}/blog/sitemap-checklist?ref=nav`, "Page has no canonical link tag", "Add a rel=canonical link to the preferred URL"],
  ["missing-canonical", "warning", `${SITE}/blog/2024-launch-notes`, "Page has no canonical link tag", "Add a rel=canonical link to the preferred URL"],
  ["missing-alt", "warning", `${SITE}/blog/ai-seo-tools-guide`, "3 images are missing alt text", "Describe the image content in the alt attribute"],
  ["missing-alt", "warning", `${SITE}/blog/seo-for-saas`, "2 images are missing alt text", "Describe the image content in the alt attribute"],
  ["missing-alt", "warning", `${SITE}/blog/core-web-vitals`, "4 images are missing alt text", "Describe the image content in the alt attribute"],
  ["missing-alt", "warning", `${SITE}/features/ai-seo`, "1 image is missing alt text", "Describe the image content in the alt attribute"],
  ["missing-alt", "warning", `${SITE}/about`, "2 images are missing alt text", "Describe the image content in the alt attribute"],
  ["no-structured-data", "warning", `${SITE}/blog/ai-seo-tools-guide`, "Page has no JSON-LD structured data", "Add Article or FAQPage schema to blog pages"],
  ["no-structured-data", "warning", `${SITE}/blog/seo-for-saas`, "Page has no JSON-LD structured data", "Add Article or FAQPage schema to blog pages"],
  ["no-structured-data", "warning", `${SITE}/blog/core-web-vitals`, "Page has no JSON-LD structured data", "Add Article or FAQPage schema to blog pages"],
  ["title-length", "warning", `${SITE}/features/competitor-analysis`, "Title is 72 characters (max 60)", "Keep title between 30 and 60 characters"],
  ["title-length", "warning", `${SITE}/features/reports`, "Title is 68 characters (max 60)", "Keep title between 30 and 60 characters"],
  ["description-length", "warning", `${SITE}/features/rank-tracking`, "Meta description is 94 characters (min 120)", "Keep meta description between 120 and 160 characters"],
  ["description-length", "warning", `${SITE}/features/content`, "Meta description is 108 characters (min 120)", "Keep meta description between 120 and 160 characters"],
  ["missing-viewport", "warning", `${SITE}/blog/2024-launch-notes`, "Page has no viewport meta tag", "Add <meta name=viewport content='width=device-width, initial-scale=1'>"],
  // --- notice (12) ---
  ["slow-page", "notice", `${SITE}/blog/core-web-vitals`, "Page load time is 2118 ms", "Optimize images and defer non-critical JS to improve load time"],
  ["slow-page", "notice", `${SITE}/blog/seo-for-saas`, "Page load time is 1743 ms", "Optimize images and defer non-critical JS to improve load time"],
  ["slow-page", "notice", `${SITE}/blog/ai-seo-tools-guide`, "Page load time is 1567 ms", "Optimize images and defer non-critical JS to improve load time"],
  ["missing-og-tags", "notice", `${SITE}/docs/api`, "Page has no Open Graph tags", "Add og:title and og:description meta tags"],
  ["missing-og-tags", "notice", `${SITE}/docs/api-v1`, "Page has no Open Graph tags", "Add og:title and og:description meta tags"],
  ["missing-og-tags", "notice", `${SITE}/blog/2024-launch-notes`, "Page has no Open Graph tags", "Add og:title and og:description meta tags"],
  ["missing-twitter-card", "notice", `${SITE}/blog/schema-guide`, "Page has no Twitter Card meta tags", "Add twitter:card summary_large_image meta tags"],
  ["missing-twitter-card", "notice", `${SITE}/blog/sitemap-checklist`, "Page has no Twitter Card meta tags", "Add twitter:card summary_large_image meta tags"],
  ["missing-lang", "notice", `${SITE}/contact`, "HTML tag has no lang attribute", "Add lang='en' to the <html> tag"],
  ["missing-lang", "notice", `${SITE}/blog/2024-launch-notes`, "HTML tag has no lang attribute", "Add lang='en' to the <html> tag"],
  ["no-sitemap", "notice", `${SITE}/`, "robots.txt does not declare a Sitemap", "Add Sitemap: https://www.acme-example.com/sitemap.xml to robots.txt"],
  ["no-favicon", "notice", `${SITE}/blog/2024-launch-notes`, "Page has no favicon reference", "Add a favicon link to the page head"],
];
const txIssues = db.transaction(() => {
  for (const [type, severity, url, detail, suggestion] of issues) {
    issueIns.run(auditId, type, severity, url, detail, suggestion, USER);
  }
});
txIssues();
console.log(`[seed] audit #${auditId}: health 78, issues ${issues.length} (5 error / 18 warning / 12 notice)`);

// ---------- 6. content_checks 历史（AI SEO Tools Guide 目标页） ----------
const contentIns = db.prepare(`
  INSERT INTO content_checks (url, keyword, score, word_count, density, checks_json,
    title_suggestions, keyword_density, readability_score, readability_level, word_count_full,
    heading_structure, internal_links_count, external_links_count, images_count, images_without_alt,
    meta_title_length, meta_description_length, first_100_words, top_keywords, content_score, created_at, user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const guideChecks = [
  { name: "Title contains keyword", passed: true, current: "AI SEO Tools Guide: 12 Platforms Compared for 2026", suggested: "" },
  { name: "Meta description length", passed: false, current: "96 chars", suggested: "Extend to 120-160 characters with a benefit-driven summary" },
  { name: "H1 matches intent", passed: true, current: "The Complete Guide to AI SEO Tools", suggested: "" },
  { name: "Keyword in first 100 words", passed: true, current: "AI SEO tools appear in sentence 2", suggested: "" },
  { name: "Keyword density", passed: true, current: "2.8%", suggested: "" },
  { name: "Images have alt text", passed: false, current: "3 of 9 images missing alt", suggested: "Describe each screenshot in the alt attribute" },
];
const contentRows = [
  { url: `${SITE}/blog/ai-seo-tools-guide`, keyword: "AI SEO tools", score: 72, word_count: 1846, density: 2.8, content_score: 68, readability: 58, created: dtStr(21, 14, 5) },
  { url: `${SITE}/blog/ai-seo-tools-guide`, keyword: "AI SEO tools", score: 81, word_count: 2312, density: 2.6, content_score: 76, readability: 62, created: dtStr(6, 15, 40) },
  { url: `${SITE}/blog/seo-for-saas`, keyword: "SEO tools for SaaS", score: 88, word_count: 1580, density: 3.1, content_score: 82, readability: 60, created: dtStr(12, 11, 20) },
];
const txContent = db.transaction(() => {
  for (const r of contentRows) {
    contentIns.run(
      r.url, r.keyword, r.score, r.word_count, r.density, JSON.stringify(guideChecks),
      JSON.stringify(["AI SEO Tools Guide: 12 Platforms Tested (2026 Edition)", "Best AI SEO Tools for SaaS Teams in 2026"]),
      JSON.stringify([{ keyword: "AI SEO tools", count: 42, density: r.density }]),
      r.readability, "Fairly difficult to read", r.word_count,
      JSON.stringify([{ level: 1, text: "The Complete Guide to AI SEO Tools" }, { level: 2, text: "What Are AI SEO Tools?" }, { level: 2, text: "How We Tested" }]),
      14, 6, 9, 3, 52, 96,
      "AI SEO tools have moved from novelty to necessity. In this guide we compare twelve platforms, from enterprise suites to affordable challengers, on audit depth, rank tracking accuracy and content optimization quality.",
      JSON.stringify([{ word: "SEO", count: 96 }, { word: "tools", count: 61 }, { word: "AI", count: 54 }]),
      r.content_score, r.created, USER
    );
  }
});
txContent();
console.log(`[seed] ${contentRows.length} content check history rows`);

// ---------- 7. reports ----------
const reportIns = db.prepare(
  `INSERT INTO reports (project_id, type, title, data_json, pdf_path, created_at, user_id)
   VALUES (?, ?, ?, ?, NULL, ?, ?)`
);
const reports = [
  ["weekly", "Weekly Report · acme-example.com", JSON.stringify({ summary: "Health score 74→78. 5 keywords entered top 10.", auditScore: 78, rankChanges: { up: 9, down: 4 }, keywordGrowth: 5 })],
  ["audit", "Audit Report · acme-example.com", JSON.stringify({ healthScore: 78, errors: 5, warnings: 18, notices: 12, pagesCrawled: 96 })],
  ["ranking", "Ranking Report · acme-example.com", JSON.stringify({ trackedKeywords: 20, top10: 9, up: 9, down: 4 })],
  ["content", "Content Report · acme-example.com", JSON.stringify({ pagesChecked: 2, avgScore: 74 })],
];
const txReports = db.transaction(() => {
  const ages = [4, 4, 2, 9];
  reports.forEach(([type, title, data], i) => {
    reportIns.run(projectId, type, title, data, dtStr(ages[i], 9, 15), USER);
  });
});
txReports();
console.log(`[seed] ${reports.length} reports`);

// ---------- 8. alerts（近 7 天英文告警，供 dashboard 预警区） ----------
const alertIns = db.prepare(
  `INSERT INTO alerts (type, level, title, detail, domain, created_at, read, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const alerts = [
  ["rank", "warning", "Keyword dropped out of top 10", "'SEO audit tool' moved from #7 to #8 for acme-example.com", DOMAIN, dtStr(1, 9, 12), 0, USER],
  ["audit", "error", "3 pages missing meta description", "Latest full audit found 5 critical issues on acme-example.com", DOMAIN, dtStr(0, 8, 45), 0, USER],
  ["audit", "warning", "Broken internal link detected", "/features/pricing-comparison returns HTTP 404", DOMAIN, dtStr(0, 8, 42), 0, USER],
  ["rank", "info", "Daily rank refresh completed", "20 keywords refreshed for acme-example.com", DOMAIN, dtStr(2, 9, 5), 1, USER],
  ["rank", "warning", "Keyword ranking dropped", "'schema markup validator' fell from #31 to #34", DOMAIN, dtStr(3, 9, 8), 1, USER],
  ["audit", "warning", "Health score changed", "acme-example.com health score 74 → 78 after latest audit", DOMAIN, dtStr(4, 9, 3), 1, USER],
];
const txAlerts = db.transaction(() => {
  for (const a of alerts) alertIns.run(...a);
});
txAlerts();
console.log(`[seed] ${alerts.length} alerts`);

// ---------- 汇总 ----------
const counts = {};
for (const t of ["projects", "audits", "audit_issues", "tracked_keywords", "rank_history", "competitors", "competitor_ranks", "content_checks", "reports", "alerts"]) {
  counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id = ?`).get(USER).c;
}
console.log("[seed] done:", JSON.stringify(counts));
console.log(`[seed] PROJECT_ID=${projectId}  (localStorage seeo:selected-project-id = "${projectId}")`);
db.close();

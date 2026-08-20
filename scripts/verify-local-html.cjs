// 本地生产模式 HTML 独立验证：提取每页 title / description / H1 / H2 / H3
/* eslint-disable @typescript-eslint/no-require-imports */
const cheerio = require("cheerio");

const BASE = "http://localhost:3000";
const PAGES = [
  "/", "/zh",
  "/pricing", "/zh/pricing",
  "/docs", "/zh/docs",
  "/about", "/zh/about",
  "/features/seo-audit", "/zh/features/seo-audit",
  "/features/rank-tracking", "/zh/features/rank-tracking",
  "/features/backlink-analysis", "/zh/features/backlink-analysis",
  "/privacy", "/zh/privacy",
  "/terms", "/zh/terms",
  "/refund", "/zh/refund",
  "/login", "/signup",
];

(async () => {
  const rows = [];
  for (const p of PAGES) {
    const res = await fetch(BASE + p, { headers: { "Accept-Language": "en" }, redirect: "follow" });
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text();
    const desc = $('meta[name="description"]').attr("content") ?? "";
    const h1 = $("h1").map((_, el) => $(el).text().trim()).get();
    const h2 = $("h2").length;
    const h3 = $("h3").length;
    rows.push({
      path: p,
      finalUrl: res.url,
      titleLen: title.length,
      title,
      desc,
      descLen: desc.length,
      h1: h1.join(" | "),
      h1Count: h1.length,
      h2, h3,
    });
  }

  // 表格输出
  console.log("path\ttitleLen\tdescLen\th1Count\th2\th3\ttitle\th1");
  for (const r of rows) {
    console.log(`${r.path}\t${r.titleLen}\t${r.descLen}\t${r.h1Count}\t${r.h2}\t${r.h3}\t${r.title}\t${r.h1}`);
  }

  // 汇总断言
  const titles = rows.map((r) => r.title);
  const descs = rows.map((r) => r.desc);
  const h1s = rows.filter((r) => r.h1Count > 0).map((r) => r.h1);
  const dupT = titles.filter((t, i) => titles.indexOf(t) !== i);
  const dupD = descs.filter((d, i) => descs.indexOf(d) !== i);
  const dupH = h1s.filter((h, i) => h1s.indexOf(h) !== i);
  const badTitle = rows.filter((r) => r.titleLen < 30 || r.titleLen > 60);
  const badDesc = rows.filter((r) => r.descLen < 120 || r.descLen > 160);
  const missingH1 = rows.filter((r) => r.h1Count === 0);
  const noHeading = rows.filter((r) => r.h2 === 0 && r.h3 === 0);

  console.log("\n===== 汇总 =====");
  console.log("重复 title:", dupT.length ? dupT : "无");
  console.log("重复 description:", dupD.length ? dupD : "无");
  console.log("重复 H1:", dupH.length ? dupH : "无");
  console.log("title 长度越界:", badTitle.length ? badTitle.map((r) => `${r.path}(${r.titleLen})`) : "无");
  console.log("description 长度越界:", badDesc.length ? badDesc.map((r) => `${r.path}(${r.descLen})`) : "无");
  console.log("缺 H1:", missingH1.length ? missingH1.map((r) => r.path) : "无");
  console.log("无 H2/H3:", noHeading.length ? noHeading.map((r) => r.path) : "无");
})();

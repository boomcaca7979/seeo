// ===== Directory Submission 截图导出（1280×800，英文 UI） =====
// 依赖 playwright-core（node_modules 已装）+ 系统 Chrome（channel: "chrome"）。
// 前置：npm run dev 已启动、scripts/seed-demo-screenshots.mjs 已跑。
// 用法：node scripts/capture-demo-screenshots.mjs
//
// 输出：seo-growth/directory-assets/screenshots/01-06 *.png
// 同时输出每页可见中文检测结果（应为 0 处）。

import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "seo-growth", "directory-assets", "screenshots");
const BASE = "http://localhost:3000";
const PROJECT_ID = process.env.SEEO_PROJECT_ID || "13";
const DOMAIN = "acme-example.com";

// [file, path, scrollY, waitMs]
const shots = [
  ["01-dashboard.png", "/app", 0, 4000],
  ["02-seo-audit.png", "/app/audit", 500, 4500],
  ["03-rank-tracking.png", "/app/position-tracking", 350, 4000],
  ["04-competitor-analysis.png", "/app/competitors", 0, 4000],
  ["05-content-optimization.png", "/app/content", 450, 4000],
  ["06-seo-report.png", "/app/reports", 400, 4000],
];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "America/New_York",
});
await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);

const page = await context.newPage();

// 首次进入建立 origin，写入 localStorage 后刷新
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.evaluate((pid) => {
  localStorage.setItem("seeo:selected-project-id", pid);
  localStorage.setItem("seeo:last-audit-domain", "acme-example.com");
  localStorage.setItem("cookie-consent", "accepted");
}, PROJECT_ID);

const results = [];
for (const [file, route, scrollY, waitMs] of shots) {
  await page.goto(`${BASE}${route}${route === "/app/audit" ? `?domain=${DOMAIN}` : ""}`, {
    waitUntil: "networkidle",
    timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(waitMs);

  // 滚动到目标位置（先滚到底触发懒加载，再回到目标 offset）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(900);

  const out = path.join(OUT_DIR, file);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 800 } });

  // 可见中文检测（忽略 <title>，只查 body 可见文本）
  const cjk = await page.evaluate(() => {
    const re = /[\u4e00-\u9fff]/;
    const hits = [];
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && re.test(child.textContent || "")) {
          hits.push((child.textContent || "").trim().slice(0, 40));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const s = getComputedStyle(child);
          if (s.display !== "none" && s.visibility !== "hidden") walk(child);
        }
      }
    };
    walk(document.body);
    return hits;
  });

  const dims = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  results.push({ file, route, cjkCount: cjk.length, cjkSample: cjk.slice(0, 3), dims });
  console.log(`[shot] ${file} ${route} cjk=${cjk.length}${cjk.length ? " " + JSON.stringify(cjk.slice(0, 3)) : ""}`);
}

console.log("[shot] viewport:", JSON.stringify(results[0].dims));
await browser.close();
console.log("[shot] done →", OUT_DIR);

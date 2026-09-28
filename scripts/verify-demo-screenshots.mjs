// ===== 截图页面数据断言（验证 demo 数据真实渲染，非空壳） =====
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const checks = [
  ["/app", ["Acme SaaS Platform", "acme-example.com", "78"]],
  ["/app/audit?domain=acme-example.com", ["78", "Broken internal links", "Missing description"]],
  ["/app/position-tracking", ["technical SEO audit tool", "United States"]],
  ["/app/competitors", ["Ahrefs", "Semrush", "SE Ranking"]],
  ["/app/content", ["ai-seo-tools-guide"]],
  ["/app/reports", ["acme-example.com"]],
];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
const page = await context.newPage();
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem("seeo:selected-project-id", "13");
  localStorage.setItem("seeo:last-audit-domain", "acme-example.com");
  localStorage.setItem("cookie-consent", "accepted");
});

let fail = 0;
for (const [route, needles] of checks) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);
  const missing = needles.filter((n) => !text.includes(n));
  const rows = text.split("\n").filter((l) => l.trim()).length;
  const ok = missing.length === 0;
  if (!ok) fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${route} lines=${rows}${missing.length ? " missing=" + JSON.stringify(missing) : ""}`);
}
await browser.close();
process.exit(fail ? 1 : 0);

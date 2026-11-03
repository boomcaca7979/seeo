// ===== Website Content Gap 扫描执行器（after() 后台任务） =====
//
// 流程：sitemap 发现 → robots 基础遵守 → 受限并发抓取（同 host、SSRF 校验逐跳执行）→
// 页面清单 upsert → 进度实时更新 → 完成/失败/取消。
// 取消语义：每批开始前重读扫描状态，非 running 立即停止且不再发起新请求。

import { discoverSitemapUrls, extractPageInventory } from "./sitemap";
import { safeFetch, fetchRobotsRules, isAllowedByRobots, BlockedUrlError } from "./fetcher";
import {
  createSiteScan,
  finishScan,
  getSiteScan,
  updateScanProgress,
  upsertSitePage,
} from "@/lib/db/site-content";

export const MAX_PAGES_PER_SCAN = 50;
const CONCURRENCY = 3;

function stripWww(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

export interface StartScanInput {
  userId: string;
  projectId: number;
  domain: string;
}

/** 创建扫描并立即开始后台执行（创建与执行分离：API 先落库，after() 驱动执行） */
export async function startContentGapScan(input: StartScanInput): Promise<{ scanId: number }> {
  const scan = await createSiteScan(input.userId, input.projectId, input.domain);
  void runScan(input.userId, input.projectId, input.domain, scan.id);
  return { scanId: scan.id };
}

/** 对已创建的 scan 执行抓取（API route 的 after() 调用） */
export async function runScanById(userId: string, projectId: number, domain: string, scanId: number): Promise<void> {
  await runScan(userId, projectId, domain, scanId);
}

async function runScan(userId: string, projectId: number, domain: string, scanId: number): Promise<void> {
  const targetHost = stripWww(domain);
  try {
    // 1. Sitemap 发现
    const discovery = await discoverSitemapUrls(`https://${domain}`);
    const sameHost = discovery.urls.filter((u) => {
      try {
        return stripWww(new URL(u).host) === targetHost;
      } catch {
        return false;
      }
    });
    const queue = sameHost.slice(0, MAX_PAGES_PER_SCAN);
    if (queue.length === 0) {
      await finishScan(userId, scanId, "failed", { error: "未发现可抓取的 sitemap URL（已尝试 robots 声明与 /sitemap.xml）" });
      return;
    }

    // 2. robots 基础遵守
    const robots = await fetchRobotsRules(`https://${domain}`);

    let crawled = 0;
    let failed = 0;
    await updateScanProgress(userId, scanId, { requested: queue.length, sitemapUrl: discovery.usedSitemaps[0] ?? null });

    // 3. 受限并发抓取；每批开始前检查取消状态
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const still = await getSiteScan(userId, scanId);
      if (!still || still.status !== "running") return; // 用户取消：立即停止
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const pathWithQuery = new URL(url).pathname + new URL(url).search;
            if (!isAllowedByRobots(pathWithQuery, robots)) {
              failed += 1;
              await upsertSitePage(userId, projectId, scanId, { url, error: "robots.txt disallow" });
              return;
            }
            const res = await safeFetch(url);
            if (!res || res.status !== 200 || !res.body) {
              failed += 1;
              await upsertSitePage(userId, projectId, scanId, {
                url,
                httpStatus: res?.status ?? 0,
                error: res?.status ? `HTTP ${res.status}` : "抓取失败",
              });
              return;
            }
            const inventory = extractPageInventory(res.body, url);
            crawled += 1;
            await upsertSitePage(userId, projectId, scanId, {
              url,
              canonicalUrl: inventory.canonicalUrl,
              title: inventory.title,
              h1: inventory.h1,
              metaDescription: inventory.metaDescription,
              httpStatus: res.status,
              internalLinks: inventory.internalLinks,
            });
          } catch (e) {
            failed += 1;
            const message = e instanceof BlockedUrlError ? e.message : (e as Error).message;
            await upsertSitePage(userId, projectId, scanId, { url, error: message }).catch(() => {});
          }
        }),
      );
      await updateScanProgress(userId, scanId, { requested: queue.length, crawled, failed });
    }

    await finishScan(userId, scanId, "completed");
  } catch (e) {
    await finishScan(userId, scanId, "failed", { error: (e as Error).message });
  }
}

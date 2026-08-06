// ===== 排名预警生成（共享逻辑） =====
// 从 /api/tracking/refresh/route.ts 提取，供 API 路由和自动刷新任务复用

import {
  getPreviousRankHistory,
  createAlert,
  hasAlertToday,
} from "@/lib/db";

interface RankAlertContext {
  id: number;
  keyword: string;
  domain: string;
}

/**
 * 对比上一次排名记录，生成预警（带同日去重兜底）
 * @param tk 关键词上下文
 * @param newPos 本次排名（null 表示未进前 100）
 * @param today 今日日期 YYYY-MM-DD
 */
export async function generateRankAlert(
  tk: RankAlertContext,
  newPos: number | null,
  today: string
): Promise<void> {
  const prev = await getPreviousRankHistory(tk.id, today);
  if (!prev) return; // 没有历史记录，不生成预警

  const oldPos = prev.position;

  // 上榜掉出：之前有排名，现在 null
  if (oldPos !== null && newPos === null) {
    const title = `关键词「${tk.keyword}」从排名 ${oldPos} 掉出前 100`;
    if (await hasAlertToday(tk.domain, title)) return;
    await createAlert({
      type: "rank_drop",
      level: "error",
      title,
      detail: `域名 ${tk.domain} · 上次排名 ${oldPos}（${prev.date}）`,
      domain: tk.domain,
    });
    return;
  }

  // 新上榜：之前 null，现在有排名 → 不预警
  if (oldPos === null && newPos !== null) return;

  // 两者都有排名
  if (oldPos !== null && newPos !== null) {
    const drop = newPos - oldPos; // 正 = 下降（数字变大）
    const up = oldPos - newPos;   // 正 = 上升（数字变小）

    if (drop >= 20) {
      const title = `关键词「${tk.keyword}」排名下降 ${drop} 位`;
      if (await hasAlertToday(tk.domain, title)) return;
      await createAlert({
        type: "rank_drop",
        level: "error",
        title,
        detail: `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
        domain: tk.domain,
      });
    } else if (drop >= 5) {
      const title = `关键词「${tk.keyword}」排名下降 ${drop} 位`;
      if (await hasAlertToday(tk.domain, title)) return;
      await createAlert({
        type: "rank_drop",
        level: "warning",
        title,
        detail: `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
        domain: tk.domain,
      });
    } else if (up >= 10) {
      const title = `关键词「${tk.keyword}」排名上升 ${up} 位`;
      if (await hasAlertToday(tk.domain, title)) return;
      await createAlert({
        type: "rank_up",
        level: "info",
        title,
        detail: `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
        domain: tk.domain,
      });
    }
  }
}

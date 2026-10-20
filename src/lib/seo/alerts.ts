// ===== 排名预警生成（共享逻辑） =====
// 从 /api/tracking/refresh/route.ts 提取，供 API 路由和自动刷新任务复用

import {
  getPreviousRankHistory,
  createAlert,
  hasAlertToday,
} from "@/lib/db";
import { alertLText } from "@/lib/alert-text";

interface RankAlertContext {
  id: number;
  keyword: string;
  domain: string;
}

/**
 * 对比上一次排名记录，生成预警（带同日去重兜底）
 * @param userId 用户 ID
 * @param tk 关键词上下文
 * @param newPos 本次排名（null 表示未进前 100）
 * @param today 今日日期 YYYY-MM-DD
 */
export async function generateRankAlert(
  userId: string,
  tk: RankAlertContext,
  newPos: number | null,
  today: string
): Promise<void> {
  const prev = await getPreviousRankHistory(userId, tk.id, today);
  if (!prev) return; // 没有历史记录，不生成预警

  const oldPos = prev.position;
  const positions = (n: number) => `${n} ${n === 1 ? "position" : "positions"}`;

  // 上榜掉出：之前有排名，现在 null
  if (oldPos !== null && newPos === null) {
    const title = alertLText(
      `关键词「${tk.keyword}」从排名 ${oldPos} 掉出前 100`,
      `Keyword "${tk.keyword}" fell from #${oldPos} out of the top 100`
    );
    if (await hasAlertToday(userId, tk.domain, title)) return;
    await createAlert(userId, {
      type: "rank_drop",
      level: "error",
      title,
      detail: alertLText(
        `域名 ${tk.domain} · 上次排名 ${oldPos}（${prev.date}）`,
        `Domain ${tk.domain} · previous rank ${oldPos} (${prev.date})`
      ),
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
      const title = alertLText(
        `关键词「${tk.keyword}」排名下降 ${drop} 位`,
        `Keyword "${tk.keyword}" dropped ${positions(drop)}`
      );
      if (await hasAlertToday(userId, tk.domain, title)) return;
      await createAlert(userId, {
        type: "rank_drop",
        level: "error",
        title,
        detail: alertLText(
          `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
          `Domain ${tk.domain} · ${oldPos} → ${newPos}`
        ),
        domain: tk.domain,
      });
    } else if (drop >= 5) {
      const title = alertLText(
        `关键词「${tk.keyword}」排名下降 ${drop} 位`,
        `Keyword "${tk.keyword}" dropped ${positions(drop)}`
      );
      if (await hasAlertToday(userId, tk.domain, title)) return;
      await createAlert(userId, {
        type: "rank_drop",
        level: "warning",
        title,
        detail: alertLText(
          `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
          `Domain ${tk.domain} · ${oldPos} → ${newPos}`
        ),
        domain: tk.domain,
      });
    } else if (up >= 10) {
      const title = alertLText(
        `关键词「${tk.keyword}」排名上升 ${up} 位`,
        `Keyword "${tk.keyword}" climbed ${positions(up)}`
      );
      if (await hasAlertToday(userId, tk.domain, title)) return;
      await createAlert(userId, {
        type: "rank_up",
        level: "info",
        title,
        detail: alertLText(
          `域名 ${tk.domain} · ${oldPos} → ${newPos}`,
          `Domain ${tk.domain} · ${oldPos} → ${newPos}`
        ),
        domain: tk.domain,
      });
    }
  }
}

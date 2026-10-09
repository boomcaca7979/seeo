// ===== Owner Console：数据源同步/导入事件记录 =====
//
// 目的：区分「凭据已配置」与「真实数据已到达」，并保留**最近一次成功**与**最近一次失败**
// 的事实（时间 + 原因），供 /admin/data-sources 五态展示：
//   凭据未配置 / 已配置但无法连接 / 连接成功但尚无数据 / 已正常同步真实数据 / 上一次同步失败
//
// 写入是 best-effort：记录失败绝不影响业务本身（导入/同步照常返回结果）。

import { getAdapter } from "@/lib/db/migrations";

export type SourceEventKind = "success" | "error";

/** 记录一次数据源事件（GSC 同步/导入、广告导入、Creem webhook 等） */
export async function recordSourceEvent(
  source: string,
  event: SourceEventKind,
  message: string
): Promise<void> {
  try {
    const db = await getAdapter();
    await db.run(
      `INSERT INTO admin_source_events (source, event, message) VALUES (?, ?, ?)`,
      [source.slice(0, 60), event, message.slice(0, 500)]
    );
  } catch {
    // 事件记录失败不影响业务（表未迁移成功 / DB 不可用时静默）
  }
}

export interface SourceEvent {
  event: SourceEventKind;
  message: string;
  createdAt: string;
}

/** 每个数据源最近一次事件（success 或 error 中更新的那个）；无记录 → Map 空项 */
export async function getLatestSourceEvents(): Promise<Map<string, SourceEvent>> {
  const map = new Map<string, SourceEvent>();
  try {
    const db = await getAdapter();
    const rows = (await db.query(
      `SELECT source, event, message, created_at
         FROM admin_source_events
        WHERE id IN (SELECT MAX(id) FROM admin_source_events GROUP BY source)`
    )) as Array<Record<string, unknown>>;
    for (const r of rows) {
      map.set(String(r.source), {
        event: String(r.event) === "error" ? "error" : "success",
        message: String(r.message ?? ""),
        createdAt: String(r.created_at ?? ""),
      });
    }
  } catch {
    // 表不存在等：如实返回空（UI 显示「暂无同步记录」）
  }
  return map;
}

/** 每个数据源最近一次**成功**事件（与最近失败分开展示） */
export async function getLatestSourceSuccesses(): Promise<Map<string, SourceEvent>> {
  const map = new Map<string, SourceEvent>();
  try {
    const db = await getAdapter();
    const rows = (await db.query(
      `SELECT source, message, created_at
         FROM admin_source_events
        WHERE id IN (
          SELECT MAX(id) FROM admin_source_events WHERE event = 'success' GROUP BY source
        )`
    )) as Array<Record<string, unknown>>;
    for (const r of rows) {
      map.set(String(r.source), {
        event: "success",
        message: String(r.message ?? ""),
        createdAt: String(r.created_at ?? ""),
      });
    }
  } catch {
    // 同上
  }
  return map;
}

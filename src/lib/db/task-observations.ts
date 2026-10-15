// ===== 任务观测持久化（结果反馈闭环）=====
//
// 只存**真实指标观测**，不存用户的主观声明：
//   - baseline 一旦写入**不再覆盖**（保证"执行前基线"不被事后美化）
//   - latest 每次真实观测（再审计 / 排名刷新）覆盖并累计 observations 次数
//   - verdict 由调用方按 kind 计算；无法判断时写 indeterminate，绝不硬判"有效/无效"

import { getAdapter } from "./migrations";

export type ObservationVerdict = "pending" | "improved" | "unchanged" | "worse" | "indeterminate";

/** 指标集合（键为指标名，值为真实数值；缺失用 null，不填 0 冒充） */
export type ObservationMetrics = Record<string, number | null>;

export interface TaskObservationRow {
  id: number;
  user_id: string;
  domain: string;
  task_id: string;
  task_source: string;
  kind: string;
  baseline_json: string | null;
  baseline_at: string | null;
  latest_json: string | null;
  latest_at: string | null;
  observations: number;
  verdict: ObservationVerdict | null;
  window_days: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function parseMetrics(raw: string | null): ObservationMetrics | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: ObservationMetrics = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = typeof v === "number" ? v : null;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 写入执行前基线。**已存在基线时不做任何修改**（幂等、不可覆盖）。
 * @returns true = 本次新建了基线
 */
export async function captureBaseline(params: {
  userId: string;
  domain: string;
  taskId: string;
  taskSource: string;
  kind: string;
  metrics: ObservationMetrics;
}): Promise<boolean> {
  const db = await getAdapter();
  const existing = await db.get(
    `SELECT id FROM task_observations WHERE user_id = ? AND domain = ? AND task_id = ?`,
    [params.userId, params.domain, params.taskId]
  );
  if (existing) return false;
  await db.run(
    `INSERT INTO task_observations (user_id, domain, task_id, task_source, kind, baseline_json, baseline_at, verdict)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'pending')
     ON CONFLICT(user_id, domain, task_id) DO NOTHING`,
    [
      params.userId,
      params.domain,
      params.taskId,
      params.taskSource,
      params.kind,
      JSON.stringify(params.metrics),
    ]
  );
  return true;
}

/** 记录一次真实观测结果（覆盖 latest，累计次数） */
export async function recordObservation(params: {
  userId: string;
  domain: string;
  taskId: string;
  metrics: ObservationMetrics;
  verdict: ObservationVerdict;
  windowDays?: number | null;
  note?: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE task_observations SET
       latest_json = ?,
       latest_at = datetime('now'),
       observations = observations + 1,
       verdict = ?,
       window_days = COALESCE(?, window_days),
       note = COALESCE(?, note),
       updated_at = datetime('now')
     WHERE user_id = ? AND domain = ? AND task_id = ?`,
    [
      JSON.stringify(params.metrics),
      params.verdict,
      params.windowDays ?? null,
      params.note ?? null,
      params.userId,
      params.domain,
      params.taskId,
    ]
  );
}

export async function listObservations(
  userId: string,
  domain: string
): Promise<Map<string, TaskObservationRow>> {
  const db = await getAdapter();
  const rows = (await db.query(
    `SELECT * FROM task_observations WHERE user_id = ? AND domain = ?`,
    [userId, domain]
  )) as TaskObservationRow[];
  const map = new Map<string, TaskObservationRow>();
  for (const r of rows) map.set(r.task_id, r);
  return map;
}

/** 所有已捕获基线、但尚未获得最新观测的任务（供审计完成后集中观测） */
export async function listObservableTasks(
  userId: string,
  domain: string
): Promise<TaskObservationRow[]> {
  const db = await getAdapter();
  return (await db.query(
    `SELECT * FROM task_observations WHERE user_id = ? AND domain = ? AND baseline_json IS NOT NULL`,
    [userId, domain]
  )) as TaskObservationRow[];
}

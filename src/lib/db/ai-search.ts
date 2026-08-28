// ===== AI Search Run 领域（P0-03-B） =====
// ai_search_runs：AI Search Intelligence 的服务端持久化——SeeO 对 OpenSEO 的第一个
// 明确差异点（OpenSEO 只有 R2 cache + localStorage，无时间维度）。
// 只存 run 摘要（mentions/citations/SOV/平台/模型/locale/成本），不存 raw answer 全文、
// 不存 provider payload，避免无限增长仓库。

import { getAdapter } from "./migrations";

export interface AiSearchRun {
  id: number;
  user_id: string;
  project_id: number;
  /** brand_lookup | prompt */
  run_type: string;
  /** 目标（brand 字符串或 domain） */
  target: string;
  /** brand | domain */
  target_type: string;
  platforms_json: string;
  models_json: string;
  requested_location_code: number | null;
  requested_language: string | null;
  effective_location_code: number | null;
  effective_language: string | null;
  /** run 摘要（mentions/citations/SOV/warnings），不含 raw answer */
  summary_json: string;
  /** 本次 run 的 DataForSEO 真实成本合计（USD，provider cost 字段） */
  provider_cost_usd: number | null;
  created_at: string;
}

export interface CreateAiSearchRunParams {
  user_id: string;
  project_id: number;
  run_type: string;
  target: string;
  target_type: string;
  platforms: string[];
  models: string[];
  requested_location_code: number | null;
  requested_language: string | null;
  effective_location_code: number | null;
  effective_language: string | null;
  summary: Record<string, unknown>;
  provider_cost_usd: number | null;
}

export async function createAiSearchRun(userId: string, params: CreateAiSearchRunParams): Promise<number> {
  const db = await getAdapter();
  const result = await db.run(`
    INSERT INTO ai_search_runs (
      user_id, project_id, run_type, target, target_type,
      platforms_json, models_json,
      requested_location_code, requested_language, effective_location_code, effective_language,
      summary_json, provider_cost_usd
    ) VALUES (
      @user_id, @project_id, @run_type, @target, @target_type,
      @platforms_json, @models_json,
      @requested_location_code, @requested_language, @effective_location_code, @effective_language,
      @summary_json, @provider_cost_usd
    )
  `, [{
    ...params,
    platforms_json: JSON.stringify(params.platforms),
    models_json: JSON.stringify(params.models),
    summary_json: JSON.stringify(params.summary),
  }]);
  void result;
  const row = await db.get(`SELECT id FROM ai_search_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [userId]) as { id: number } | undefined;
  return row ? Number(row.id) : 0;
}

export interface AiSearchRunSummary {
  id: number;
  runType: string;
  target: string;
  targetType: string;
  platforms: string[];
  models: string[];
  requestedLocationCode: number | null;
  requestedLanguage: string | null;
  effectiveLocationCode: number | null;
  effectiveLanguage: string | null;
  summary: Record<string, unknown>;
  providerCostUsd: number | null;
  createdAt: string;
}

export async function listAiSearchRuns(userId: string, params: {
  projectId: number;
  runType?: string;
  target?: string;
  /** YYYY-MM-DD（含） */
  from?: string;
  /** YYYY-MM-DD（含） */
  to?: string;
  limit?: number;
}): Promise<AiSearchRunSummary[]> {
  const db = await getAdapter();
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const conditions: string[] = [`user_id = @user_id`, `project_id = @project_id`];
  const values: Record<string, unknown> = { user_id: userId, project_id: params.projectId, limit };
  if (params.runType) {
    conditions.push(`run_type = @run_type`);
    values.run_type = params.runType;
  }
  if (params.target) {
    conditions.push(`target = @target`);
    values.target = params.target;
  }
  if (params.from) {
    conditions.push(`created_at >= @from`);
    values.from = `${params.from} 00:00:00`;
  }
  if (params.to) {
    conditions.push(`created_at <= @to`);
    values.to = `${params.to} 23:59:59`;
  }
  const rows = await db.query(`
    SELECT * FROM ai_search_runs
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `, [values]) as Record<string, unknown>[];

  return rows.map((row) => {
    let platforms: string[] = [];
    let models: string[] = [];
    let summary: Record<string, unknown> = {};
    try {
      platforms = JSON.parse(String(row.platforms_json ?? "[]"));
    } catch { /* 损坏数据按空处理 */ }
    try {
      models = JSON.parse(String(row.models_json ?? "[]"));
    } catch { /* ignore */ }
    try {
      summary = JSON.parse(String(row.summary_json ?? "{}"));
    } catch { /* ignore */ }
    return {
      id: Number(row.id),
      runType: String(row.run_type),
      target: String(row.target),
      targetType: String(row.target_type),
      platforms,
      models,
      requestedLocationCode: row.requested_location_code === null || row.requested_location_code === undefined ? null : Number(row.requested_location_code),
      requestedLanguage: row.requested_language ? String(row.requested_language) : null,
      effectiveLocationCode: row.effective_location_code === null || row.effective_location_code === undefined ? null : Number(row.effective_location_code),
      effectiveLanguage: row.effective_language ? String(row.effective_language) : null,
      summary,
      providerCostUsd: row.provider_cost_usd === null || row.provider_cost_usd === undefined ? null : Number(row.provider_cost_usd),
      createdAt: String(row.created_at),
    };
  });
}

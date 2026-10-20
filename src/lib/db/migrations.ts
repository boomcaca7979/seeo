// ===== 数据库连接、初始化与迁移（共享模块） =====
// 各领域文件通过 getAdapter() 获取数据库连接
// 数据库文件：data/seeo.db（已加入 .gitignore）
// 以后迁移 Supabase 时只需替换本文件实现，页面/API 路由不动

import * as fsSync from "node:fs";
import * as os from "node:os";
import path from "node:path";
import {
  applyLocalSqlitePragmas,
  isBusyDbError,
  SQLiteAdapter,
  type DBAdapter,
  type MigrationControl,
} from "./adapter";

/**
 * demo 分支本地 SQLite 路径。
 * 默认仍是 `<cwd>/data/seeo.db`（生产/demo 行为不变）；`SEO_SQLITE_DB_PATH`
 * 只用于把这条路径显式指向别处——测试隔离要求每条用例都能声明并断言自己的库。
 */
const EXPLICIT_DB_PATH_ENV = "SEO_SQLITE_DB_PATH";

export function localSqliteDbPath(): string {
  const explicit = process.env[EXPLICIT_DB_PATH_ENV]?.trim();
  return explicit ? path.resolve(explicit) : path.join(process.cwd(), "data", "seeo.db");
}

/**
 * 测试进程绝不允许打开仓库内（或任何临时目录之外）的数据库文件。
 * 上一轮验收的归属疑问正是「并发测试打开了 <repo>/data/seeo.db」，而事后只能看
 * 当前 hash、无法证明改动是否由测试产生。判据用「必须在系统临时目录内」而不是
 * 「不能等于 <cwd>/data」：demo 分支的默认路径就是 `<cwd>/data/seeo.db`，而跨进程
 * 并发用例正是在临时目录里伪造一个 cwd 来复现 next build worker——前者要被拦，
 * 后者必须放行，只有临时目录判据能同时满足。
 */
function refuseNonTempDbInTests(dbPath: string, source: string): void {
  if (process.env.VITEST !== "true") return;
  const tmp = os.tmpdir();
  const realTmp = fsSync.existsSync(tmp) ? fsSync.realpathSync(tmp) : tmp;
  if (dbPath.startsWith(tmp) || dbPath.startsWith(realTmp)) return;
  throw new Error(
    `[db] Test isolation: refusing the non-temporary database at ${dbPath} (resolved from ${source}); ` +
      `tests must run on a database inside ${realTmp}. Set ${EXPLICIT_DB_PATH_ENV}=<tmpdir>/xxx.db ` +
      "(or TURSO_DATABASE_URL=file://<tmpdir>/xxx.db) so every case runs on its own temporary database."
  );
}

/** `file://` URL → 可比较的绝对路径（非 file: 协议返回 null，远程库不归本闸门管） */
function localPathFromDbUrl(url: string): string | null {
  if (!/^file:\/\//i.test(url)) return null;
  return path.resolve(decodeURIComponent(url.replace(/^file:\/\//i, "")));
}

/**
 * schema 版本契约（写在库里的 `PRAGMA user_version`）。
 * 等于 SCHEMA_VERSION 表示下面的 migrate() 已完整应用过一次；旧库存的是 0，
 * 首次初始化会幂等补跑一遍再盖章，因此不需要人工搬数据。
 * 增删迁移步骤时把 SCHEMA_VERSION +1；读到比它更大的值说明代码比库旧（回滚部署），
 * 此时只做观测、不覆写、不报错——绝不能把新库的版本号倒退回旧版本。
 */
export const SCHEMA_VERSION = 1;

export type SchemaInitReason = "applied" | "current" | "ahead" | "unversioned";

export interface SchemaInitResult {
  /** 本次初始化是否真的执行了迁移体（false = 库里版本已满足，只做了一次读） */
  applied: boolean;
  version: number;
  reason: SchemaInitReason;
}

/** 写锁冲突重试上限（busy_timeout 已让并发 worker 排队，这里只兜住排队仍超时的情况） */
const MIGRATION_ATTEMPTS = 4;

let dbPromise: Promise<DBAdapter> | null = null;
let lastSchemaInit: SchemaInitResult | null = null;

export function getAdapter(): Promise<DBAdapter> {
  // 记忆化 promise 而不是实例：同进程内的并发首调共享同一次建连 + 同一次迁移，
  // 不再各跑各的迁移去抢写锁。失败必须清空，让下一次调用重新初始化。
  if (!dbPromise) {
    dbPromise = openAdapter().catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** 最近一次初始化的迁移结论（诊断与并发测试用；尚未初始化时为 null） */
export function getSchemaInitResult(): SchemaInitResult | null {
  return lastSchemaInit;
}

async function openAdapter(): Promise<DBAdapter> {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  // URL 必须是 libsql:// / https?:// / file: 等合法格式，
  // 否则 libsql 会在运行时抛晦涩的 URL_INVALID 并演变成 500
  // （本地常见诱因：next start 加载了从 Vercel 导出的 .env.production 占位值）
  const isAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTH !== "false";
  const urlValid = !!tursoUrl && /^(libsql|https?|file):\/\//i.test(tursoUrl.trim());

  let db: DBAdapter;
  if (urlValid && tursoToken) {
    const local = localPathFromDbUrl(tursoUrl!.trim());
    if (local) refuseNonTempDbInTests(local, "TURSO_DATABASE_URL");
    const { TursoAdapter } = await import("./turso-adapter");
    db = new TursoAdapter(tursoUrl.trim(), tursoToken);
  } else if (isAuthEnabled) {
    // auth-enabled（生产/真实后端）：缺 Turso 配置属部署错误，显式报错而非隐蔽 500
    throw new Error(
      "[db] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing or invalid. " +
        "Set valid Turso credentials (libsql://… or https://…) for auth-enabled environments."
    );
  } else {
    // demo / auth-disabled：无需远程数据库，回退本地 SQLite（data/seeo.db）
    const dbPath = localSqliteDbPath();
    refuseNonTempDbInTests(
      dbPath,
      process.env[EXPLICIT_DB_PATH_ENV]?.trim() ? EXPLICIT_DB_PATH_ENV : "implicit demo default"
    );
    if (tursoUrl || tursoToken) {
      console.warn(
        "[db] Ignored invalid TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (demo mode, auth disabled) — falling back to local SQLite."
      );
    }
    // local SQLite（动态 import 避免 Vercel 构建时加载原生模块）
    const dir = path.dirname(dbPath);
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    const { default: Database } = await import("better-sqlite3");
    const raw = new Database(dbPath);
    // busy_timeout / foreign_keys / WAL 的连接级准备（含 WAL 转换的等锁退避）
    // 必须在任何迁移语句之前完成，否则并发 worker 会在这里抛「database is locked」。
    await applyLocalSqlitePragmas(raw);
    db = new SQLiteAdapter(raw);
  }

  try {
    lastSchemaInit = await ensureSchema(db);
  } catch (err) {
    // 迁移没成功 = 这个连接不可信：关掉并把原始错误抛给调用方，
    // 绝不返回一个「看起来初始化完成」的半迁移实例。
    db.close();
    throw err;
  }
  return db;
}

/**
 * 迁移闸门：把「检查版本 → 应用迁移 → 盖章」放进独占写锁，多 worker 只有一个真跑。
 *
 * 稳态（user_version 已等于 SCHEMA_VERSION）只剩一次 PRAGMA 读、零写入，
 * 因此 `next build` 的 9 个 worker 不再互相踩写锁；
 * 冷启动时后进者按 busy_timeout 排队，拿到锁后在锁内复查版本 → 直接跳过。
 * 任何一步真失败都原样上抛：不吞 SQLITE_BUSY、不把失败的迁移当成成功、也不无条件跳过。
 */
export async function ensureSchema(db: DBAdapter): Promise<SchemaInitResult> {
  const control = db.migrationControl?.() ?? null;
  if (!control) {
    // 远端 Turso 没有本地文件写锁语义（服务端自己串行化写），
    // 维持旧行为：每次进程初始化幂等执行迁移体，不做版本盖章。
    await migrate(db);
    return { applied: true, version: 0, reason: "unversioned" };
  }

  const version = await control.readVersion();
  if (version > SCHEMA_VERSION) return { applied: false, version, reason: "ahead" };
  if (version === SCHEMA_VERSION) return { applied: false, version, reason: "current" };

  return applyUnderLock(control);
}

async function applyUnderLock(control: MigrationControl): Promise<SchemaInitResult> {
  let lastBusy: unknown = null;

  for (let attempt = 0; attempt < MIGRATION_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(50 * 2 ** (attempt - 1));

    let lock;
    try {
      // BEGIN IMMEDIATE：拿不到写锁时连接级 busy_timeout 会先等，等满才抛错
      lock = await control.acquireLock();
    } catch (err) {
      if (!isBusyDbError(err)) throw err;
      lastBusy = err;
      continue;
    }

    try {
      // 锁内复查：排队期间可能已有 worker 把迁移跑完并提交
      const inside = await lock.getVersion();
      if (inside >= SCHEMA_VERSION) {
        await lock.commit();
        return {
          applied: false,
          version: inside,
          reason: inside > SCHEMA_VERSION ? "ahead" : "current",
        };
      }
      await migrate(lock.adapter);
      await lock.setVersion(SCHEMA_VERSION);
      await lock.commit();
      return { applied: true, version: SCHEMA_VERSION, reason: "applied" };
    } catch (err) {
      // SQLite 的 DDL 是事务性的：回滚后库里不会留下半套结构，
      // 只有锁冲突这种「别人正占着写锁」才重试，其余错误直接上抛。
      await lock.rollback();
      if (!isBusyDbError(err)) throw err;
      lastBusy = err;
    }
  }

  throw new Error(
    `[db] migration still blocked after ${MIGRATION_ATTEMPTS} attempts (write lock held by another connection)`,
    { cause: lastBusy }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PRAGMA 不接受绑定参数，标识符必须先过白名单，避免拼接面被打开 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function tableExists(db: DBAdapter, table: string): Promise<boolean> {
  const row = (await db.get(
    `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table]
  )) as { ok?: number } | undefined;
  return row?.ok === 1;
}

/**
 * 附加式补列：表不存在就什么也不做（新库由下面的 CREATE TABLE 直接带出该列），
 * 列已存在就什么也不做，其余情况真正执行 ALTER。
 * 出错一律上抛——旧写法把「duplicate column」之外的故障（表缺了、锁超时、语法错）
 * 一起当成「列已存在」吞掉，迁移失败也能盖章成功。
 */
async function addColumnIfMissing(
  db: DBAdapter,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
    throw new Error(`[db] unsafe identifier in migration: ${table}.${column}`);
  }
  if (!(await tableExists(db, table))) return;
  const columns = (await db.query(`PRAGMA table_info(${table})`)) as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * 旧库表重建：只有 sqlite_master 里确实读到旧定义（legacyMarker）时才重建。
 * 不 catch——重建失败必须让整个迁移失败，否则「升级没做成」会被当成成功盖章。
 */
async function rebuildTableIfLegacy(
  db: DBAdapter,
  table: string,
  legacyMarker: string,
  rebuildSql: string
): Promise<void> {
  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(`[db] unsafe identifier in migration: ${table}`);
  }
  const row = (await db.get(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table]
  )) as { sql: string | null } | undefined;
  if (!row?.sql || !row.sql.includes(legacyMarker)) return;
  await db.exec(rebuildSql);
}

async function migrate(db: DBAdapter): Promise<void> {
  // 先补 user_id 列：旧库的表已存在但缺 user_id，需在 CREATE INDEX 引用前补上
  // 新库此时表不存在，addColumnIfMissing 直接跳过，随后 CREATE TABLE 建带 user_id 的表
  const userIdTables = [
    'tracked_keywords', 'rank_history', 'content_checks', 'audits',
    'audit_issues', 'alerts', 'projects', 'automation_settings',
    'automation_logs', 'keyword_groups', 'keyword_group_members',
    'competitors', 'competitor_ranks', 'reports',
    'backlink_summaries', 'backlinks',
  ];
  for (const table of userIdTables) {
    await addColumnIfMissing(db, table, "user_id", "TEXT NOT NULL DEFAULT 'demo-user'");
  }

  // P0-02-D：rank_history 补 feature_types 列（旧库已存在表，需 ALTER；新库由 CREATE TABLE 建出）
  await addColumnIfMissing(db, "rank_history", "feature_types", "TEXT");

  // 2026-10-09 合规整改：email_preferences 补**显式营销同意**时间列。
  // 旧库只有退订列（opt-out），需 ALTER；新库由下方 CREATE TABLE 建出。NULL = 未同意。
  await addColumnIfMissing(db, "email_preferences", "marketing_opt_in_at", "TEXT");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      location TEXT NOT NULL,
      device TEXT NOT NULL,
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_refreshed_at TEXT,
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_unique
      ON tracked_keywords(keyword, location, device, domain);

    CREATE INDEX IF NOT EXISTS idx_tracked_keywords_user
      ON tracked_keywords(user_id);

    CREATE TABLE IF NOT EXISTS rank_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      position INTEGER,
      url TEXT,
      feature_types TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE,
      UNIQUE (keyword_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_rank_history_keyword
      ON rank_history(keyword_id, date);

    CREATE INDEX IF NOT EXISTS idx_rank_history_user
      ON rank_history(user_id);

    CREATE TABLE IF NOT EXISTS gsc_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      property_url TEXT NOT NULL,
      property_type TEXT NOT NULL,
      google_email TEXT,
      encrypted_credentials TEXT NOT NULL,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_gsc_connections_user
      ON gsc_connections(user_id);

    CREATE TABLE IF NOT EXISTS ai_search_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      run_type TEXT NOT NULL,
      target TEXT NOT NULL,
      target_type TEXT NOT NULL,
      platforms_json TEXT NOT NULL DEFAULT '[]',
      models_json TEXT NOT NULL DEFAULT '[]',
      requested_location_code INTEGER,
      requested_language TEXT,
      effective_location_code INTEGER,
      effective_language TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      provider_cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_search_runs_user
      ON ai_search_runs(user_id);

    CREATE INDEX IF NOT EXISTS idx_ai_search_runs_project
      ON ai_search_runs(project_id, created_at);

    CREATE TABLE IF NOT EXISTS seo_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_value TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      priority TEXT NOT NULL,
      impact TEXT,
      confidence TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      signals_json TEXT NOT NULL DEFAULT '{}',
      action_plan_json TEXT,
      verification_json TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, fingerprint),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_seo_opportunities_user
      ON seo_opportunities(user_id);

    CREATE INDEX IF NOT EXISTS idx_seo_opportunities_project
      ON seo_opportunities(project_id, priority, status);

    CREATE TABLE IF NOT EXISTS seo_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      opportunity_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'planned',
      plan_json TEXT NOT NULL DEFAULT '{}',
      preview_json TEXT,
      result_json TEXT,
      events_json TEXT NOT NULL DEFAULT '[]',
      approved_at TEXT,
      approved_by TEXT,
      executed_at TEXT,
      completed_at TEXT,
      error_code TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (opportunity_id),
      FOREIGN KEY (opportunity_id) REFERENCES seo_opportunities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_seo_actions_user
      ON seo_actions(user_id);

    CREATE INDEX IF NOT EXISTS idx_seo_actions_project
      ON seo_actions(project_id, status);

    CREATE TABLE IF NOT EXISTS github_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repository TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      auth_mode TEXT NOT NULL,
      encrypted_credentials TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_github_connections_user
      ON github_connections(user_id);

    CREATE TABLE IF NOT EXISTS content_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      keyword TEXT NOT NULL,
      score INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      density REAL NOT NULL,
      checks_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_content_checks_created
      ON content_checks(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_checks_user
      ON content_checks(user_id);

    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      pages_crawled INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      errors INTEGER NOT NULL DEFAULT 0,
      warnings INTEGER NOT NULL DEFAULT 0,
      notices INTEGER NOT NULL DEFAULT 0,
      comparison TEXT,
      error TEXT,
      depth TEXT NOT NULL DEFAULT 'quick',
      engine_version TEXT,
      rule_set_version TEXT,
      dashboard_json TEXT,
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_audits_domain
      ON audits(domain, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audits_user
      ON audits(user_id);

    CREATE TABLE IF NOT EXISTS audit_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      url TEXT NOT NULL,
      detail TEXT NOT NULL,
      suggestion TEXT,
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_audit_issues_audit
      ON audit_issues(audit_id);

    CREATE INDEX IF NOT EXISTS idx_audit_issues_user
      ON audit_issues(user_id);

    -- ===== 审计问题处理状态（检测结果 ≠ 处理状态） =====
    -- 关键设计：主键是 (user_id, domain, rule_id)，**不是 audit_id** ——
    -- 重新审计会产生新的 audit 行，处理状态必须跨审计延续，否则「再次检测验证」
    -- 无从比对。status 与检测结果完全分离：
    --   open            系统检出，用户尚未处理
    --   in_progress     用户标记为处理中
    --   fixed_claimed   用户声称已修复（**不等于**已验证解决）
    --   verified_resolved 由「再次审计」的检测证据确认该规则不再失败
    --   dismissed       用户判定不适用/不处理
    -- verify_* 只由服务端在校验时写入，绝不接受客户端直接置位。
    CREATE TABLE IF NOT EXISTS audit_issue_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT,
      claimed_at TEXT,
      verified_at TEXT,
      verified_audit_id INTEGER,
      verify_status TEXT,
      verify_detail TEXT,
      verify_attempts INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, domain, rule_id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_issue_resolutions_user
      ON audit_issue_resolutions(user_id);

    CREATE INDEX IF NOT EXISTS idx_audit_issue_resolutions_domain
      ON audit_issue_resolutions(domain);

    -- ===== 任务执行前后的观测记录（结果反馈闭环） =====
    -- 用于回答"我做完之后到底有没有改善"，并明确区分：
    --   baseline  = 用户开始处理那一刻的真实指标快照（不可事后编造）
    --   latest    = 后续可获得的真实观测（再审计 / 排名刷新）
    --   verdict   = improved / unchanged / worse / indeterminate（无法判断，不硬判）
    -- 关键纪律：**"用户点了完成"不写入这里** —— 本表只记录真实数据观测。
    CREATE TABLE IF NOT EXISTS task_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_source TEXT NOT NULL,
      kind TEXT NOT NULL,
      baseline_json TEXT,
      baseline_at TEXT,
      latest_json TEXT,
      latest_at TEXT,
      observations INTEGER NOT NULL DEFAULT 0,
      verdict TEXT,
      window_days INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, domain, task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_observations_user
      ON task_observations(user_id);

    CREATE INDEX IF NOT EXISTS idx_task_observations_domain
      ON task_observations(domain);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      domain TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read INTEGER NOT NULL DEFAULT 0,
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_created
      ON alerts(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_alerts_read
      ON alerts(read);

    CREATE INDEX IF NOT EXISTS idx_alerts_user
      ON alerts(user_id);

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      UNIQUE (user_id, domain)
    );

    CREATE INDEX IF NOT EXISTS idx_projects_domain
      ON projects(domain);

    CREATE INDEX IF NOT EXISTS idx_projects_user
      ON projects(user_id);

    CREATE TABLE IF NOT EXISTS automation_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daily_refresh_enabled INTEGER NOT NULL DEFAULT 0,
      daily_refresh_time TEXT NOT NULL DEFAULT '09:00',
      weekly_report_enabled INTEGER NOT NULL DEFAULT 0,
      weekly_report_day INTEGER NOT NULL DEFAULT 1,
      weekly_report_time TEXT NOT NULL DEFAULT '09:00',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL UNIQUE DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_automation_settings_user
      ON automation_settings(user_id);

    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('daily_refresh', 'weekly_report')),
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
      summary TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_automation_logs_created
      ON automation_logs(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_automation_logs_user
      ON automation_logs(user_id);

    CREATE TABLE IF NOT EXISTS keyword_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_keyword_groups_user
      ON keyword_groups(user_id);

    CREATE TABLE IF NOT EXISTS keyword_group_members (
      group_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      PRIMARY KEY (group_id, keyword_id),
      FOREIGN KEY (group_id) REFERENCES keyword_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_keyword_group_members_keyword
      ON keyword_group_members(keyword_id);
    CREATE INDEX IF NOT EXISTS idx_keyword_group_members_group
      ON keyword_group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_keyword_group_members_user
      ON keyword_group_members(user_id);

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      UNIQUE(project_id, domain)
    );

    CREATE INDEX IF NOT EXISTS idx_competitors_project
      ON competitors(project_id);

    CREATE INDEX IF NOT EXISTS idx_competitors_user
      ON competitors(user_id);

    CREATE TABLE IF NOT EXISTS competitor_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      rank INTEGER,
      target_url TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
      FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_competitor_ranks_keyword
      ON competitor_ranks(keyword_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_competitor_ranks_competitor
      ON competitor_ranks(competitor_id, keyword_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_competitor_ranks_user
      ON competitor_ranks(user_id);

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      type TEXT NOT NULL CHECK (type IN ('ranking', 'audit', 'content', 'weekly')),
      title TEXT NOT NULL,
      data_json TEXT NOT NULL,
      pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_reports_created
      ON reports(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_project
      ON reports(project_id);
    CREATE INDEX IF NOT EXISTS idx_reports_user
      ON reports(user_id);

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_api_cache_expires
      ON api_cache(expires_at);

    CREATE TABLE IF NOT EXISTS api_usage (
      month TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 100
    );

    -- 用户级 API 用量表（P0 商业化改造）
    -- 主键：(user_id, api_type, month)，支持 serpapi / dataforseo / content_check
    -- 旧 api_usage 表保留不删除，仅做兼容
    CREATE TABLE IF NOT EXISTS api_usage_per_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_type TEXT NOT NULL CHECK (api_type IN ('serpapi', 'dataforseo', 'content_check')),
      month TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, api_type, month)
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_per_user_user
      ON api_usage_per_user(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_usage_per_user_month
      ON api_usage_per_user(month);

    -- 审计每日用量表（P2 商业化改造）
    -- 按 (user_id, date) 隔离，每日归零
    CREATE TABLE IF NOT EXISTS audit_usage_per_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_usage_per_user_user
      ON audit_usage_per_user(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_usage_per_user_date
      ON audit_usage_per_user(date);

    -- API 每日用量表（Free 额度调整：SerpApi 每日限额）
    -- 按 (user_id, api_type, date) 隔离，每日归零；与月度 api_usage_per_user 互补
    CREATE TABLE IF NOT EXISTS api_usage_daily_per_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_type TEXT NOT NULL CHECK (api_type IN ('serpapi', 'dataforseo', 'content_check')),
      date TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      "limit" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, api_type, date)
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_daily_per_user_user
      ON api_usage_daily_per_user(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_usage_daily_per_user_date
      ON api_usage_daily_per_user(date);

    CREATE TABLE IF NOT EXISTS backlink_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      total_backlinks INTEGER,
      referring_domains INTEGER,
      domain_rank INTEGER,
      dofollow_pct REAL,
      raw_json TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      UNIQUE (user_id, domain)
    );

    CREATE INDEX IF NOT EXISTS idx_backlink_summaries_user
      ON backlink_summaries(user_id);

    CREATE TABLE IF NOT EXISTS backlinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      source_url TEXT,
      anchor TEXT,
      target_url TEXT,
      dofollow INTEGER,
      source_rank INTEGER,
      first_seen TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user'
    );

    CREATE INDEX IF NOT EXISTS idx_backlinks_domain
      ON backlinks(domain);

    CREATE INDEX IF NOT EXISTS idx_backlinks_user
      ON backlinks(user_id);

    CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '["mcp:read"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_lookup
      ON mcp_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user
      ON mcp_api_keys(user_id);

    -- ===== Marketing Analytics（B 阶段）=====
    -- 事件表：只存归因/漏斗必要字段；props 为白名单化后的 JSON（不存 token/密码/cookie）
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      user_id TEXT,
      anonymous_id TEXT,
      session_id TEXT,
      path TEXT,
      locale TEXT,
      referrer TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      landing_page TEXT,
      ref_id TEXT,
      props TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_time
      ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time
      ON analytics_events(event_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_user
      ON analytics_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_anon
      ON analytics_events(anonymous_id);

    -- 匿名身份与 UTM 归因：first_touch 只写一次不覆盖，last_touch 随新渠道访问更新
    CREATE TABLE IF NOT EXISTS analytics_identities (
      anonymous_id TEXT PRIMARY KEY,
      user_id TEXT,
      first_touch_source TEXT,
      first_touch_medium TEXT,
      first_touch_campaign TEXT,
      first_touch_content TEXT,
      first_touch_term TEXT,
      first_landing_page TEXT,
      first_referrer TEXT,
      last_touch_source TEXT,
      last_touch_medium TEXT,
      last_touch_campaign TEXT,
      last_landing_page TEXT,
      last_referrer TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      bound_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_identities_user
      ON analytics_identities(user_id);

    -- ===== Email 营销基础设施（C 阶段）=====
    -- 邮件日志 + 幂等：UNIQUE(user_id, automation_key) 保证同一邮件对同一用户只发一次
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      template TEXT NOT NULL,
      automation_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      UNIQUE (user_id, automation_key)
    );

    CREATE INDEX IF NOT EXISTS idx_email_log_user
      ON email_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_log_time
      ON email_log(created_at);

    -- 用户邮件偏好：营销**同意（opt-in）**与**退订（opt-out）**
    -- marketing_opt_in_at = 可核验的显式同意时间（NULL = 未同意；注册/登录/付费都不写这里）
    -- marketing_unsubscribed_at = 退订时间（NULL = 未退订）
    CREATE TABLE IF NOT EXISTS email_preferences (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      unsubscribe_token TEXT UNIQUE,
      marketing_opt_in_at TEXT,
      marketing_unsubscribed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Owner Console（/admin）本地经营快照层 =====
    -- 设计原则：Creem / Google / AdSense 是 external source of truth，
    -- 本层只保存**本地经营快照**，Admin 页面永不直连外部 API。
    -- 所有 external ID 均有唯一约束，保证 webhook 重投不重复计收入。

    -- Creem webhook 幂等账本：event_id 唯一，重复投递直接跳过
    CREATE TABLE IF NOT EXISTS creem_webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      object_id TEXT,
      status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
      detail TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_creem_webhook_events_type
      ON creem_webhook_events(event_type, received_at DESC);

    -- Creem 客户（email ↔ SeeO user 的桥梁，用于排查支付问题）
    CREATE TABLE IF NOT EXISTS creem_customers (
      creem_customer_id TEXT PRIMARY KEY,
      email TEXT,
      user_id TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_creem_customers_email ON creem_customers(email);
    CREATE INDEX IF NOT EXISTS idx_creem_customers_user ON creem_customers(user_id);

    -- Creem 订阅（状态快照；MRR / 活跃订阅数以此为源）
    CREATE TABLE IF NOT EXISTS creem_subscriptions (
      creem_subscription_id TEXT PRIMARY KEY,
      user_id TEXT,
      creem_customer_id TEXT,
      product_id TEXT,
      plan TEXT,
      status TEXT NOT NULL,
      current_period_start TEXT,
      current_period_end TEXT,
      last_transaction_id TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_creem_subscriptions_user ON creem_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_creem_subscriptions_status ON creem_subscriptions(status);

    -- Creem 交易/订单快照（与 Supabase orders 对账用，非权益来源）
    -- 方向由 type 表达：payment 行为收款、refund 行为退款（均存正数）。
    -- 收入口径：gross = Σ payment amount；refunds = Σ refund amount；net = gross - refunds。
    -- 主键为 Creem 侧 external id（payment=order id，refund=refund id）→ 同一事件重投天然幂等。
    CREATE TABLE IF NOT EXISTS creem_transactions (
      creem_transaction_id TEXT PRIMARY KEY,
      user_id TEXT,
      creem_customer_id TEXT,
      creem_subscription_id TEXT,
      out_trade_no TEXT,
      parent_transaction_id TEXT,
      plan TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      type TEXT NOT NULL DEFAULT 'payment'
        CHECK (type IN ('payment', 'refund')),
      status TEXT NOT NULL,
      paid_at TEXT,
      occurred_at TEXT,
      event_id TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_creem_transactions_order ON creem_transactions(out_trade_no);
    CREATE INDEX IF NOT EXISTS idx_creem_transactions_user ON creem_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_creem_transactions_status ON creem_transactions(status, paid_at);

    -- GSC 站点级日指标（按日持久化，避免每次打开 Admin 打 Google API）
    CREATE TABLE IF NOT EXISTS gsc_daily_metrics (
      property_url TEXT NOT NULL,
      date TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (property_url, date)
    );

    -- GSC 关键词窗口快照（一次同步一行/关键词；captured_on 为抓取日）
    CREATE TABLE IF NOT EXISTS gsc_query_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_url TEXT NOT NULL,
      captured_on TEXT NOT NULL,
      window_days INTEGER NOT NULL,
      query TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (property_url, captured_on, window_days, country, device, query)
    );

    CREATE INDEX IF NOT EXISTS idx_gsc_query_metrics_lookup
      ON gsc_query_metrics(property_url, window_days, captured_on DESC);

    -- GSC 页面窗口快照
    CREATE TABLE IF NOT EXISTS gsc_page_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_url TEXT NOT NULL,
      captured_on TEXT NOT NULL,
      window_days INTEGER NOT NULL,
      page TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (property_url, captured_on, window_days, page)
    );

    CREATE INDEX IF NOT EXISTS idx_gsc_page_metrics_lookup
      ON gsc_page_metrics(property_url, window_days, captured_on DESC);

    -- 广告收入日表（provider 独立来源，与订阅收入分开统计，最后统一汇总）
    CREATE TABLE IF NOT EXISTS ad_revenue_daily (
      date TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'adsense',
      currency TEXT NOT NULL DEFAULT 'USD',
      revenue_cents INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('api', 'csv', 'manual')),
      raw_json TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, provider)
    );

    -- Owner 级 GSC 连接（站点级，与用户 project 级 gsc_connections 分离；
    -- 复用同一套 gsc-provider + AES-256-GCM secure-store，不新增第二套 OAuth 实现）
    CREATE TABLE IF NOT EXISTS admin_gsc_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_url TEXT NOT NULL UNIQUE,
      property_type TEXT NOT NULL DEFAULT 'url_prefix',
      google_email TEXT,
      encrypted_credentials TEXT NOT NULL,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Owner Console：数据源同步/导入事件（最近成功与最近失败分开可查；五态展示依据）
    CREATE TABLE IF NOT EXISTS admin_source_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('success', 'error')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_admin_source_events_source
      ON admin_source_events(source, created_at DESC);

    -- 老板付款通知（支付成功 → 邮件通知 owner；持久化 + 防重复 + 重试）
    -- dedupe_key 全局唯一：同一笔成功支付（首付 = 订单号；续费 = 订阅+交易/周期）只发一封
    CREATE TABLE IF NOT EXISTS payment_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('first_payment', 'renewal')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      payload_json TEXT NOT NULL,
      provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payment_notifications_status
      ON payment_notifications(status, created_at DESC);
  `);

  // Owner Console：analytics_events 补 content / term 列（归因完整性，附加式、旧数据不动）
  await addColumnIfMissing(db, "analytics_events", "content", "TEXT");
  await addColumnIfMissing(db, "analytics_events", "term", "TEXT");

  // projects 表升级：旧表 domain 是全局 UNIQUE，多用户下同域名冲突，重建为 (user_id, domain) 联合唯一
  await rebuildTableIfLegacy(
    db,
    "projects",
    "domain TEXT NOT NULL UNIQUE",
    `
      CREATE TABLE IF NOT EXISTS projects_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        user_id TEXT NOT NULL DEFAULT 'demo-user',
        UNIQUE (user_id, domain)
      );
      INSERT OR IGNORE INTO projects_new (id, name, domain, created_at, user_id)
      SELECT id, name, domain, created_at, user_id FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;
      CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects(domain);
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    `
  );

  // backlink_summaries 表升级：同 projects，domain 全局 UNIQUE 改为 (user_id, domain) 联合唯一
  await rebuildTableIfLegacy(
    db,
    "backlink_summaries",
    "domain TEXT NOT NULL UNIQUE",
    `
      CREATE TABLE IF NOT EXISTS backlink_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        total_backlinks INTEGER,
        referring_domains INTEGER,
        domain_rank INTEGER,
        dofollow_pct REAL,
        raw_json TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        user_id TEXT NOT NULL DEFAULT 'demo-user',
        UNIQUE (user_id, domain)
      );
      INSERT OR IGNORE INTO backlink_summaries_new (id, domain, total_backlinks, referring_domains, domain_rank, dofollow_pct, raw_json, fetched_at, user_id)
      SELECT id, domain, total_backlinks, referring_domains, domain_rank, dofollow_pct, raw_json, fetched_at, user_id FROM backlink_summaries;
      DROP TABLE backlink_summaries;
      ALTER TABLE backlink_summaries_new RENAME TO backlink_summaries;
      CREATE INDEX IF NOT EXISTS idx_backlink_summaries_user ON backlink_summaries(user_id);
    `
  );

  // automation_settings 表升级：旧表有 CHECK (id = 1) 单行约束，需重建为多行（按 user_id）
  await rebuildTableIfLegacy(
    db,
    "automation_settings",
    "CHECK (id = 1)",
    `
      CREATE TABLE IF NOT EXISTS automation_settings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_refresh_enabled INTEGER NOT NULL DEFAULT 0,
        daily_refresh_time TEXT NOT NULL DEFAULT '09:00',
        weekly_report_enabled INTEGER NOT NULL DEFAULT 0,
        weekly_report_day INTEGER NOT NULL DEFAULT 1,
        weekly_report_time TEXT NOT NULL DEFAULT '09:00',
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        user_id TEXT NOT NULL UNIQUE DEFAULT 'demo-user'
      );
      INSERT OR IGNORE INTO automation_settings_new (id, daily_refresh_enabled, daily_refresh_time, weekly_report_enabled, weekly_report_day, weekly_report_time, updated_at, user_id)
      SELECT id, daily_refresh_enabled, daily_refresh_time, weekly_report_enabled, weekly_report_day, weekly_report_time, updated_at, user_id FROM automation_settings;
      DROP TABLE automation_settings;
      ALTER TABLE automation_settings_new RENAME TO automation_settings;
      CREATE INDEX IF NOT EXISTS idx_automation_settings_user ON automation_settings(user_id);
    `
  );

  // api_usage_per_user 表升级：旧表 CHECK 约束仅含 serpapi/dataforseo，需重建以支持 content_check
  await rebuildTableIfLegacy(
    db,
    "api_usage_per_user",
    "CHECK (api_type IN ('serpapi', 'dataforseo'))",
    `
      CREATE TABLE IF NOT EXISTS api_usage_per_user_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        api_type TEXT NOT NULL CHECK (api_type IN ('serpapi', 'dataforseo', 'content_check')),
        month TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        "limit" INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, api_type, month)
      );
      INSERT OR IGNORE INTO api_usage_per_user_new (id, user_id, api_type, month, used, "limit", created_at, updated_at)
      SELECT id, user_id, api_type, month, used, "limit", created_at, updated_at FROM api_usage_per_user;
      DROP TABLE api_usage_per_user;
      ALTER TABLE api_usage_per_user_new RENAME TO api_usage_per_user;
      CREATE INDEX IF NOT EXISTS idx_api_usage_per_user_user ON api_usage_per_user(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_usage_per_user_month ON api_usage_per_user(month);
    `
  );

  // 审计表新增字段（ALTER TABLE 兼容已有数据）
  await addColumnIfMissing(db, "audits", "comparison", "TEXT");
  await addColumnIfMissing(db, "audits", "error", "TEXT");
  await addColumnIfMissing(db, "audits", "depth", "TEXT NOT NULL DEFAULT 'quick'");
  // pages_detail：JSON [{url, responseTimeMs, status}]，用于响应时间分布图
  await addColumnIfMissing(db, "audits", "pages_detail", "TEXT");
  // Audit Engine V2：记录引擎与规则集版本，规则演进后历史结果仍可解释
  await addColumnIfMissing(db, "audits", "engine_version", "TEXT");
  await addColumnIfMissing(db, "audits", "rule_set_version", "TEXT");
  // Audit Dashboard V2：完整快照（页面/规则/分数/分类/报告），Dashboard 单一数据源
  await addColumnIfMissing(db, "audits", "dashboard_json", "TEXT");

  // content_checks 表新增字段（ALTER TABLE 兼容已有数据）
  const contentCheckColumns: Array<[string, string]> = [
    ["title_suggestions", "TEXT"],
    ["keyword_density", "TEXT"],
    ["readability_score", "INTEGER"],
    ["readability_level", "TEXT"],
    ["word_count_full", "INTEGER"],
    ["heading_structure", "TEXT"],
    ["internal_links_count", "INTEGER DEFAULT 0"],
    ["external_links_count", "INTEGER DEFAULT 0"],
    ["images_count", "INTEGER DEFAULT 0"],
    ["images_without_alt", "INTEGER DEFAULT 0"],
    ["meta_title_length", "INTEGER"],
    ["meta_description_length", "INTEGER"],
    ["first_100_words", "TEXT"],
    ["top_keywords", "TEXT"],
    ["content_score", "INTEGER"],
    ["comparison", "TEXT"],
  ];
  for (const [col, type] of contentCheckColumns) {
    await addColumnIfMissing(db, "content_checks", col, type);
  }

  // 插入默认自动化配置（单条记录，id=1）
  await db.run(`INSERT OR IGNORE INTO automation_settings (id) VALUES (1)`);

  // 首次迁移：把 tracked_keywords 现有域名自动归入同名项目
  await migrateProjectsFromTrackedKeywords(db);
}

async function migrateProjectsFromTrackedKeywords(db: DBAdapter): Promise<void> {
  const domains = await db.query(`
    SELECT DISTINCT domain FROM tracked_keywords
    WHERE domain NOT IN (SELECT domain FROM projects)
  `) as { domain: string }[];
  if (domains.length === 0) return;
  for (const { domain } of domains) {
    await db.run(`INSERT INTO projects (name, domain, user_id) VALUES (?, ?, 'demo-user')`, [domain, domain]);
  }
}

export function closeDb(): void {
  const pending = dbPromise;
  dbPromise = null;
  lastSchemaInit = null;
  if (!pending) return;
  // 连接可能仍在初始化中：等它落地再关，避免留下半开连接
  void pending.then((db) => db.close()).catch(() => {});
}

// 注意：不在模块顶层调用 ensureDir()
// local SQLite 分支内部会在首次调用 getAdapter() 时按需创建 data 目录
// Turso 环境不需要本地目录，顶层副作用会导致 Vercel Serverless 只读文件系统 ENOENT

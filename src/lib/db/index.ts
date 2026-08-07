// ===== SQLite 持久化层（服务端专用） =====
// 数据库文件：data/seeo.db（已加入 .gitignore）
// 以后迁移 Supabase 时只需替换本文件实现，页面/API 路由不动

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { SQLiteAdapter, type DBAdapter } from "./adapter";

const DB_PATH = path.join(process.cwd(), "data", "seeo.db");

let dbInstance: DBAdapter | null = null;

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
}

async function getAdapter(): Promise<DBAdapter> {
  if (!dbInstance) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;
    if (tursoUrl && tursoToken) {
      const { TursoAdapter } = await import("./turso-adapter");
      dbInstance = new TursoAdapter(tursoUrl, tursoToken);
      await migrate(dbInstance);
    } else {
      // local SQLite（动态 import 避免 Vercel 构建时加载原生模块）
      const dir = path.dirname(DB_PATH);
      if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
      const { default: Database } = await import("better-sqlite3");
      const raw = new Database(DB_PATH);
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      dbInstance = new SQLiteAdapter(raw);
      await migrate(dbInstance);
    }
  }
  return dbInstance;
}

async function migrate(db: DBAdapter): Promise<void> {
  // 先补 user_id 列：旧库的表已存在但缺 user_id，需在 CREATE INDEX 引用前补上
  // 新库此时表不存在，ALTER TABLE 报错被 catch 忽略，随后 CREATE TABLE 会建带 user_id 的表
  const userIdTables = [
    'tracked_keywords', 'rank_history', 'content_checks', 'audits',
    'audit_issues', 'alerts', 'projects', 'automation_settings',
    'automation_logs', 'keyword_groups', 'keyword_group_members',
    'competitors', 'competitor_ranks', 'reports',
    'backlink_summaries', 'backlinks',
  ];
  for (const table of userIdTables) {
    try {
      await db.run(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'demo-user'`);
    } catch {
      // 表不存在或列已存在，忽略
    }
  }

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'demo-user',
      FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE,
      UNIQUE (keyword_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_rank_history_keyword
      ON rank_history(keyword_id, date);

    CREATE INDEX IF NOT EXISTS idx_rank_history_user
      ON rank_history(user_id);

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
  `);

  // projects 表升级：旧表 domain 是全局 UNIQUE，多用户下同域名冲突，重建为 (user_id, domain) 联合唯一
  try {
    const tableDef = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'`) as { sql: string } | undefined;
    if (tableDef?.sql && tableDef.sql.includes('domain TEXT NOT NULL UNIQUE')) {
      await db.exec(`
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
      `);
    }
  } catch {
    // 升级失败（可能已是新结构），忽略
  }

  // backlink_summaries 表升级：同 projects，domain 全局 UNIQUE 改为 (user_id, domain) 联合唯一
  try {
    const tableDef = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='backlink_summaries'`) as { sql: string } | undefined;
    if (tableDef?.sql && tableDef.sql.includes('domain TEXT NOT NULL UNIQUE')) {
      await db.exec(`
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
      `);
    }
  } catch {
    // 升级失败（可能已是新结构），忽略
  }

  // automation_settings 表升级：旧表有 CHECK (id = 1) 单行约束，需重建为多行（按 user_id）
  try {
    const tableDef = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='automation_settings'`) as { sql: string } | undefined;
    if (tableDef?.sql && tableDef.sql.includes('CHECK (id = 1)')) {
      await db.exec(`
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
      `);
    }
  } catch {
    // 升级失败（可能已是新结构），忽略
  }

  // 审计表新增 comparison 字段（ALTER TABLE 兼容已有数据）
  try {
    await db.run(`ALTER TABLE audits ADD COLUMN comparison TEXT`);
  } catch {
    // 字段已存在，忽略
  }

  // 审计表新增 error 字段（ALTER TABLE 兼容已有数据）
  try {
    await db.run(`ALTER TABLE audits ADD COLUMN error TEXT`);
  } catch {
    // 字段已存在，忽略
  }

  // 审计表新增 depth 字段（ALTER TABLE 兼容已有数据）
  try {
    await db.run(`ALTER TABLE audits ADD COLUMN depth TEXT NOT NULL DEFAULT 'quick'`);
  } catch {
    // 字段已存在，忽略
  }

  // 审计表新增 pages_detail 字段（JSON：[{url, responseTimeMs, status}]，用于响应时间分布图）
  try {
    await db.run(`ALTER TABLE audits ADD COLUMN pages_detail TEXT`);
  } catch {
    // 字段已存在，忽略
  }

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
    try {
      await db.run(`ALTER TABLE content_checks ADD COLUMN ${col} ${type}`);
    } catch {
      // 字段已存在，忽略
    }
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

// ---------- 类型 ----------

export interface TrackedKeyword {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
  created_at: string;
  last_refreshed_at: string | null;
}

export interface TrackedKeywordWithLatest extends TrackedKeyword {
  todayPosition: number | null;
  yesterdayPosition: number | null;
  change: number | null; // 正为上升（排名数字变小），负为下降
  matchedUrl: string | null;
}

export interface RankHistoryRow {
  id: number;
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
  created_at: string;
}

export interface KeywordGroup {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface KeywordGroupWithCount extends KeywordGroup {
  keywordCount: number;
}

export interface TrackedKeywordWithGroups extends TrackedKeywordWithLatest {
  groups: KeywordGroup[];
}

// ---------- Repository ----------

function rowToTracked(row: Record<string, unknown>): TrackedKeyword {
  return {
    id: Number(row.id),
    keyword: String(row.keyword),
    location: String(row.location),
    device: String(row.device) as "PC" | "移动端",
    domain: String(row.domain),
    created_at: String(row.created_at),
    last_refreshed_at: row.last_refreshed_at ? String(row.last_refreshed_at) : null,
  };
}

export async function listTrackedKeywords(userId: string): Promise<TrackedKeywordWithGroups[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT
      tk.*,
      today.position AS today_position,
      today.url AS today_url,
      yest.position AS yesterday_position
    FROM tracked_keywords tk
    LEFT JOIN rank_history today
      ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
    LEFT JOIN rank_history yest
      ON yest.keyword_id = tk.id AND yest.date = date('now', 'localtime', '-1 day')
    WHERE tk.user_id = ?
    ORDER BY tk.created_at ASC
  `, [userId]) as Record<string, unknown>[];

  // 一次性查所有分组关联，再按 keyword_id 聚合（避免 N+1）
  const allMembers = await db.query(`
    SELECT m.keyword_id, g.id AS group_id, g.name, g.description, g.created_at
    FROM keyword_group_members m
    JOIN keyword_groups g ON g.id = m.group_id
    WHERE m.user_id = ?
  `, [userId]) as Record<string, unknown>[];
  const groupsByKw = new Map<number, KeywordGroup[]>();
  for (const m of allMembers) {
    const kid = Number(m.keyword_id);
    const g: KeywordGroup = {
      id: Number(m.group_id),
      name: String(m.name),
      description: m.description ? String(m.description) : null,
      created_at: String(m.created_at),
    };
    if (!groupsByKw.has(kid)) groupsByKw.set(kid, []);
    groupsByKw.get(kid)!.push(g);
  }

  return rows.map((r) => {
    const today = r.today_position === null || r.today_position === undefined
      ? null
      : Number(r.today_position);
    const yest = r.yesterday_position === null || r.yesterday_position === undefined
      ? null
      : Number(r.yesterday_position);
    let change: number | null = null;
    if (today !== null && yest !== null) {
      // 排名数字变小 = 上升，change 显示为正
      change = yest - today;
    }
    const kid = Number(r.id);
    return {
      ...rowToTracked(r),
      todayPosition: today,
      yesterdayPosition: yest,
      change,
      matchedUrl: r.today_url ? String(r.today_url) : null,
      groups: groupsByKw.get(kid) ?? [],
    };
  });
}

export async function addTrackedKeyword(userId: string, params: {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
}): Promise<TrackedKeyword> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO tracked_keywords (keyword, location, device, domain, user_id)
    VALUES (@keyword, @location, @device, @domain, @user_id)
  `, [{ ...params, user_id: userId }]);
  const row = await db.get(`SELECT * FROM tracked_keywords WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToTracked(row);
}

export async function removeTrackedKeyword(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM tracked_keywords WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function getTrackedKeywordById(userId: string, id: number): Promise<TrackedKeyword | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM tracked_keywords WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToTracked(row) : null;
}

export async function countTrackedKeywords(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM tracked_keywords WHERE user_id = ?`, [userId]) as { c: number };
  return row.c;
}

// ---------- keyword_groups ----------

function rowToKeywordGroup(row: Record<string, unknown>): KeywordGroup {
  return {
    id: Number(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    created_at: String(row.created_at),
  };
}

export async function createKeywordGroup(userId: string, name: string, description?: string): Promise<KeywordGroup> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO keyword_groups (name, description, user_id)
    VALUES (@name, @description, @user_id)
  `, [{ name, description: description ?? null, user_id: userId }]);
  const row = await db.get(`SELECT * FROM keyword_groups WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToKeywordGroup(row);
}

export async function listKeywordGroups(userId: string): Promise<KeywordGroupWithCount[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT g.*, COUNT(m.keyword_id) AS keyword_count
    FROM keyword_groups g
    LEFT JOIN keyword_group_members m ON m.group_id = g.id
    WHERE g.user_id = ?
    GROUP BY g.id
    ORDER BY g.created_at ASC
  `, [userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToKeywordGroup(r),
    keywordCount: Number(r.keyword_count),
  }));
}

export async function deleteKeywordGroup(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM keyword_groups WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function addKeywordToGroup(userId: string, groupId: number, keywordId: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT OR IGNORE INTO keyword_group_members (group_id, keyword_id, user_id)
    VALUES (@group_id, @keyword_id, @user_id)
  `, [{ group_id: groupId, keyword_id: keywordId, user_id: userId }]);
}

export async function removeKeywordFromGroup(userId: string, groupId: number, keywordId: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`
    DELETE FROM keyword_group_members
    WHERE group_id = ? AND keyword_id = ? AND user_id = ?
  `, [groupId, keywordId, userId]);
  return info.changes > 0;
}

export async function listKeywordsInGroup(userId: string, groupId: number): Promise<TrackedKeyword[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT tk.* FROM tracked_keywords tk
    JOIN keyword_group_members m ON m.keyword_id = tk.id
    WHERE m.group_id = ? AND m.user_id = ?
    ORDER BY tk.created_at ASC
  `, [groupId, userId]) as Record<string, unknown>[];
  return rows.map(rowToTracked);
}

export async function getKeywordGroups(userId: string, keywordId: number): Promise<KeywordGroup[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT g.* FROM keyword_groups g
    JOIN keyword_group_members m ON m.group_id = g.id
    WHERE m.keyword_id = ? AND m.user_id = ?
    ORDER BY g.created_at ASC
  `, [keywordId, userId]) as Record<string, unknown>[];
  return rows.map(rowToKeywordGroup);
}

// ---------- competitors ----------

export interface Competitor {
  id: number;
  project_id: number;
  domain: string;
  name: string | null;
  created_at: string;
}

export interface CompetitorRank {
  id: number;
  competitor_id: number;
  keyword_id: number;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
}

export interface CompetitorRankLatest {
  competitor_id: number;
  domain: string;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
}

function rowToCompetitor(row: Record<string, unknown>): Competitor {
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    domain: String(row.domain),
    name: row.name ? String(row.name) : null,
    created_at: String(row.created_at),
  };
}

export async function createCompetitor(userId: string, params: {
  project_id: number;
  domain: string;
  name?: string | null;
}): Promise<Competitor> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO competitors (project_id, domain, name, user_id)
    VALUES (@project_id, @domain, @name, @user_id)
  `, [{
    project_id: params.project_id,
    domain: params.domain,
    name: params.name ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM competitors WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToCompetitor(row);
}

export async function listCompetitors(userId: string, projectId: number): Promise<Competitor[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM competitors WHERE project_id = ? AND user_id = ? ORDER BY created_at ASC
  `, [projectId, userId]) as Record<string, unknown>[];
  return rows.map(rowToCompetitor);
}

export async function deleteCompetitor(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`DELETE FROM competitors WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function getCompetitorById(userId: string, id: number): Promise<Competitor | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM competitors WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToCompetitor(row) : null;
}

export async function addCompetitorRank(userId: string, params: {
  competitor_id: number;
  keyword_id: number;
  rank: number | null;
  target_url: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO competitor_ranks (competitor_id, keyword_id, rank, target_url, user_id)
    VALUES (@competitor_id, @keyword_id, @rank, @target_url, @user_id)
  `, [{ ...params, user_id: userId }]);
}

/** 获取某关键词下所有竞品的最新一条排名 */
export async function getLatestCompetitorRanks(userId: string, keywordId: number): Promise<CompetitorRankLatest[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT cr.competitor_id, c.domain, cr.rank, cr.target_url, cr.checked_at
    FROM competitor_ranks cr
    JOIN competitors c ON c.id = cr.competitor_id
    WHERE cr.keyword_id = ? AND cr.user_id = ?
    AND cr.id = (
      SELECT cr2.id FROM competitor_ranks cr2
      WHERE cr2.competitor_id = cr.competitor_id AND cr2.keyword_id = cr.keyword_id
      ORDER BY cr2.checked_at DESC LIMIT 1
    )
    ORDER BY c.domain ASC
  `, [keywordId, userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    competitor_id: Number(r.competitor_id),
    domain: String(r.domain),
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    target_url: r.target_url ? String(r.target_url) : null,
    checked_at: String(r.checked_at),
  }));
}

/** 获取某竞品在某关键词下的历史排名（按时间倒序） */
export async function getCompetitorRanksHistory(
  userId: string,
  competitorId: number,
  keywordId: number,
  limit = 30
): Promise<Array<{ rank: number | null; checked_at: string }>> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT rank, checked_at FROM competitor_ranks
    WHERE competitor_id = ? AND keyword_id = ? AND user_id = ?
    ORDER BY checked_at DESC LIMIT ?
  `, [competitorId, keywordId, userId, limit]) as Record<string, unknown>[];
  return rows.map((r) => ({
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    checked_at: String(r.checked_at),
  }));
}

/** 获取某关键词下所有竞品的所有排名记录（用于 SOV 趋势） */
export async function getCompetitorRanksByKeyword(
  userId: string,
  keywordId: number,
  days = 30
): Promise<Array<{
  competitor_id: number;
  domain: string;
  rank: number | null;
  checked_at: string;
}>> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT cr.competitor_id, c.domain, cr.rank, cr.checked_at
    FROM competitor_ranks cr
    JOIN competitors c ON c.id = cr.competitor_id
    WHERE cr.keyword_id = ? AND cr.user_id = ?
    AND date(cr.checked_at) >= date('now', 'localtime', ?)
    ORDER BY cr.checked_at ASC
  `, [keywordId, userId, `-${days} day`]) as Record<string, unknown>[];
  return rows.map((r) => ({
    competitor_id: Number(r.competitor_id),
    domain: String(r.domain),
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
    checked_at: String(r.checked_at),
  }));
}

/** 同一天只记一条：position 为 null 表示查询了但未进前 100 */
export async function upsertRankHistory(userId: string, params: {
  keyword_id: number;
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO rank_history (keyword_id, date, position, url, user_id)
    VALUES (@keyword_id, @date, @position, @url, @user_id)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      position = excluded.position,
      url = excluded.url
  `, [{ ...params, user_id: userId }]);
}

export async function getRankHistory(userId: string, keywordId: number, days = 30): Promise<RankHistoryRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM rank_history
    WHERE keyword_id = ? AND user_id = ?
    AND date >= date('now', 'localtime', ?)
    ORDER BY date ASC
  `, [keywordId, userId, `-${days} day`]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    keyword_id: Number(r.keyword_id),
    date: String(r.date),
    position: r.position === null ? null : Number(r.position),
    url: r.url ? String(r.url) : null,
    created_at: String(r.created_at),
  }));
}

export async function updateLastRefreshed(userId: string, keywordId: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE tracked_keywords SET last_refreshed_at = datetime('now') WHERE id = ? AND user_id = ?`, [keywordId, userId]);
}

/** 判断今日是否已刷新过（用于避免重复扣额度） */
export async function hasTodayHistory(userId: string, keywordId: number): Promise<boolean> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT 1 FROM rank_history
    WHERE keyword_id = ? AND date = date('now', 'localtime') AND user_id = ?
    LIMIT 1
  `, [keywordId, userId]) as { 1: number } | undefined;
  return !!row;
}

// ---------- content_checks ----------

export interface ContentCheckRow {
  id: number;
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  checks_json: string;
  created_at: string;
}

export interface ContentCheckFull extends ContentCheckRow {
  title_suggestions: string | null;
  keyword_density: string | null;
  readability_score: number | null;
  readability_level: string | null;
  word_count_full: number | null;
  heading_structure: string | null;
  internal_links_count: number;
  external_links_count: number;
  images_count: number;
  images_without_alt: number;
  meta_title_length: number | null;
  meta_description_length: number | null;
  first_100_words: string | null;
  top_keywords: string | null;
  content_score: number | null;
  comparison: string | null;
}

function rowToContentCheckFull(row: Record<string, unknown>): ContentCheckFull {
  return {
    id: Number(row.id),
    url: String(row.url),
    keyword: String(row.keyword),
    score: Number(row.score),
    word_count: Number(row.word_count),
    density: Number(row.density),
    checks_json: String(row.checks_json),
    created_at: String(row.created_at),
    title_suggestions: row.title_suggestions ? String(row.title_suggestions) : null,
    keyword_density: row.keyword_density ? String(row.keyword_density) : null,
    readability_score: row.readability_score !== null && row.readability_score !== undefined ? Number(row.readability_score) : null,
    readability_level: row.readability_level ? String(row.readability_level) : null,
    word_count_full: row.word_count_full !== null && row.word_count_full !== undefined ? Number(row.word_count_full) : null,
    heading_structure: row.heading_structure ? String(row.heading_structure) : null,
    internal_links_count: row.internal_links_count !== null && row.internal_links_count !== undefined ? Number(row.internal_links_count) : 0,
    external_links_count: row.external_links_count !== null && row.external_links_count !== undefined ? Number(row.external_links_count) : 0,
    images_count: row.images_count !== null && row.images_count !== undefined ? Number(row.images_count) : 0,
    images_without_alt: row.images_without_alt !== null && row.images_without_alt !== undefined ? Number(row.images_without_alt) : 0,
    meta_title_length: row.meta_title_length !== null && row.meta_title_length !== undefined ? Number(row.meta_title_length) : null,
    meta_description_length: row.meta_description_length !== null && row.meta_description_length !== undefined ? Number(row.meta_description_length) : null,
    first_100_words: row.first_100_words ? String(row.first_100_words) : null,
    top_keywords: row.top_keywords ? String(row.top_keywords) : null,
    content_score: row.content_score !== null && row.content_score !== undefined ? Number(row.content_score) : null,
    comparison: row.comparison ? String(row.comparison) : null,
  };
}

export async function addContentCheck(userId: string, params: {
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  checks_json: string;
  title_suggestions?: string | null;
  keyword_density?: string | null;
  readability_score?: number | null;
  readability_level?: string | null;
  word_count_full?: number | null;
  heading_structure?: string | null;
  internal_links_count?: number;
  external_links_count?: number;
  images_count?: number;
  images_without_alt?: number;
  meta_title_length?: number | null;
  meta_description_length?: number | null;
  first_100_words?: string | null;
  top_keywords?: string | null;
  content_score?: number | null;
  comparison?: string | null;
}): Promise<ContentCheckFull> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO content_checks (
      url, keyword, score, word_count, density, checks_json,
      title_suggestions, keyword_density, readability_score, readability_level,
      word_count_full, heading_structure, internal_links_count, external_links_count,
      images_count, images_without_alt, meta_title_length, meta_description_length,
      first_100_words, top_keywords, content_score, comparison, user_id
    ) VALUES (
      @url, @keyword, @score, @word_count, @density, @checks_json,
      @title_suggestions, @keyword_density, @readability_score, @readability_level,
      @word_count_full, @heading_structure, @internal_links_count, @external_links_count,
      @images_count, @images_without_alt, @meta_title_length, @meta_description_length,
      @first_100_words, @top_keywords, @content_score, @comparison, @user_id
    )
  `, [{
    url: params.url,
    keyword: params.keyword,
    score: params.score,
    word_count: params.word_count,
    density: params.density,
    checks_json: params.checks_json,
    title_suggestions: params.title_suggestions ?? null,
    keyword_density: params.keyword_density ?? null,
    readability_score: params.readability_score ?? null,
    readability_level: params.readability_level ?? null,
    word_count_full: params.word_count_full ?? null,
    heading_structure: params.heading_structure ?? null,
    internal_links_count: params.internal_links_count ?? 0,
    external_links_count: params.external_links_count ?? 0,
    images_count: params.images_count ?? 0,
    images_without_alt: params.images_without_alt ?? 0,
    meta_title_length: params.meta_title_length ?? null,
    meta_description_length: params.meta_description_length ?? null,
    first_100_words: params.first_100_words ?? null,
    top_keywords: params.top_keywords ?? null,
    content_score: params.content_score ?? null,
    comparison: params.comparison ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToContentCheckFull(row);
}

export async function listContentChecks(userId: string, limit = 10): Promise<ContentCheckRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM content_checks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `, [userId, limit]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    url: String(r.url),
    keyword: String(r.keyword),
    score: Number(r.score),
    word_count: Number(r.word_count),
    density: Number(r.density),
    checks_json: String(r.checks_json),
    created_at: String(r.created_at),
  }));
}

export async function getContentCheckById(userId: string, id: number): Promise<ContentCheckRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? {
    id: Number(row.id),
    url: String(row.url),
    keyword: String(row.keyword),
    score: Number(row.score),
    word_count: Number(row.word_count),
    density: Number(row.density),
    checks_json: String(row.checks_json),
    created_at: String(row.created_at),
  } : null;
}

export async function getContentCheckFull(userId: string, id: number): Promise<ContentCheckFull | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToContentCheckFull(row) : null;
}

export async function listContentChecksFull(userId: string, limit = 10, urlFilter?: string): Promise<ContentCheckFull[]> {
  const db = await getAdapter();
  const rows = urlFilter
    ? await db.query(`SELECT * FROM content_checks WHERE user_id = ? AND url = ? ORDER BY created_at DESC LIMIT ?`, [userId, urlFilter, limit]) as Record<string, unknown>[]
    : await db.query(`SELECT * FROM content_checks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToContentCheckFull);
}

export async function getPreviousContentCheck(userId: string, url: string, excludeId: number): Promise<ContentCheckFull | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM content_checks
    WHERE url = ? AND id < ? AND user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `, [url, excludeId, userId]) as Record<string, unknown> | undefined;
  return row ? rowToContentCheckFull(row) : null;
}

export async function updateContentCheckComparison(userId: string, id: number, comparison: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE content_checks SET comparison = ? WHERE id = ? AND user_id = ?`, [comparison, id, userId]);
}

// ---------- audits ----------

export interface AuditRow {
  id: number;
  domain: string;
  started_at: string;
  finished_at: string | null;
  pages_crawled: number;
  health_score: number | null;
  status: "running" | "completed" | "failed";
  errors: number;
  warnings: number;
  notices: number;
  comparison: string | null;
  error: string | null;
  depth: "quick" | "full";
  pages_detail: string | null;
}

export interface AuditIssueRow {
  id: number;
  audit_id: number;
  type: string;
  severity: "error" | "warning" | "notice";
  url: string;
  detail: string;
  suggestion: string | null;
}

export async function createAudit(userId: string, domain: string, depth: "quick" | "full" = "quick"): Promise<AuditRow> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO audits (domain, status, depth, user_id) VALUES (?, 'running', ?, ?)
  `, [domain, depth, userId]);
  const row = await db.get(`SELECT * FROM audits WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToAudit(row);
}

function rowToAudit(row: Record<string, unknown>): AuditRow {
  return {
    id: Number(row.id),
    domain: String(row.domain),
    started_at: String(row.started_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
    pages_crawled: Number(row.pages_crawled),
    health_score: row.health_score === null ? null : Number(row.health_score),
    status: String(row.status) as AuditRow["status"],
    errors: Number(row.errors),
    warnings: Number(row.warnings),
    notices: Number(row.notices),
    comparison: row.comparison ? String(row.comparison) : null,
    error: row.error ? String(row.error) : null,
    depth: (row.depth === "full" ? "full" : "quick"),
    pages_detail: row.pages_detail ? String(row.pages_detail) : null,
  };
}

export async function updateAuditProgress(userId: string, id: number, pagesCrawled: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE audits SET pages_crawled = ? WHERE id = ? AND user_id = ?`, [pagesCrawled, id, userId]);
}

export async function finishAudit(
  userId: string,
  id: number,
  params: {
    health_score: number;
    errors: number;
    warnings: number;
    notices: number;
    status?: "completed" | "failed";
    comparison?: string | null;
    error?: string | null;
    pages_detail?: string | null;
  }
): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    UPDATE audits
    SET health_score = ?, errors = ?, warnings = ?, notices = ?, status = ?, finished_at = datetime('now'),
        comparison = COALESCE(?, comparison),
        error = COALESCE(?, error),
        pages_detail = COALESCE(?, pages_detail)
    WHERE id = ? AND user_id = ?
  `, [
    params.health_score,
    params.errors,
    params.warnings,
    params.notices,
    params.status ?? "completed",
    params.comparison ?? null,
    params.error ?? null,
    params.pages_detail ?? null,
    id,
    userId
  ]);
}

export async function getAuditById(userId: string, id: number): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM audits WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

export async function getLatestAudit(userId: string, domain: string): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE domain = ? AND user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [domain, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

/** 获取某域名在指定 auditId 之前最近一次审计 */
export async function getPreviousAudit(userId: string, domain: string, currentAuditId: number): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE domain = ? AND id < ? AND user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [domain, currentAuditId, userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

export async function addAuditIssue(userId: string, params: {
  audit_id: number;
  type: string;
  severity: "error" | "warning" | "notice";
  url: string;
  detail: string;
  suggestion?: string | null;
}): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO audit_issues (audit_id, type, severity, url, detail, suggestion, user_id)
    VALUES (@audit_id, @type, @severity, @url, @detail, @suggestion, @user_id)
  `, [{ ...params, suggestion: params.suggestion ?? null, user_id: userId }]);
}

export async function getAuditIssues(userId: string, auditId: number): Promise<AuditIssueRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM audit_issues WHERE audit_id = ? AND user_id = ? ORDER BY
      CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      type
  `, [auditId, userId]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    audit_id: Number(r.audit_id),
    type: String(r.type),
    severity: String(r.severity) as AuditIssueRow["severity"],
    url: String(r.url),
    detail: String(r.detail),
    suggestion: r.suggestion ? String(r.suggestion) : null,
  }));
}

/** 获取某域名最近 N 次审计摘要（含 comparison JSON） */
export async function getAuditHistory(userId: string, domain: string, limit = 10): Promise<AuditRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM audits WHERE domain = ? AND status = 'completed' AND user_id = ?
    ORDER BY started_at DESC LIMIT ?
  `, [domain, userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAudit);
}

// ---------- 报告导出查询 ----------

/** 获取所有追踪关键词 + 最近 N 天 rank_history（按日期升序） */
export interface KeywordReportRow {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
  history: { date: string; position: number | null; url: string | null }[];
}

export async function listTrackedKeywordsWithHistory(userId: string, days = 30): Promise<KeywordReportRow[]> {
  const db = await getAdapter();
  const keywords = await db.query(`
    SELECT id, keyword, location, device, domain
    FROM tracked_keywords
    WHERE user_id = ?
    ORDER BY created_at ASC
  `, [userId]) as Record<string, unknown>[];

  const rows: KeywordReportRow[] = keywords.map((k) => ({
    id: Number(k.id),
    keyword: String(k.keyword),
    location: String(k.location),
    device: String(k.device) as "PC" | "移动端",
    domain: String(k.domain),
    history: [],
  }));

  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const histRows = await db.query(`
    SELECT keyword_id, date, position, url
    FROM rank_history
    WHERE keyword_id IN (${placeholders}) AND user_id = ?
    AND date >= date('now', 'localtime', ?)
    ORDER BY keyword_id ASC, date ASC
  `, [...ids, userId, `-${days} day`]) as Record<string, unknown>[];

  const histMap = new Map<number, KeywordReportRow["history"]>();
  for (const h of histRows) {
    const kid = Number(h.keyword_id);
    const arr = histMap.get(kid) ?? [];
    arr.push({
      date: String(h.date),
      position: h.position === null ? null : Number(h.position),
      url: h.url ? String(h.url) : null,
    });
    histMap.set(kid, arr);
  }

  for (const r of rows) {
    r.history = histMap.get(r.id) ?? [];
  }
  return rows;
}

/** 累计检测次数（content_checks 总数） */
export async function countContentChecks(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM content_checks WHERE user_id = ?`, [userId]) as { c: number };
  return row.c;
}

/** 全局最近一次审计（不限域名） */
export async function getGlobalLatestAudit(userId: string): Promise<AuditRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM audits WHERE user_id = ? ORDER BY started_at DESC LIMIT 1
  `, [userId]) as Record<string, unknown> | undefined;
  return row ? rowToAudit(row) : null;
}

// ---------- reports ----------

export type ReportType = "ranking" | "audit" | "content" | "weekly";

export interface ReportRow {
  id: number;
  project_id: number | null;
  type: ReportType;
  title: string;
  data_json: string;
  pdf_path: string | null;
  created_at: string;
}

function rowToReport(row: Record<string, unknown>): ReportRow {
  return {
    id: Number(row.id),
    project_id: row.project_id !== null && row.project_id !== undefined ? Number(row.project_id) : null,
    type: String(row.type) as ReportType,
    title: String(row.title),
    data_json: String(row.data_json),
    pdf_path: row.pdf_path ? String(row.pdf_path) : null,
    created_at: String(row.created_at),
  };
}

export async function createReport(
  userId: string,
  projectId: number | null,
  type: ReportType,
  title: string,
  dataJson: string
): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO reports (project_id, type, title, data_json, user_id)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, type, title, dataJson, userId]);
  return Number(info.lastInsertRowid);
}

export async function listReports(userId: string, projectId?: number): Promise<ReportRow[]> {
  const db = await getAdapter();
  const rows = projectId !== undefined
    ? await db.query(`SELECT * FROM reports WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC`, [projectId, userId]) as Record<string, unknown>[]
    : await db.query(`SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Record<string, unknown>[];
  return rows.map(rowToReport);
}

export async function getReport(userId: string, id: number): Promise<ReportRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM reports WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToReport(row) : null;
}

export async function deleteReport(userId: string, id: number): Promise<void> {
  const db = await getAdapter();
  await db.run(`DELETE FROM reports WHERE id = ? AND user_id = ?`, [id, userId]);
}

// ---------- alerts ----------

export type AlertType = "rank_drop" | "rank_up" | "new_error" | "audit_done";
export type AlertLevel = "error" | "warning" | "info";

export interface AlertRow {
  id: number;
  type: AlertType;
  level: AlertLevel;
  title: string;
  detail: string | null;
  domain: string | null;
  created_at: string;
  read: 0 | 1;
}

function rowToAlert(row: Record<string, unknown>): AlertRow {
  return {
    id: Number(row.id),
    type: String(row.type) as AlertType,
    level: String(row.level) as AlertLevel,
    title: String(row.title),
    detail: row.detail ? String(row.detail) : null,
    domain: row.domain ? String(row.domain) : null,
    created_at: String(row.created_at),
    read: Number(row.read) as 0 | 1,
  };
}

export async function createAlert(userId: string, params: {
  type: AlertType;
  level: AlertLevel;
  title: string;
  detail?: string | null;
  domain?: string | null;
}): Promise<AlertRow> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO alerts (type, level, title, detail, domain, user_id)
    VALUES (@type, @level, @title, @detail, @domain, @user_id)
  `, [{
    type: params.type,
    level: params.level,
    title: params.title,
    detail: params.detail ?? null,
    domain: params.domain ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM alerts WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToAlert(row);
}

export async function listAlerts(userId: string, limit = 50): Promise<AlertRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAlert);
}

export async function markAlertRead(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();
  const info = await db.run(`UPDATE alerts SET read = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  return info.changes > 0;
}

export async function markAllAlertsRead(userId: string): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`UPDATE alerts SET read = 1 WHERE read = 0 AND user_id = ?`, [userId]);
  return info.changes;
}

export async function countUnreadAlerts(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND user_id = ?`, [userId]) as { c: number };
  return row.c;
}

export async function countUnreadAlertsByDomain(userId: string, domain: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND domain = ? AND user_id = ?`, [domain, userId]) as { c: number };
  return row.c;
}

/** 兜底去重：同 domain + 同 title + 同日期（localtime）是否已存在预警 */
export async function hasAlertToday(userId: string, domain: string, title: string): Promise<boolean> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT 1 FROM alerts
    WHERE domain = ? AND title = ? AND date(created_at) = date('now', 'localtime') AND user_id = ?
    LIMIT 1
  `, [domain, title, userId]) as { 1: number } | undefined;
  return !!row;
}

// ---------- projects ----------

export interface ProjectRow {
  id: number;
  name: string;
  domain: string;
  created_at: string;
}

export interface ProjectWithMetrics extends ProjectRow {
  trackedKeywordCount: number;
  healthScore: number | null;
  lastAuditTime: string | null;
  rankUp7d: number;
  rankDown7d: number;
  alertCount: number;
}

function rowToProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    domain: String(row.domain),
    created_at: String(row.created_at),
  };
}

export async function listProjects(userId: string): Promise<ProjectRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export async function addProject(userId: string, name: string, domain: string): Promise<ProjectRow> {
  const db = await getAdapter();
  const info = await db.run(`INSERT INTO projects (name, domain, user_id) VALUES (?, ?, ?)`, [name, domain, userId]);
  const row = await db.get(`SELECT * FROM projects WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToProject(row);
}

export async function removeProject(userId: string, id: number): Promise<boolean> {
  const db = await getAdapter();

  // 先确认项目存在并取 domain（用于按 domain 关联的表）
  const project = await db.get(`SELECT domain FROM projects WHERE id = ? AND user_id = ?`, [id, userId]) as
    | { domain: string }
    | undefined;
  if (!project) return false;
  const domain = project.domain;

  // 1. 获取该项目 domain 下的所有关键词 ID
  const keywords = await db.query(
    `SELECT id FROM tracked_keywords WHERE domain = ? AND user_id = ?`,
    [domain, userId]
  ) as Array<{ id: number }>;
  const keywordIds = keywords.map((k) => k.id);

  // 2. 删除关键词关联数据（rank_history / competitor_ranks / keyword_group_members）
  if (keywordIds.length > 0) {
    const placeholders = keywordIds.map(() => "?").join(",");
    await db.run(
      `DELETE FROM rank_history WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
    await db.run(
      `DELETE FROM competitor_ranks WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
    await db.run(
      `DELETE FROM keyword_group_members WHERE keyword_id IN (${placeholders}) AND user_id = ?`,
      [...keywordIds, userId]
    );
  }

  // 3. 删除竞品及其排名（competitors.project_id 直接关联）
  await db.run(
    `DELETE FROM competitor_ranks WHERE competitor_id IN (SELECT id FROM competitors WHERE project_id = ? AND user_id = ?) AND user_id = ?`,
    [id, userId, userId]
  );
  await db.run(`DELETE FROM competitors WHERE project_id = ? AND user_id = ?`, [id, userId]);

  // 4. 删除审计及其问题（audits 按 domain 关联）
  await db.run(
    `DELETE FROM audit_issues WHERE audit_id IN (SELECT id FROM audits WHERE domain = ? AND user_id = ?) AND user_id = ?`,
    [domain, userId, userId]
  );
  await db.run(`DELETE FROM audits WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 5. 删除内容检查（content_checks 按 url LIKE domain% 关联）
  await db.run(`DELETE FROM content_checks WHERE url LIKE ? AND user_id = ?`, [`${domain}%`, userId]);

  // 6. 删除告警（alerts 按 domain 关联）
  await db.run(`DELETE FROM alerts WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 7. 删除报告（reports.project_id 直接关联）
  await db.run(`DELETE FROM reports WHERE project_id = ? AND user_id = ?`, [id, userId]);

  // 8. 删除追踪关键词
  await db.run(`DELETE FROM tracked_keywords WHERE domain = ? AND user_id = ?`, [domain, userId]);

  // 9. 删除项目本身
  await db.run(`DELETE FROM projects WHERE id = ? AND user_id = ?`, [id, userId]);

  return true;
}

export async function getProjectById(userId: string, id: number): Promise<ProjectRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM projects WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export async function getProjectByDomain(userId: string, domain: string): Promise<ProjectRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM projects WHERE domain = ? AND user_id = ?`, [domain, userId]) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

// ---------- 项目指标辅助查询 ----------

export async function countTrackedKeywordsByDomain(userId: string, domain: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM tracked_keywords WHERE domain = ? AND user_id = ?`, [domain, userId]) as { c: number };
  return row.c;
}

/** 获取某域名下追踪关键词近 7 天排名升降数 */
export async function getRankStats7d(userId: string, domain: string): Promise<{ up: number; down: number }> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT
      today.position AS today_pos,
      past.position AS past_pos
    FROM tracked_keywords tk
    LEFT JOIN rank_history today
      ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
    LEFT JOIN rank_history past
      ON past.keyword_id = tk.id AND past.date = date('now', 'localtime', '-7 day')
    WHERE tk.domain = ? AND tk.user_id = ?
  `, [domain, userId]) as Record<string, unknown>[];

  let up = 0;
  let down = 0;
  for (const r of rows) {
    const todayPos = r.today_pos === null || r.today_pos === undefined ? null : Number(r.today_pos);
    const pastPos = r.past_pos === null || r.past_pos === undefined ? null : Number(r.past_pos);
    if (todayPos !== null && pastPos !== null) {
      if (todayPos < pastPos) up++;
      else if (todayPos > pastPos) down++;
    }
  }
  return { up, down };
}

/**
 * 批量构建项目指标（核心辅助函数）。
 * 用 4 次批量查询替代 4N 次循环查询，避免 N+1 问题。
 * - 第 1 次：按 domain 批量统计 tracked_keywords
 * - 第 2 次：按 domain 批量取最新 audit（MAX(id)）
 * - 第 3 次：按 domain 批量计算近 7 天排名升降数
 * - 第 4 次：按 domain 批量统计未读 alerts
 */
async function buildProjectsWithMetricsBase(
  userId: string,
  projects: ProjectRow[]
): Promise<ProjectWithMetrics[]> {
  if (projects.length === 0) return [];
  const db = await getAdapter();

  const domains = projects.map((p) => p.domain);
  const placeholders = domains.map(() => "?").join(",");

  // 1. 批量获取关键词计数
  const keywordRows = await db.query(
    `SELECT domain, COUNT(*) AS c FROM tracked_keywords WHERE domain IN (${placeholders}) AND user_id = ? GROUP BY domain`,
    [...domains, userId]
  ) as Array<{ domain: string; c: number }>;
  const keywordMap = new Map<string, number>();
  for (const r of keywordRows) keywordMap.set(r.domain, Number(r.c));

  // 2. 批量获取每个 domain 的最新审计（MAX(id) 等价于 ORDER BY started_at DESC LIMIT 1）
  const auditRows = await db.query(
    `SELECT domain, health_score, started_at, finished_at
     FROM audits
     WHERE domain IN (${placeholders}) AND user_id = ?
       AND id IN (SELECT MAX(id) FROM audits a2 GROUP BY a2.domain)`,
    [...domains, userId]
  ) as Array<{
      domain: string;
      health_score: number | null;
      started_at: string;
      finished_at: string | null;
    }>;
  const auditMap = new Map<string, { healthScore: number | null; lastTime: string }>();
  for (const r of auditRows) {
    auditMap.set(r.domain, {
      healthScore: r.health_score === null || r.health_score === undefined ? null : Number(r.health_score),
      lastTime: r.finished_at ?? r.started_at,
    });
  }

  // 3. 批量获取每个 domain 近 7 天排名升降数（today vs 7-day-ago）
  const rankRows = await db.query(
    `SELECT tk.domain,
       SUM(CASE WHEN today.position IS NOT NULL AND past.position IS NOT NULL
                 AND today.position < past.position THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN today.position IS NOT NULL AND past.position IS NOT NULL
                 AND today.position > past.position THEN 1 ELSE 0 END) AS down
     FROM tracked_keywords tk
     LEFT JOIN rank_history today
       ON today.keyword_id = tk.id AND today.date = date('now', 'localtime')
     LEFT JOIN rank_history past
       ON past.keyword_id = tk.id AND past.date = date('now', 'localtime', '-7 day')
     WHERE tk.domain IN (${placeholders}) AND tk.user_id = ?
     GROUP BY tk.domain`,
    [...domains, userId]
  ) as Array<{ domain: string; up: number | null; down: number | null }>;
  const rankMap = new Map<string, { up: number; down: number }>();
  for (const r of rankRows) {
    rankMap.set(r.domain, {
      up: Number(r.up ?? 0),
      down: Number(r.down ?? 0),
    });
  }

  // 4. 批量获取每个 domain 未读预警数
  const alertRows = await db.query(
    `SELECT domain, COUNT(*) AS c FROM alerts WHERE read = 0 AND domain IN (${placeholders}) AND user_id = ? GROUP BY domain`,
    [...domains, userId]
  ) as Array<{ domain: string; c: number }>;
  const alertMap = new Map<string, number>();
  for (const r of alertRows) alertMap.set(r.domain, Number(r.c));

  return projects.map((p) => {
    const audit = auditMap.get(p.domain);
    const rank = rankMap.get(p.domain);
    return {
      ...p,
      trackedKeywordCount: keywordMap.get(p.domain) ?? 0,
      healthScore: audit?.healthScore ?? null,
      lastAuditTime: audit?.lastTime ?? null,
      rankUp7d: rank?.up ?? 0,
      rankDown7d: rank?.down ?? 0,
      alertCount: alertMap.get(p.domain) ?? 0,
    };
  });
}

/** 获取所有项目及其指标（一次调用，工作台用）。
 *  查询次数固定 5 次（1 次取项目 + 4 次批量指标），与项目数无关。 */
export async function listProjectsWithMetrics(userId: string): Promise<ProjectWithMetrics[]> {
  const projects = await listProjects(userId);
  return buildProjectsWithMetricsBase(userId, projects);
}

/**
 * 获取指定用户有权限的项目及其指标（启用鉴权时用）。
 * 通过 Supabase 的 projects 表（RLS 自动按 user_id 过滤）查询项目，
 * 再用 domain 关联本地 SQLite/Turso 获取指标（审计/排名/告警）。
 *
 * 注意：Supabase projects.id 是 UUID 字符串，与本地 INTEGER id 不同。
 * 这里用 domain 作为关联键，返回的 id 仍为 Supabase UUID（字符串转 number 失败时用 0 占位）。
 * 同样使用批量查询避免 N+1（4N → 4 次）。
 */
export async function listProjectsWithMetricsForUser(
  userId: string,
  supabaseProjects: Array<{ id: string; name: string; domain: string; created_at: string }>
): Promise<ProjectWithMetrics[]> {
  // 转换为 ProjectRow[] 后复用批量构建逻辑（Supabase UUID 无法转 number，用 0 占位）
  const projects: ProjectRow[] = supabaseProjects.map((p) => ({
    id: 0,
    name: p.name,
    domain: p.domain,
    created_at: p.created_at,
  }));
  return buildProjectsWithMetricsBase(userId, projects);
}

// ---------- 排名对比辅助 ----------

/** 获取某关键词在指定日期之前最近的一条 rank_history */
export async function getPreviousRankHistory(userId: string, keywordId: number, beforeDate: string): Promise<RankHistoryRow | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM rank_history
    WHERE keyword_id = ? AND date < ? AND user_id = ?
    ORDER BY date DESC
    LIMIT 1
  `, [keywordId, beforeDate, userId]) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    keyword_id: Number(row.keyword_id),
    date: String(row.date),
    position: row.position === null ? null : Number(row.position),
    url: row.url ? String(row.url) : null,
    created_at: String(row.created_at),
  };
}

// ---------- automation ----------

export interface AutomationSettings {
  id: number;
  daily_refresh_enabled: number;
  daily_refresh_time: string;
  weekly_report_enabled: number;
  weekly_report_day: number;
  weekly_report_time: string;
  updated_at: string;
}

export interface AutomationLog {
  id: number;
  type: "daily_refresh" | "weekly_report";
  status: "success" | "failed" | "running";
  summary: string | null;
  details: string | null;
  created_at: string;
}

function rowToAutomationSettings(row: Record<string, unknown>): AutomationSettings {
  return {
    id: Number(row.id),
    daily_refresh_enabled: Number(row.daily_refresh_enabled),
    daily_refresh_time: String(row.daily_refresh_time),
    weekly_report_enabled: Number(row.weekly_report_enabled),
    weekly_report_day: Number(row.weekly_report_day),
    weekly_report_time: String(row.weekly_report_time),
    updated_at: String(row.updated_at),
  };
}

function rowToAutomationLog(row: Record<string, unknown>): AutomationLog {
  return {
    id: Number(row.id),
    type: String(row.type) as AutomationLog["type"],
    status: String(row.status) as AutomationLog["status"],
    summary: row.summary ? String(row.summary) : null,
    details: row.details ? String(row.details) : null,
    created_at: String(row.created_at),
  };
}

export async function getAutomationSettings(userId: string): Promise<AutomationSettings | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM automation_settings WHERE user_id = ?`, [userId]) as Record<string, unknown> | undefined;
  return row ? rowToAutomationSettings(row) : null;
}

export async function updateAutomationSettings(userId: string, settings: Partial<Omit<AutomationSettings, "id" | "updated_at">>): Promise<void> {
  const db = await getAdapter();
  const current = await getAutomationSettings(userId);
  const merged = {
    daily_refresh_enabled: settings.daily_refresh_enabled ?? current?.daily_refresh_enabled ?? 0,
    daily_refresh_time: settings.daily_refresh_time ?? current?.daily_refresh_time ?? "09:00",
    weekly_report_enabled: settings.weekly_report_enabled ?? current?.weekly_report_enabled ?? 0,
    weekly_report_day: settings.weekly_report_day ?? current?.weekly_report_day ?? 1,
    weekly_report_time: settings.weekly_report_time ?? current?.weekly_report_time ?? "09:00",
  };
  if (!current) {
    // 不存在则插入新行（user_id 唯一）
    await db.run(`
      INSERT INTO automation_settings (daily_refresh_enabled, daily_refresh_time, weekly_report_enabled, weekly_report_day, weekly_report_time, updated_at, user_id)
      VALUES (@daily_refresh_enabled, @daily_refresh_time, @weekly_report_enabled, @weekly_report_day, @weekly_report_time, datetime('now', 'localtime'), @user_id)
    `, [{ ...merged, user_id: userId }]);
  } else {
    await db.run(`
      UPDATE automation_settings
      SET daily_refresh_enabled = @daily_refresh_enabled,
          daily_refresh_time = @daily_refresh_time,
          weekly_report_enabled = @weekly_report_enabled,
          weekly_report_day = @weekly_report_day,
          weekly_report_time = @weekly_report_time,
          updated_at = datetime('now', 'localtime')
      WHERE user_id = @user_id
    `, [{ ...merged, user_id: userId }]);
  }
}

export async function listAutomationLogs(userId: string, limit = 50): Promise<AutomationLog[]> {
  const db = await getAdapter();
  const rows = await db.query(`SELECT * FROM automation_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToAutomationLog);
}

export async function addAutomationLog(userId: string, log: Omit<AutomationLog, "id" | "created_at">): Promise<number> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO automation_logs (type, status, summary, details, user_id)
    VALUES (@type, @status, @summary, @details, @user_id)
  `, [{ ...log, user_id: userId }]);
  return Number(info.lastInsertRowid);
}

export async function updateAutomationLog(userId: string, id: number, status: AutomationLog["status"], summary: string | null, details: string | null): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE automation_logs SET status = ?, summary = ?, details = ? WHERE id = ? AND user_id = ?`, [status, summary, details, id, userId]);
}

// ---------- automation 辅助查询（weekly 报告用） ----------

/**
 * 查询所有 distinct user_id（cron 遍历用户用）。
 * 演示模式下返回 ['demo-user']；鉴权模式下返回所有真实用户 ID（含 demo-user）。
 * 从有数据的表 union 取，确保至少有数据的用户被处理。
 */
export async function listDistinctUserIds(): Promise<string[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT DISTINCT user_id FROM (
      SELECT DISTINCT user_id FROM tracked_keywords
      UNION
      SELECT DISTINCT user_id FROM projects
      UNION
      SELECT DISTINCT user_id FROM automation_settings
      UNION
      SELECT DISTINCT user_id FROM audits
    )
    WHERE user_id IS NOT NULL AND user_id != ''
  `) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export interface RankChangeRow {
  keyword_id: number;
  keyword: string;
  domain: string;
  oldRank: number | null;
  newRank: number | null;
  change: number | null;
}

/** 获取某时间点之后的排名变化（对比该时间点前最近一次记录） */
export async function getRankChangesSince(userId: string, sinceISO: string): Promise<RankChangeRow[]> {
  const db = await getAdapter();
  // 取最近 8 天的关键词最新 + 之前记录对比
  const sinceDate = sinceISO.slice(0, 10);
  const keywords = await db.query(`
    SELECT tk.id, tk.keyword, tk.domain
    FROM tracked_keywords tk
    WHERE tk.user_id = ?
    ORDER BY tk.created_at ASC
  `, [userId]) as Record<string, unknown>[];

  const result: RankChangeRow[] = [];
  for (const k of keywords) {
    const kid = Number(k.id);
    const newest = await db.get(`
      SELECT position, date FROM rank_history
      WHERE keyword_id = ? AND date >= ? AND user_id = ?
      ORDER BY date DESC LIMIT 1
    `, [kid, sinceDate, userId]) as Record<string, unknown> | undefined;
    const oldest = await db.get(`
      SELECT position, date FROM rank_history
      WHERE keyword_id = ? AND date < ? AND user_id = ?
      ORDER BY date DESC LIMIT 1
    `, [kid, sinceDate, userId]) as Record<string, unknown> | undefined;

    const newRank = newest && newest.position !== null && newest.position !== undefined ? Number(newest.position) : null;
    const oldRank = oldest && oldest.position !== null && oldest.position !== undefined ? Number(oldest.position) : null;

    let change: number | null = null;
    if (oldRank !== null && newRank !== null) {
      change = newRank - oldRank; // 正 = 下降，负 = 上升
    }

    result.push({
      keyword_id: kid,
      keyword: String(k.keyword),
      domain: String(k.domain),
      oldRank,
      newRank,
      change,
    });
  }
  return result;
}

/** 获取某时间点之后的审计记录 */
export async function getAuditsSince(userId: string, sinceISO: string): Promise<AuditRow[]> {
  const db = await getAdapter();
  const sinceDate = sinceISO.slice(0, 10);
  const rows = await db.query(`
    SELECT * FROM audits WHERE date(started_at) >= ? AND user_id = ? ORDER BY started_at ASC
  `, [sinceDate, userId]) as Record<string, unknown>[];
  return rows.map(rowToAudit);
}

/** 7 天内有数据的关键词数 */
export async function countActiveKeywords(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT COUNT(DISTINCT keyword_id) AS c
    FROM rank_history
    WHERE date >= date('now', 'localtime', '-7 day') AND user_id = ?
  `, [userId]) as { c: number };
  return row.c;
}

// ---------- api_cache / api_usage（缓存与用量持久化）----------

export interface ApiCacheRow {
  key: string;
  value: string;
  expires_at: string;
}

export interface ApiUsageRow {
  month: string;
  used: number;
  limit: number;
}

/** 读取缓存：返回 { value, expiresAt } 或 null（无记录） */
export async function getCache(key: string): Promise<{ value: string; expiresAt: string } | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT value, expires_at FROM api_cache WHERE key = ?`, [key]) as
    | { value: string; expires_at: string }
    | undefined;
  return row ? { value: row.value, expiresAt: row.expires_at } : null;
}

/** 写入缓存（UPSERT）：value 为 JSON 字符串，expiresAt 为 ISO 字符串 */
export async function setCache(key: string, value: string, expiresAt: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_cache (key, value, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      expires_at = excluded.expires_at
  `, [key, value, expiresAt]);
}

/** 删除已过期缓存（清理任务用） */
export async function deleteExpiredCache(): Promise<number> {
  const db = await getAdapter();
  const nowIso = new Date().toISOString();
  const info = await db.run(`DELETE FROM api_cache WHERE expires_at < ?`, [nowIso]);
  return info.changes;
}

/** 统计当前缓存条目数（含未过期与已过期，用于设置页展示） */
export async function countCacheEntries(): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM api_cache`) as { c: number };
  return Number(row.c);
}

/** 读取某月用量：返回 { used, limit } 或 null（无记录） */
export async function getApiUsage(month: string): Promise<{ used: number; limit: number } | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT used, "limit" FROM api_usage WHERE month = ?`, [month]) as
    | { used: number; limit: number }
    | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : null;
}

/** 用量 +1（UPSERT，首次自动创建） */
export async function incrementApiUsage(month: string): Promise<{ used: number; limit: number }> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage (month, used, "limit")
    VALUES (?, 1, 100)
    ON CONFLICT(month) DO UPDATE SET
      used = used + 1
  `, [month]);
  const row = await db.get(`SELECT used, "limit" FROM api_usage WHERE month = ?`, [month]) as
    | { used: number; limit: number }
    | undefined;
  return row ? { used: Number(row.used), limit: Number(row.limit) } : { used: 1, limit: 100 };
}

/** 重置某月用量（用于月份切换时） */
export async function resetApiUsage(month: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`
    INSERT INTO api_usage (month, used, "limit")
    VALUES (?, 0, 100)
    ON CONFLICT(month) DO UPDATE SET
      used = 0
  `, [month]);
}

// ---------- Backlinks（DataForSEO） ----------

export interface BacklinkSummaryRow {
  id: number;
  domain: string;
  total_backlinks: number | null;
  referring_domains: number | null;
  domain_rank: number | null;
  dofollow_pct: number | null;
  raw_json: string | null;
  fetched_at: string;
}

export interface BacklinkRow {
  id: number;
  domain: string;
  source_url: string | null;
  anchor: string | null;
  target_url: string | null;
  dofollow: number | null;
  source_rank: number | null;
  first_seen: string | null;
  fetched_at: string;
}

/** 读取某域名的缓存 summary（7 天有效性由调用方判断 fetched_at） */
export async function getBacklinkSummary(userId: string, domain: string): Promise<BacklinkSummaryRow | null> {
  const db = await getAdapter();
  const row = await db.get(
    `SELECT * FROM backlink_summaries WHERE domain = ? AND user_id = ? LIMIT 1`,
    [domain, userId]
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    domain: String(row.domain),
    total_backlinks: row.total_backlinks === null ? null : Number(row.total_backlinks),
    referring_domains: row.referring_domains === null ? null : Number(row.referring_domains),
    domain_rank: row.domain_rank === null ? null : Number(row.domain_rank),
    dofollow_pct: row.dofollow_pct === null ? null : Number(row.dofollow_pct),
    raw_json: row.raw_json ? String(row.raw_json) : null,
    fetched_at: String(row.fetched_at),
  };
}

/** 读取某域名的缓存外链列表（按 source_rank 降序） */
export async function listBacklinks(userId: string, domain: string, limit = 100): Promise<BacklinkRow[]> {
  const db = await getAdapter();
  const rows = await db.query(
    `SELECT * FROM backlinks WHERE domain = ? AND user_id = ? ORDER BY COALESCE(source_rank, 0) DESC, id ASC LIMIT ?`,
    [domain, userId, limit]
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    domain: String(r.domain),
    source_url: r.source_url === null || r.source_url === undefined ? null : String(r.source_url),
    anchor: r.anchor === null || r.anchor === undefined ? null : String(r.anchor),
    target_url: r.target_url === null || r.target_url === undefined ? null : String(r.target_url),
    dofollow: r.dofollow === null || r.dofollow === undefined ? null : Number(r.dofollow),
    source_rank: r.source_rank === null || r.source_rank === undefined ? null : Number(r.source_rank),
    first_seen: r.first_seen === null || r.first_seen === undefined ? null : String(r.first_seen),
    fetched_at: String(r.fetched_at),
  }));
}

export interface SaveBacklinksInput {
  domain: string;
  summary: {
    total_backlinks: number | null;
    referring_domains: number | null;
    domain_rank: number | null;
    dofollow_pct: number | null;
    raw_json: string | null;
  };
  rows: Array<{
    source_url: string | null;
    anchor: string | null;
    target_url: string | null;
    dofollow: number | null;
    source_rank: number | null;
    first_seen: string | null;
  }>;
}

/**
 * 写入外链数据：summary 用 UPSERT，backlinks 先删该域名旧行再批量插入。
 * 命名参数约定与 addAuditIssue 一致（db.run(sql, [{...}])）。
 */
export async function saveBacklinks(userId: string, input: SaveBacklinksInput): Promise<void> {
  const db = await getAdapter();
  // summary UPSERT
  await db.run(
    `INSERT INTO backlink_summaries (domain, total_backlinks, referring_domains, domain_rank, dofollow_pct, raw_json, fetched_at, user_id)
     VALUES (@domain, @total_backlinks, @referring_domains, @domain_rank, @dofollow_pct, @raw_json, datetime('now'), @user_id)
     ON CONFLICT(domain) DO UPDATE SET
       total_backlinks = @total_backlinks,
       referring_domains = @referring_domains,
       domain_rank = @domain_rank,
       dofollow_pct = @dofollow_pct,
       raw_json = @raw_json,
       fetched_at = datetime('now')`,
    [{
      domain: input.domain,
      total_backlinks: input.summary.total_backlinks,
      referring_domains: input.summary.referring_domains,
      domain_rank: input.summary.domain_rank,
      dofollow_pct: input.summary.dofollow_pct,
      raw_json: input.summary.raw_json,
      user_id: userId,
    }]
  );
  // 删旧行
  await db.run(`DELETE FROM backlinks WHERE domain = ? AND user_id = ?`, [input.domain, userId]);
  // 批量插入（每行一条 INSERT，命名参数）
  for (const r of input.rows) {
    await db.run(
      `INSERT INTO backlinks (domain, source_url, anchor, target_url, dofollow, source_rank, first_seen, fetched_at, user_id)
       VALUES (@domain, @source_url, @anchor, @target_url, @dofollow, @source_rank, @first_seen, datetime('now'), @user_id)`,
      [{
        domain: input.domain,
        source_url: r.source_url,
        anchor: r.anchor,
        target_url: r.target_url,
        dofollow: r.dofollow,
        source_rank: r.source_rank,
        first_seen: r.first_seen,
        user_id: userId,
      }]
    );
  }
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// 触发初始化（首次 import 时即建表）
void ensureDir();

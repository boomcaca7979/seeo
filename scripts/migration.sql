-- SeeO 数据库迁移 SQL（Turso 初始化用）
-- 执行方式：turso db shell seeo < scripts/migration.sql

-- ===== 基础表 =====

CREATE TABLE IF NOT EXISTS tracked_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL,
  device TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_unique
  ON tracked_keywords(keyword, location, device, domain);

CREATE TABLE IF NOT EXISTS rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  position INTEGER,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE,
  UNIQUE (keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_rank_history_keyword
  ON rank_history(keyword_id, date);

CREATE TABLE IF NOT EXISTS content_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  keyword TEXT NOT NULL,
  score INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  density REAL NOT NULL,
  checks_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title_suggestions TEXT,
  keyword_density TEXT,
  readability_score INTEGER,
  readability_level TEXT,
  word_count_full INTEGER,
  heading_structure TEXT,
  internal_links_count INTEGER DEFAULT 0,
  external_links_count INTEGER DEFAULT 0,
  images_count INTEGER DEFAULT 0,
  images_without_alt INTEGER DEFAULT 0,
  meta_title_length INTEGER,
  meta_description_length INTEGER,
  first_100_words TEXT,
  top_keywords TEXT,
  content_score INTEGER,
  comparison TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_checks_created
  ON content_checks(created_at DESC);

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
  comparison TEXT
);

CREATE INDEX IF NOT EXISTS idx_audits_domain
  ON audits(domain, started_at DESC);

CREATE TABLE IF NOT EXISTS audit_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  url TEXT NOT NULL,
  detail TEXT NOT NULL,
  suggestion TEXT,
  FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_issues_audit
  ON audit_issues(audit_id);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  domain TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alerts_created
  ON alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_read
  ON alerts(read);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_domain
  ON projects(domain);

CREATE TABLE IF NOT EXISTS automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_refresh_enabled INTEGER NOT NULL DEFAULT 0,
  daily_refresh_time TEXT NOT NULL DEFAULT '09:00',
  weekly_report_enabled INTEGER NOT NULL DEFAULT 0,
  weekly_report_day INTEGER NOT NULL DEFAULT 1,
  weekly_report_time TEXT NOT NULL DEFAULT '09:00',
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('daily_refresh', 'weekly_report')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
  summary TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_created
  ON automation_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS keyword_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS keyword_group_members (
  group_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (group_id, keyword_id),
  FOREIGN KEY (group_id) REFERENCES keyword_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keyword_group_members_keyword
  ON keyword_group_members(keyword_id);
CREATE INDEX IF NOT EXISTS idx_keyword_group_members_group
  ON keyword_group_members(group_id);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(project_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_competitors_project
  ON competitors(project_id);

CREATE TABLE IF NOT EXISTS competitor_ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  rank INTEGER,
  target_url TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_competitor_ranks_keyword
  ON competitor_ranks(keyword_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_ranks_competitor
  ON competitor_ranks(competitor_id, keyword_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('ranking', 'audit', 'content', 'weekly')),
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  pdf_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_reports_created
  ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_project
  ON reports(project_id);

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

-- ===== 默认数据 =====

INSERT OR IGNORE INTO automation_settings (id) VALUES (1);

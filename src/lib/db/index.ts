// ===== SQLite 持久化层（服务端专用） =====
// 数据库文件：data/seeo.db（已加入 .gitignore）
// 以后迁移 Supabase 时只需替换本文件实现，页面/API 路由不动
//
// 本文件为聚合入口，按领域拆分到以下模块：
//   migrations.ts - 数据库连接、初始化、迁移、表创建
//   keywords.ts   - tracked_keywords、keyword_groups
//   rankings.ts   - rank_history、排名对比辅助
//   projects.ts   - projects、competitors、项目指标
//   audits.ts     - audits、audit_issues
//   content.ts    - content_checks
//   reports.ts    - reports、alerts、报告导出查询
//   backlinks.ts  - backlinks、backlink_summaries
//   usage.ts      - api_cache、api_usage
//   users.ts      - 用户枚举、automation_settings、automation_logs

// migrations.ts 仅 re-export closeDb（getAdapter 为内部共享，不暴露给调用方）
export { closeDb } from "./migrations";

export * from "./keywords";
export * from "./rankings";
export * from "./projects";
export * from "./audits";
export * from "./content";
export * from "./reports";
export * from "./backlinks";
export * from "./usage";
export * from "./users";

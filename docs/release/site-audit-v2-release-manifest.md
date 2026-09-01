# Site Audit V2 — Release Manifest

> Phase 3 Final Release Audit = PASS 后的 commit 范围审查产物。
> 本文件仅为发布清单，不执行任何 git add / commit / push。
> 审查时间：2026-09-01 · 分支：main · 基线：a8eb485

## Included（Site Audit V2 — 建议进入 commit）

### Audit Engine / Crawler / Rules / Score（已跟踪，修改）

| File                             | Status | Reason                                             |
| -------------------------------- | ------ | -------------------------------------------------- |
| src/lib/audit.ts                 | M      | Audit Engine V2（40 规则执行、findings、版本写入）             |
| src/lib/crawl/index.ts           | M      | Crawler：redirect chain、fetch records、AI crawler 解析 |
| src/lib/seo/audit-checks.ts      | M      | 规则目录 23→40 项（V1 23 项全部保留）                          |
| src/lib/seo/audit-legacy-text.ts | M      | 历史数据双语兼容层                                          |

### Audit Engine / Score / 分析（未跟踪，新增）

| File                           | Status | Reason                                         |
| ------------------------------ | ------ | ---------------------------------------------- |
| src/lib/seo/audit-score.ts     | A      | Score Engine V2（weight×severity×affectedRatio） |
| src/lib/seo/audit-dashboard.ts | A      | DashboardSnapshot 聚合（单一数据源）                    |
| src/lib/seo/audit-ltext.ts     | A      | LocalizedText 双语工具                             |
| src/lib/seo/page-type.ts       | A      | 页面类型分类                                         |
| src/lib/seo/structured-data.ts | A      | JSON-LD 解析与校验                                  |
| src/lib/seo/site-reports.ts    | A      | Thematic reports 聚合                            |

### API / DB（已跟踪，修改）

| File                              | Status | Reason                                                    |
| --------------------------------- | ------ | --------------------------------------------------------- |
| src/app/api/audit/latest/route.ts | M      | 返回 dashboard 快照 + engine/ruleSet 版本                       |
| src/lib/db/audits.ts              | M      | engine\_version / rule\_set\_version / dashboard\_json 读写 |
| src/lib/db/migrations.ts          | M      | audits 表 3 个新列（try/catch ALTER，历史数据兼容）                    |

### Dashboard UI

| File                                             | Status | Reason                                              |
| ------------------------------------------------ | ------ | --------------------------------------------------- |
| src/app/(default)/(dashboard)/app/audit/page.tsx | M      | V2 Dashboard 主页面（视图路由/轮询/单一数据口径）                    |
| src/components/audit/Overview\.tsx               | A      | Overview（Health/Top Issues/Trend/Comparison）        |
| src/components/audit/IssuesCenter.tsx            | A      | Issues Center（筛选/New badge/Issue Detail/Drill-down） |
| src/components/audit/CrawledPages.tsx            | A      | Crawled Pages（URL 状态/Page Detail 五层）                |
| src/components/audit/Analysis.tsx                | A      | Linking/StructuredData/AiSearch/CrawlerStats        |
| src/components/audit/HistorySection.tsx          | A      | History 趋势（V1/V2 版本标记）                              |
| src/components/audit/ui.tsx                      | A      | 共享 UI（SectionCard/badge/fmtNum）                     |
| src/components/reports/AuditReport.tsx           | M      | LText→LocalizedText 类型跟随重构（Audit V2 类型导出改名）         |

### i18n

| File             | Status | Reason                                                  |
| ---------------- | ------ | ------------------------------------------------------- |
| messages/en.json | M      | 单一 hunk（L1266+，dashboard.audit 命名空间）249 行，全部 Audit V2 键 |
| messages/zh.json | M      | 同上，与 en.json 完全对称                                       |

### Tests

| File                                                                 | Status | Reason                 |
| -------------------------------------------------------------------- | ------ | ---------------------- |
| src/lib/audit-dedup.test.ts                                          | M      | 引擎去重回归更新               |
| src/lib/seo/audit-checks.test.ts                                     | M      | 规则目录回归                 |
| src/lib/seo/audit-coverage.test.ts                                   | M      | 覆盖率口径回归                |
| src/lib/seo/audit-legacy-text.test.ts                                | M      | 双语兼容回归                 |
| src/lib/seo/audit-locale-regression.test.ts                          | M      | locale 回归              |
| src/lib/seo/audit-rules.test.ts                                      | M      | V1 23 项 + SD 拆分回归      |
| src/app/api/audit/latest/route.test.ts                               | M      | API 契约回归               |
| src/lib/crawl/crawl-redirects.test.ts                                | A      | redirect chain/loop 回归 |
| src/lib/seo/audit-score.test.ts                                      | A      | Score Engine 回归        |
| src/lib/seo/audit-engine-rules.test.ts                               | A      | 引擎规则回归                 |
| src/lib/seo/audit-dashboard.test.ts                                  | A      | 快照聚合回归                 |
| src/lib/seo/page-type.test.ts                                        | A      | 页面类型回归                 |
| src/lib/seo/structured-data.test.ts                                  | A      | JSON-LD 回归             |
| src/lib/seo/site-reports.test.ts                                     | A      | 报告聚合回归                 |
| src/app/(default)/(dashboard)/app/audit/phase-2.3-regression.test.ts | A      | P0/P1 修复契约测试           |

## Excluded（不属于 Site Audit V2 — 不进入本次 commit）

| File/Dir                             | Status | Reason                            |
| ------------------------------------ | ------ | --------------------------------- |
| src/components/Footer.tsx            | M      | +1 行 contact 链接（contact 页业务）      |
| src/i18n/locale-routed-paths.ts      | M      | +1 行 "/contact" 路由白名单（contact 业务） |
| src/app/(default)/contact/page.tsx   | A      | contact 营销页                       |
| src/app/\[locale]/contact/page.tsx   | A      | contact locale 路由                 |
| src/app/manifest.ts                  | A      | PWA manifest（独立业务）                |
| public/brand/                        | A      | 品牌 logo 资产（SEO/品牌业务）              |
| scripts/capture-demo-screenshots.mjs | A      | 目录提交截图脚本（seo-growth 业务）           |
| scripts/seed-demo-screenshots.mjs    | A      | 同上                                |
| scripts/verify-demo-screenshots.mjs  | A      | 同上                                |
| seo-growth/                          | A      | 目录提交/外链运营资料（含截图，与 Audit 无关）       |

## 临时/环境文件（绝不提交）

| Path                               | Note                                                         |
| ---------------------------------- | ------------------------------------------------------------ |
| supabase/.temp/cli-latest          | Supabase CLI 本地状态                                            |
| supabase/.temp/linked-project.json | 仅含项目 ref/org id（非凭据），但属本地环境文件，**且未被 .gitignore 覆盖**（见 Risks） |
| .env\* / data/\*.db / .next/       | 已被 .gitignore 覆盖，不会进入                                        |

## Deleted files

None（git diff --name-status 无 D；历史 Audit 数据未删除）

## Dependency changes

None（package.json / package-lock.json 无 diff）

## Database migrations

- audits 表新增：engine\_version TEXT、rule\_set\_version TEXT、dashboard\_json TEXT（[migrations.ts](../../src/lib/db/migrations.ts)，try/catch ALTER 兼容已有库；comparison 字段沿用已有 TEXT 列，无表结构删除）

## Mixed-diff files

None。messages/en.json 与 zh.json 经 hunk 级审查均为单一 hunk、全部位于 dashboard.audit 命名空间；Footer.tsx 与 locale-routed-paths.ts 为纯 contact 业务修改（排除即可，无需拆分 hunks）；AuditReport.tsx 为纯 Audit V2 类型跟随修改。

## Security scan

- git diff 全量 + 全部候选新文件：0 API key / 0 Bearer token / 0 JWT / 0 private key / 0 password / 0 Supabase service key。

- .env\*、data/\*.db、.next 均被 .gitignore 覆盖。

## Test evidence（审查时点复验）

- npx tsc --noEmit → 0 errors

- npm run lint → 0 problems

- npm test → 70 files / 905 tests passed

- npm run build → Compiled successfully, 54/54 static pages

## Risks

1. supabase/.temp/ 未被 .gitignore 覆盖 — 若未来 `git add .` 会误提交本地 CLI 状态。建议后续将 `/supabase/.temp/` 加入 .gitignore（本阶段未改，仅报告）。
2. Excluded 文件与 Included 文件同在工作区 — commit 时必须使用逐文件 add，禁止 `git add .` / `git add -A`。
3. seo-growth/ 内截图含产品界面（无凭据），不影响安全，但属无关业务。


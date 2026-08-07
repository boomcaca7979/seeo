# SeeO SEO基础建设与审计系统修复交接报告

## 1. 本次任务背景

### 为什么需要这次修改

SeeO 作为 SEO 数据分析平台，自身却存在严重的 SEO 基础缺陷：缺失 Open Graph 标签、Twitter Card、canonical、robots.txt、sitemap.xml 等搜索引擎抓取所需的基础元素。同时，审计系统存在两个影响可信度的 Bug：响应时间图无真实数据（写死空数组）、首页超时导致整页检查项漏检并输出虚假健康分。

### 原存在的问题

1. **官网 SEO 基础缺失**：layout.tsx metadata 仅有 title + description，无 openGraph / twitter / robots / metadataBase / canonical；无 robots.txt 和 sitemap.xml；各公开页面无独立 canonical
2. **审计器 Bug 1**：响应时间分布图数据源写死为 `[]`，API 未暴露页面级响应时间数据
3. **审计器 Bug 2**：首页抓取超时后 BFS 中断、单页检查项全部跳过，但仍输出虚高健康分（如 97/100）
4. **前端警告**：AuditPage 问题清单 map 内 Fragment 缺 key prop；Sidebar 残留无用的 `v1.0` 标签

### 修复目标

- 补全 SeeO 官网 SEO 基础标签（og / twitter / canonical / robots meta / robots.txt / sitemap.xml）
- 审计器持久化页面级响应时间数据，前端图表接真实数据
- 首页超时自动重试 + sitemap 降级 + 不可用标记，杜绝虚假健康分
- 清理前端 console 警告

---

## 2. 本次完成内容总览

| 模块 | 修改内容 | 状态 |
|---|---|---|
| A. layout.tsx metadata 完善 | 补全 metadataBase / openGraph / twitter / robots / canonical | ✅ 完成 |
| B. robots.txt | 新增 src/app/robots.ts，Allow / + Disallow /app /api + Sitemap 声明 | ✅ 完成 |
| C. sitemap.xml | 新增 src/app/sitemap.ts，列出 8 个公开页面 | ✅ 完成 |
| D. 页面 canonical 修复 | 7 个公开页面（pricing/docs/login/signup/privacy/terms/refund）新增独立 metadata + canonical | ✅ 完成 |
| E. OG 图片 | 新增 public/og.jpg（1200×630 品牌分享图） | ✅ 完成 |
| F. 审计 Bug 1：响应时间图 | audits 表加 pages_detail 列 + runAudit 采集 + API 暴露 + 前端接真实数据 | ✅ 完成 |
| G. 审计 Bug 2：首页超时误判 | 首页超时重试 + sitemap 降级 + 不可用标记 | ✅ 完成 |
| H. 代理环境支持 | 新增 instrumentation.ts 配置 undici ProxyAgent | ✅ 完成 |
| I. 前端警告修复 | AuditPage Fragment key + Sidebar v1.0 删除 | ✅ 完成 |

### A. SeeO 官网 SEO 基础建设

**layout.tsx metadata 完善**：

- `metadataBase`: `new URL("https://seeo-five.vercel.app")` — 使 Next.js 能生成绝对 URL 的 canonical / og:url
- `openGraph`: type=website, locale=zh_CN, url, siteName=SeeO, title, description, images（/og.jpg 1200×630）
- `twitter`: card=summary_large_image, title, description, images
- `robots`: index=true, follow=true, googleBot（index/follow/max-image-preview=large/max-snippet=-1/max-video-preview=-1）
- `alternates.canonical`: `/`（根 layout 默认，子页面各自覆盖）

### B. robots.txt

- 新增 `src/app/robots.ts`
- Allow: `/`
- Disallow: `/app`（应用工作台，不应被索引）, `/api`（API 路由）
- Sitemap: `https://seeo-five.vercel.app/sitemap.xml`
- Host: `https://seeo-five.vercel.app`

### C. sitemap.xml

- 新增 `src/app/sitemap.ts`
- 包含 8 个公开页面：`/`、`/pricing`、`/docs`、`/login`、`/signup`、`/privacy`、`/terms`、`/refund`
- 首页 priority=1.0 changeFrequency=weekly，其余 priority=0.7 changeFrequency=monthly
- 构建成功：`npm run build` 输出确认 `/sitemap.xml` 和 `/robots.txt` 路由已注册

### D. 页面 canonical 修复

以下页面新增独立 metadata（title + description + alternates.canonical）：

| 页面 | canonical |
|---|---|
| /pricing | /pricing |
| /docs | /docs |
| /login | /login |
| /signup | /signup |
| /privacy | /privacy |
| /terms | /terms |
| /refund | /refund |

canonical 输出规则：每个页面的 metadata.alternates.canonical 设为相对路径，Next.js 结合 metadataBase 自动生成绝对 URL（如 `https://seeo-five.vercel.app/pricing`）。

### E. OG 图片

- 新增 `public/og.jpg`
- 尺寸：1200×630（landscape_4_3 生成，符合社交分享卡标准）
- 用途：Open Graph image 和 Twitter Card image，在社交平台分享时展示 SeeO 品牌图
- 设计：极简白底 + 黑色 SeeO wordmark + 金色装饰线 + 灰色 tagline

---

## 3. 审计系统 Bug 修复详情

### Bug 1：响应时间图无真实数据

**问题原因**：

审计页面 `responseTimeData` 写死为空数组 `[]`。API `/api/audit/latest` 未返回页面级响应时间数据。数据库 `audits` 表无字段存储单页响应时间。`runAudit` 流程中虽通过 `fetchPage` 获取了 `responseTimeMs`，但未持久化。

**修复**：

1. **数据库**：`audits` 表新增 `pages_detail TEXT` 列（JSON 格式存储 `[{url, responseTimeMs, status, ok}]`），通过 `ALTER TABLE` 幂等添加
2. **AuditRow 接口**：增加 `pages_detail: string | null` 字段
3. **rowToAudit**：解析 pages_detail 字段
4. **finishAudit 函数**：新增 `pages_detail` 参数，通过 `COALESCE(?, pages_detail)` 写入
5. **runAudit 流程**：在 BFS 循环中为每个页面采集 `{url, responseTimeMs, status, ok}` 并推入 `pagesDetail` 数组，审计结束时 JSON.stringify 持久化

**API**：

`/api/audit/latest` 响应新增 `pagesDetail` 字段：

```json
{
  "data": {
    "pagesDetail": [
      { "url": "https://seeo-five.vercel.app/", "responseTimeMs": 170, "status": 200, "ok": true },
      ...
    ]
  }
}
```

**前端**：

审计页面 `responseTimeData` 改为从 `audit.pagesDetail` 按桶聚合（useMemo）：

| 桶 | 条件 | 颜色 |
|---|---|---|
| <1s | responseTimeMs < 1000 | #22C55E（绿） |
| 1-3s | 1000 ≤ responseTimeMs < 3000 | #F59E0B（黄） |
| 3-10s | responseTimeMs ≥ 3000 | #EF4444（红） |
| 超时 | ok=false | #6B7280（灰） |

ResponseTimeBars 组件颜色数组从 3 色扩展到 4 色。

### Bug 2：首页 timeout 误判

**之前问题**：

- 首页抓取超时（10s，Vercel 冷启动常见）后 `fetchPage` 抛出 `CrawlError(TIMEOUT)`
- `parsePage` 未执行，页面数据未入 `pages` 数组
- 所有单页检查项（og/twitter/canonical/robots meta/结构化数据等）全部跳过
- BFS 无法继续扩散，只爬到 1 页
- 跨页检查项 `no-sitemap` 正常执行（不依赖 parsed page data）
- 最终仍输出虚高健康分（如 97/100），用户误以为站点健康

**现在逻辑**：

1. **首页首次抓取失败**（TIMEOUT）：检测到 `isFirstBatch && !homepageTimeoutRetried`
2. **timeout 自动 retry**：以 12s 窗口重新抓取首页（第二次通常命中 Vercel 热实例）
3. **retry 仍失败**：记录 slow-page warning（标注"重试 12s 仍失败"）
4. **sitemap fallback**：从 robots.txt 解析 sitemap URL → 抓取 sitemap.xml → 解析 `<loc>` 标签 → 同域名 URL 入队 BFS（仅 full 模式）
5. **仍无法解析首页**：
   - 添加 error 级 issue "起始页未能解析，单页检查项未执行，本次审计结果不可用"
   - `healthScore` 设为 0
   - `status` 设为 "completed"（但健康分=0 + error issue 明确标注不可用）
   - 不输出虚假健康分

**新增函数**：

- `extractSitemapUrls(robotsText, origin)`：从 robots.txt 解析 Sitemap 声明，回退到 `/sitemap.xml`
- `fetchSitemapUrls(origin, robotsText)`：抓取 sitemap.xml 并解析同域名 URL
- `fetchPage(url, timeoutMs)`：新增可选超时参数（首页重试用 12s）

---

## 4. 新增文件清单

| 文件路径 | 作用 |
|---|---|
| `src/app/robots.ts` | Next.js Metadata Route，生成 /robots.txt，声明 Allow/Disallow 规则和 Sitemap |
| `src/app/sitemap.ts` | Next.js Metadata Route，生成 /sitemap.xml，列出 8 个公开页面 |
| `src/instrumentation.ts` | Next.js Instrumentation hook，服务端启动时读 HTTP_PROXY/HTTPS_PROXY 配置 undici ProxyAgent（解决本地开发代理环境下 fetch 不可用） |
| `public/og.jpg` | 1200×630 品牌分享图，用于 Open Graph 和 Twitter Card |

---

## 5. 修改文件清单

### SEO 基础建设相关

| 文件 | 修改原因 | 修改内容 |
|---|---|---|
| `src/app/layout.tsx` | 补全根 metadata | 新增 metadataBase / openGraph / twitter / robots / alternates.canonical |
| `src/app/pricing/page.tsx` | 页面独立 canonical | 新增 metadata（title/description/alternates.canonical） |
| `src/app/docs/page.tsx` | 同上 | 同上 |
| `src/app/login/page.tsx` | 同上 | 同上 |
| `src/app/signup/page.tsx` | 同上 | 同上 |
| `src/app/privacy/page.tsx` | 同上 | 同上 |
| `src/app/terms/page.tsx` | 同上 | 同上 |
| `src/app/refund/page.tsx` | 同上 | 同上 |

### 审计系统 Bug 修复相关

| 文件 | 修改原因 | 修改内容 |
|---|---|---|
| `src/lib/db/index.ts` | Bug 1：持久化响应时间数据 | audits 表加 pages_detail 列（ALTER TABLE 幂等）；AuditRow 接口加 pages_detail；rowToAudit 解析；finishAudit 支持 pages_detail 参数 |
| `src/lib/audit.ts` | Bug 1 + Bug 2 | 采集 pagesDetail 并持久化；首页超时重试（12s）；sitemap 降级入队；首页不可解析时标记 healthScore=0 + error issue；新增 fetchSitemapUrls/extractSitemapUrls 函数；AuditResult 接口加 pagesDetail/homepageParsed |
| `src/lib/crawl/index.ts` | Bug 2：支持首页重试 | fetchPage 新增可选 timeoutMs 参数 |
| `src/app/api/audit/latest/route.ts` | Bug 1：API 暴露响应时间数据 | 响应新增 pagesDetail 字段（从 audit.pages_detail JSON.parse） |
| `src/app/(dashboard)/app/audit/page.tsx` | Bug 1：前端接真实数据 + key 警告修复 | AuditData 接口加 pagesDetail；responseTimeData 改为 useMemo 从 pagesDetail 按桶聚合；Fragment key 修复（<>改为<Fragment key={rowKey}>） |
| `src/components/dashboard/charts/ResponseTimeBars.tsx` | Bug 1：4 桶颜色 | 颜色数组从 3 色扩展到 4 色（加灰色对应超时桶） |

### 其他修复

| 文件 | 修改原因 | 修改内容 |
|---|---|---|
| `src/components/dashboard/Sidebar.tsx` | 清理无用标签 + v1.0 删除 | 移除 `{!collapsed && <span>v1.0</span>}` 块 |

---

## 6. 数据库变化

### Schema 变化

**新增字段**：

```sql
ALTER TABLE audits ADD COLUMN pages_detail TEXT;
```

- 存储 JSON：`[{url, responseTimeMs, status, ok}]`
- 可为 NULL（旧审计记录无此数据，前端兼容空数组）

### 迁移方式

- 在 `migrate()` 函数中通过 `ALTER TABLE ... ADD COLUMN` 添加
- 包裹在 `try/catch` 中，字段已存在时静默忽略
- **幂等**：多次执行不会报错，不会覆盖已有数据
- 适用于 SQLite（本地开发）和 Turso（生产）两种 adapter

---

## 7. 测试验证结果

### TypeScript

```
npx tsc --noEmit
```

**结果：通过**（exit code 0，无类型错误）

### ESLint

```
npm run lint
```

**结果：通过**（0 errors，1 warning：instrumentation.ts 中 unused eslint-disable directive，不影响功能）

### Build

```
npm run build
```

**结果：通过**（exit code 0）

构建输出确认：
- `/robots.txt` 路由已注册
- `/sitemap.xml` 路由已注册
- 所有页面静态生成成功

### 深度审计测试

**目标**：`seeo-five.vercel.app`

**深度审计（full）结果**：
- 爬取页面数：8 页
- 健康分：58/100
- 错误：2 条（重复标题、重复描述——生产站子页尚无独立 metadata）
- 警告：25 条（canonical 缺失、标题/描述长度、重复 H1 等）
- 提示：36 条（og/twitter/robots meta/结构化数据/sitemap 缺失等）
- **og/twitter/canonical 检查项全部真实执行**（生产站未部署新代码所以报缺失，本地 dev server 已修复）
- **响应时间数据**：8 页响应时间 170ms-968ms，全部 <1s 桶

**快速审计（quick）结果**（补足历史趋势第二个点）：
- 爬取页面数：1 页
- 健康分：81/100
- 错误：0，警告：3，提示：4

**历史趋势图**：2 个数据点（58 → 81），正常渲染

**响应时间分布图**：真实数据渲染，8 页全部落在 <1s 桶

### SEO Head 验证

本地 dev server `http://localhost:3000/` HTML head 检查：

| 标签 | 状态 |
|---|---|
| og:title | ✅ `SeeO · 看清搜索流量的走向` |
| og:description | ✅ |
| og:url | ✅ `https://seeo-five.vercel.app/` |
| og:site_name | ✅ `SeeO` |
| og:locale | ✅ `zh_CN` |
| og:image | ✅ `/og.jpg`（1200×630） |
| og:type | ✅ `website` |
| twitter:card | ✅ `summary_large_image` |
| twitter:title | ✅ |
| twitter:description | ✅ |
| twitter:image | ✅ `/og.jpg` |
| canonical | ✅ `https://seeo-five.vercel.app/` |
| robots meta | ✅ `index, follow` |
| googlebot | ✅ `index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` |

子页面 canonical 验证：
- `/pricing` → `https://seeo-five.vercel.app/pricing` ✅
- `/login` → `https://seeo-five.vercel.app/login` ✅
- `/docs` → `https://seeo-five.vercel.app/docs` ✅

### robots.txt 验证

```
User-Agent: *
Allow: /
Disallow: /app
Disallow: /api
Sitemap: https://seeo-five.vercel.app/sitemap.xml
Host: https://seeo-five.vercel.app
```

✅ 正常输出

### sitemap.xml 验证

```xml
<urlset>
  <url><loc>https://seeo-five.vercel.app/</loc><priority>1.0</priority></url>
  <url><loc>https://seeo-five.vercel.app/pricing</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/docs</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/login</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/signup</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/privacy</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/terms</loc><priority>0.7</priority></url>
  <url><loc>https://seeo-five.vercel.app/refund</loc><priority>0.7</priority></url>
</urlset>
```

✅ 正常输出，8 个公开页面

---

## 8. 当前项目状态

### SeeO 已具备

- **项目管理**：创建/删除项目、域名管理、项目切换
- **SEO 技术审计**：BFS 爬取（50 页上限）、25 项检查、健康分计算、历史趋势、问题对比、报告导出（PDF/Excel）
- **页面级性能分析**：响应时间分布图（真实数据，4 桶分类）
- **历史报告**：审计历史记录、分数趋势、新增/已修复/未变化问题对比
- **排名追踪**：关键词追踪、排名历史、分组管理、每日刷新
- **竞品基础功能**：竞品添加、排名对比、SOV 分析
- **关键词工具**：关键词概览、拓词建议、实时查排名
- **内容优化**：内容评分、SEO 检查清单、主题词云、SERP Top 10 对比
- **外链分析**：DataForSEO 外链数据集成
- **报告中心**：审计/排名/内容报告存储与导出
- **用户系统**：Supabase Auth 注册/登录、多用户数据隔离
- **自动化**：每日刷新、每周报告（cron 设置）
- **SEO 基础**：og/twitter/canonical/robots meta/robots.txt/sitemap.xml

### 当前未完成

- **DataForSEO 外链深度能力**：已有基础外链数据拉取，但缺乏外链监控、丢失告警、历史趋势等深度功能
- **商业化订阅**：无 Stripe 支付集成，订阅计划仅 UI 展示
- **团队协作**：设置页 Team 区域仅占位描述
- **结构化数据**：SeeO 自身页面未添加 JSON-LD 结构化数据（审计器会报 notice）
- **子页面独立 metadata**：生产站子页面（/app 下）尚未有独立 title/description（dashboard 页面统一继承根 layout）

---

## 9. 后续建议

1. **结构化数据**：为 SeeO 官网添加 JSON-LD 结构化数据（Organization / WebSite / SoftwareApplication），消除审计器的 `no-structured-data` notice
2. **子页面 title 优化**：dashboard 各页面（/app/audit、/app/position-tracking 等）添加独立 title，避免 `duplicate-title` 警告
3. **描述长度优化**：当前首页 description 66 字符，建议扩展到 120-160 字符区间
4. **外链监控**：扩展 DataForSEO 集成，增加外链丢失告警、历史趋势图
5. **Stripe 集成**：实现订阅支付流程，打通商业化闭环
6. **团队协作**：实现团队成员邀请、权限管理
7. **审计器增强**：考虑添加结构化数据检查项的具体类型识别（Organization / Article / FAQ 等）
8. **响应时间 API**：考虑在 `/api/audit/latest` 中直接返回分桶后的数据，减少前端计算

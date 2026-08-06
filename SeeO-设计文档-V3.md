# SeeO 设计文档 V3 · 墨黄终端

> V2 保留作为历史存档。本文件自生效日起是所有阶段的唯一视觉标准。
> 适用范围：`src/app/(dashboard)` 路由组下的全部页面 + 全局 `globals.css` + dashboard 共用组件。
> 不适用：营销首页 `/`、`/login`、`/signup`（保持 V2 黄色画布品牌面）。

---

## 1. 色板（Tailwind v4 @theme token）

```css
/* 内容区画布 / 卡片 */
--color-paper:      #F6F4EC;  /* 内容区画布主底色 */
--color-card:       #FFFEFA;  /* 卡片底色 */

/* 墨色：主文字 / 侧边栏 */
--color-ink:        #14121A;  /* 侧边栏底、主文字 */
--color-ink-60:     rgba(20,18,26,.62);  /* 次级文字 */
--color-ink-40:     rgba(20,18,26,.42);  /* 元信息 */
--color-ink-25:     rgba(20,18,26,.25);  /* 弱提示 / hover 边框 */

/* 发丝线 */
--color-line:       #E4E1D2;  /* 卡片边框 */
--color-line-soft:  #ECE9DD;  /* 内部分割线 / 表格行线 */

/* 品牌黄 */
--color-brand:      #FFD400;
--color-brand-deep: #F5C400;  /* hover */

/* 语义色 */
--color-pos:  #1E9E6A;  /* 正向：排名上升、好消息 */
--color-neg:  #E14B4B;  /* 负向：错误、下降 */
--color-warn: #C98A0A;  /* 警告：橙 */

/* 字体（沿用 V2） */
--font-display: var(--font-space-grotesk), "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-sans:    var(--font-inter), "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono:    var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, monospace;
```

---

## 2. 铁律

1. **纸面浅色**：仪表盘一律 `--color-paper` 底，禁止大面积深色卡片、禁止阴影（`box-shadow: none`）。
2. **零动效**：禁止任何 transition 动画（含 `transition-colors`、`animate-*`）。hover 瞬时变色属例外，时长 ≤150ms。
3. **文字三级阶梯**：只用 `ink` / `ink-60` / `ink-40` / `ink-25` 四档透明度，禁止 `#6B7280` 等外来灰。
4. **字体分工**：
   - 所有数字 → JetBrains Mono
   - 英文标题 → Space Grotesk
   - 中文正文 → PingFang SC / 系统栈
5. **黄色点睛**：黄色（`--color-brand`）只用于主按钮、激活导航、预警圆点、「实时」标签。出现面积 ≤5%。
6. **健康分着色**：
   - ≥80 → `--color-pos`（绿）
   - 60–79 → `--color-warn`（橙）
   - <60 → `--color-neg`（红）
7. **卡片规范**：`--color-card` 底 + `1px solid --color-line` 边框 + `12px` 圆角；hover 仅边框加深到 `--color-ink-25`，无阴影无位移。
8. **区块标题模式**：`mono 编号 + 标题 + 发丝横线 + 计数`，如：
   ```
   01 我的项目 —————————————— 共 3 个
   ```
9. **表格规范**：白色容器 + 发丝行分割线（`--color-line-soft`），表头 mono 小字，行 hover `#FBFAF4`。
10. **徽章规范**：描边 mono 小字，颜色按语义：
    - 警告 = 橙（`--color-warn`）
    - 错误 = 红（`--color-neg`）
    - 好消息 = 绿（`--color-pos`）
    - 提示 = 灰（`--color-ink-40`）
11. **图表规范（recharts）**：
    - 网格线 `--color-line-soft`
    - 刻度文字 `--color-ink-40`
    - tooltip 白底 + 1px `--color-line` 边框
    - 排名趋势图保持 Y 轴反转（排名数字越小越靠上）

---

## 3. 工具类（globals.css 全局可用）

| 类名 | 用途 | 关键样式 |
|---|---|---|
| `.card-a` | 标准卡片 | `bg-card` + `border border-line` + `rounded-xl`（12px） |
| `.hairline` | 发丝分割线 | `h-px bg-line-soft` |
| `.micro-label` | mono 微型标签 | `font-mono text-[10px] tracking-[.1em] uppercase text-ink-40` |
| `.badge-warn` | 警告徽章 | 描边 + mono 小字，色 `--color-warn` |
| `.badge-err` | 错误徽章 | 描边 + mono 小字，色 `--color-neg` |
| `.badge-good` | 好消息徽章 | 描边 + mono 小字，色 `--color-pos` |
| `.badge-info` | 提示徽章 | 描边 + mono 小字，色 `--color-ink-40` |
| `.btn-primary` | 主按钮（黄） | `bg-brand text-ink` + 6px 圆角 + 700 字重，hover `bg-brand-deep` |
| `.btn-secondary` | 次按钮（描边） | `bg-card border border-line` + 8px 圆角 |

---

## 4. 组件视觉规范

### 4.1 侧边栏（Sidebar）

- 底色 `--color-ink`（#14121A）
- 导航项编号式：`01 工作台 / 02 关键词研究 / 03 排名追踪 / 04 外链分析 / 05 技术审计 / 06 竞品分析 / 07 内容优化 / 08 报表 / 09 设置`
- 编号：mono 10px，`rgba(255,255,255,.4)`
- 激活项：黄色文字 + 左侧 2px 黄条 + `rgba(255,212,0,.06)` 底
- 「外链分析」的 soon 标签：mono 描边小字
- 顶部 logo：See**O**，O 保持黄色
- 底部：发丝分区线 + 黄色方形头像 + 用户名 / 邮箱（mono 小字）

### 4.2 顶栏（Topbar）

- 底色 `--color-paper` + 底部 1px `--color-line` 发丝线
- 项目切换器：描边 chip（黄色字母方块 + 域名 + ▾）
- 搜索框：白底描边 + 右侧 `⌘K` kbd 样式
- 铃铛未读点：黄色
- 头像：墨底黄字圆形

### 4.3 工作台（/app）

1. **eyebrow 行**：mono 小字，左「2026年X月X日 · 星期X」（动态日期），右「数据更新时间 · 演示模式」
2. **主标题**：`你好，{用户名}` Space Grotesk 32px/700；副标题 `ink-60`；右侧主按钮「＋ 新建项目」用 `.btn-primary`
3. **01 我的项目**：区块头 + 计数
   - 项目卡片：域名 Space Grotesk 16.5px + mono 小字 URL
   - 右上健康分：mono 24px + mono 微型标签
   - 分数下方 3px 细条按分数着色（绿/橙/红）
   - 发丝线分隔
   - 指标行：「追踪关键词 / 近 7 天排名（▲绿 ▼红）」
   - 底部 mono 元信息行（最近审计 · 预警数）+ 右箭头
4. **02 预警提醒**：区块头 + 黄色「实时」标签
   - 预警列表：白容器 + 发丝行线
   - 行 = 级别圆点（绿/橙/红/灰）+ 标题 + mono 元信息 + 右侧描边徽章
5. 空状态、Modal、Toast、确认弹窗同步换浅色版

---

## 5. 过渡期约定

- 第一轮只覆盖：`globals.css` + `Sidebar` + `Topbar` + `Modal` + `Toast` + `Skeleton` + 工作台页面
- 其余 9 个内页（关键词研究、排名追踪、外链、审计、竞品、内容、报表、设置、项目详情）暂保留深色内容容器，但必须保证：
  - 顶栏与侧边栏已是新样式
  - 深色内页容器内的浅色文字不会压在纸面顶栏上（顶栏本身已是浅色，无冲突）
  - 不出现「浅色文字压在浅色纸面」的隐形文字
- 第二轮将逐页铺开新样式

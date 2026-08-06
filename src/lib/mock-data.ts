// ===== SeeO 仪表盘 mock 数据 =====
// 字段命名参考 PRD 第 4 章

// ----- 类型定义 -----
export type Trend = "up" | "down" | "flat";

export type SearchIntent =
  | "信息型"
  | "导航型"
  | "交易型"
  | "商业调查型";

export interface Project {
  id: string;
  domain: string;
  favicon: string; // 首字母占位
  healthScore: number;
  trackedKeywords: number;
  rankUp: number;
  rankDown: number;
  lastAudit: string; // 人类可读时间
  organicTraffic: string;
  backlinks: string;
  trend: { day: string; value: number }[];
}

export interface Alert {
  id: string;
  level: "error" | "warning" | "info";
  project: string;
  message: string;
  time: string;
}

export interface RankRow {
  keyword: string;
  rank: number;
  change: number; // 正为上升，负为下降
  searchVolume: string;
  kd: number;
  intent: SearchIntent;
}

export interface KeywordOverview {
  keyword: string;
  searchVolume: string;
  kd: number;
  cpc: string;
  intent: SearchIntent;
  trend: { month: string; value: number }[];
  serpFeatures: string[];
}

export interface RelatedKeyword {
  keyword: string;
  volume: string;
  kd: number;
  cpc: string;
  intent: SearchIntent;
}

export interface AuditIssue {
  type: string;
  severity: "error" | "warning" | "notice";
  affectedPages: number;
  suggestion: string;
}

export interface ProjectMetric {
  label: string;
  value: string;
  trend: Trend;
  trendValue: string;
  sparkline: { d: string; v: number }[];
}

// ----- mock 数据 -----
export const projects: Project[] = [
  {
    id: "p1",
    domain: "example.com",
    favicon: "E",
    healthScore: 87,
    trackedKeywords: 1284,
    rankUp: 142,
    rankDown: 38,
    lastAudit: "2 小时前",
    organicTraffic: "14.2 万",
    backlinks: "1,927",
    trend: Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      value: 60 + Math.round(Math.sin(i / 2) * 12) + i,
    })),
  },
  {
    id: "p2",
    domain: "shop-demo.cn",
    favicon: "S",
    healthScore: 72,
    trackedKeywords: 846,
    rankUp: 89,
    rankDown: 67,
    lastAudit: "昨天 18:24",
    organicTraffic: "6.8 万",
    backlinks: "934",
    trend: Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      value: 40 + Math.round(Math.cos(i / 3) * 10) + i,
    })),
  },
  {
    id: "p3",
    domain: "blog-test.com",
    favicon: "B",
    healthScore: 64,
    trackedKeywords: 312,
    rankUp: 54,
    rankDown: 41,
    lastAudit: "3 天前",
    organicTraffic: "2.1 万",
    backlinks: "412",
    trend: Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      value: 25 + Math.round(Math.sin(i / 2 + 1) * 8) + Math.round(i / 2),
    })),
  },
];

export const alerts: Alert[] = [
  {
    id: "a1",
    level: "warning",
    project: "example.com",
    message: "关键词「SEO工具」排名下降 12 位",
    time: "8 分钟前",
  },
  {
    id: "a2",
    level: "error",
    project: "example.com",
    message: "检测到 3 个新增 404 页面",
    time: "32 分钟前",
  },
  {
    id: "a3",
    level: "info",
    project: "shop-demo.cn",
    message: "本周新增外链 28 条",
    time: "1 小时前",
  },
  {
    id: "a4",
    level: "warning",
    project: "blog-test.com",
    message: "首页 LCP 4.2s，超出推荐阈值",
    time: "今天 09:12",
  },
];

export const rankRows: RankRow[] = [
  { keyword: "seo 工具", rank: 3, change: 11, searchVolume: "18.2K", kd: 73, intent: "商业调查型" },
  { keyword: "关键词挖掘", rank: 5, change: 4, searchVolume: "12.4K", kd: 54, intent: "信息型" },
  { keyword: "排名追踪", rank: 7, change: -2, searchVolume: "8.7K", kd: 41, intent: "信息型" },
  { keyword: "外链分析", rank: 12, change: 6, searchVolume: "5.3K", kd: 38, intent: "信息型" },
  { keyword: "网站审计工具", rank: 18, change: -5, searchVolume: "9.1K", kd: 67, intent: "商业调查型" },
  { keyword: "竞品分析", rank: 22, change: 3, searchVolume: "31.2K", kd: 49, intent: "信息型" },
  { keyword: "内容优化", rank: 28, change: 0, searchVolume: "19.8K", kd: 35, intent: "信息型" },
  { keyword: "搜索意图", rank: 34, change: 8, searchVolume: "4.6K", kd: 22, intent: "信息型" },
];

export const keywordOverview: KeywordOverview = {
  keyword: "seo 工具",
  searchVolume: "18.2K",
  kd: 73,
  cpc: "¥6.40",
  intent: "商业调查型",
  trend: [
    { month: "1月", value: 14200 },
    { month: "2月", value: 13800 },
    { month: "3月", value: 15100 },
    { month: "4月", value: 16900 },
    { month: "5月", value: 17400 },
    { month: "6月", value: 16800 },
    { month: "7月", value: 18200 },
    { month: "8月", value: 17800 },
    { month: "9月", value: 18500 },
    { month: "10月", value: 19100 },
    { month: "11月", value: 17900 },
    { month: "12月", value: 18200 },
  ],
  serpFeatures: ["精选摘要", "People Also Ask", "视频轮播", "知识面板"],
};

export const relatedKeywords: {
  phrase: RelatedKeyword[];
  related: RelatedKeyword[];
  question: RelatedKeyword[];
} = {
  phrase: [
    { keyword: "最好的 seo 工具", volume: "4.2K", kd: 68, cpc: "¥7.20", intent: "商业调查型" },
    { keyword: "免费 seo 工具", volume: "9.8K", kd: 52, cpc: "¥3.10", intent: "信息型" },
    { keyword: "seo 工具对比", volume: "2.1K", kd: 45, cpc: "¥5.40", intent: "商业调查型" },
    { keyword: "中文 seo 工具", volume: "3.4K", kd: 49, cpc: "¥4.80", intent: "信息型" },
  ],
  related: [
    { keyword: "关键词研究工具", volume: "11.2K", kd: 58, cpc: "¥6.10", intent: "信息型" },
    { keyword: "网站分析工具", volume: "14.6K", kd: 62, cpc: "¥5.80", intent: "信息型" },
    { keyword: "搜索引擎优化", volume: "27.8K", kd: 71, cpc: "¥7.50", intent: "信息型" },
    { keyword: "网站流量分析", volume: "8.9K", kd: 47, cpc: "¥4.20", intent: "信息型" },
  ],
  question: [
    { keyword: "怎么选 seo 工具", volume: "2.8K", kd: 33, cpc: "¥3.40", intent: "信息型" },
    { keyword: "seo 工具有用吗", volume: "1.9K", kd: 28, cpc: "¥2.80", intent: "信息型" },
    { keyword: "为什么用 seo 工具", volume: "1.2K", kd: 25, cpc: "¥3.10", intent: "信息型" },
    { keyword: "哪个 seo 工具好", volume: "3.6K", kd: 41, cpc: "¥4.50", intent: "商业调查型" },
  ],
};

export const auditIssues: AuditIssue[] = [
  { type: "404 错误页面", severity: "error", affectedPages: 3, suggestion: "添加 301 重定向到相关页面，或恢复缺失内容" },
  { type: "重复的 title 标签", severity: "warning", affectedPages: 12, suggestion: "为每个页面编写唯一的 title" },
  { type: "缺失图片 Alt 文本", severity: "warning", affectedPages: 28, suggestion: "为装饰性图片添加空 alt，信息性图片添加描述" },
  { type: "重定向链过长", severity: "warning", affectedPages: 7, suggestion: "将多级重定向改为直接指向最终目标" },
  { type: "页面加载速度慢", severity: "warning", affectedPages: 4, suggestion: "压缩图片、启用缓存、减少 JS 阻塞" },
  { type: "缺少 H1 标题", severity: "notice", affectedPages: 9, suggestion: "每个页面保留一个唯一的 H1" },
  { type: "meta description 过短", severity: "notice", affectedPages: 18, suggestion: "建议 70-160 字符之间" },
  { type: "结构化数据错误", severity: "notice", affectedPages: 6, suggestion: "修复 schema.org 标记语法" },
];

export const auditSummary = {
  healthScore: 87,
  errors: 3,
  warnings: 51,
  notices: 33,
  crawledPages: 4821,
  lastCrawl: "2 小时前",
};

// 通用：生成极光渐变 URL（用于 SVG / recharts defs 引用名）
export const auroraGradientId = "seeo-aurora";

// ===== 排名追踪（PRD 4.2）=====

export type SerpFeature = "精选摘要" | "PAA" | "视频轮播" | "知识面板" | "图片包" | "本地包";

export interface RankTrackingRow {
  keyword: string;
  rank: number;
  change1d: number; // 正为上升，负为下降
  change7d: number;
  change30d: number;
  searchVolume: string;
  kd: number;
  serpFeatures: SerpFeature[];
  bestRank: number;
  worstRank: number;
  trend: { day: string; rank: number }[]; // 30 天
}

export interface RankCompetitorRow {
  domain: string;
  favicon: string;
  rank: number;
  change: number;
  isSelf?: boolean;
}

export interface RankTrackingSummary {
  total: number;
  top3: number;
  top10: number;
  top100: number;
  up7d: number;
  down7d: number;
}

export const rankTrackingSummary: RankTrackingSummary = {
  total: 1284,
  top3: 142,
  top10: 486,
  top100: 1124,
  up7d: 187,
  down7d: 64,
};

const serpPool: SerpFeature[][] = [
  ["精选摘要", "PAA"],
  ["PAA", "视频轮播"],
  ["知识面板"],
  ["图片包", "PAA"],
  ["精选摘要", "知识面板"],
  ["PAA"],
  ["视频轮播"],
  [],
];

function genRankTrend(end: number, volatility: number): { day: string; rank: number }[] {
  const arr: { day: string; rank: number }[] = [];
  let cur = end + Math.round(volatility * 2);
  for (let i = 0; i < 30; i++) {
    const noise = Math.round((Math.sin(i / 2) + Math.cos(i / 3)) * volatility);
    const v = Math.max(1, Math.min(100, cur + noise));
    arr.push({ day: `D${i + 1}`, rank: v });
    cur = v - Math.round(volatility * 0.3);
  }
  // 让最后一天等于 end
  arr[29] = { day: "D30", rank: end };
  return arr;
}

export const rankTrackingRows: RankTrackingRow[] = [
  { keyword: "seo 工具", rank: 3, change1d: 1, change7d: 11, change30d: 14, searchVolume: "18.2K", kd: 73, serpFeatures: serpPool[0], bestRank: 2, worstRank: 12, trend: genRankTrend(3, 3) },
  { keyword: "关键词挖掘", rank: 5, change1d: 0, change7d: 4, change30d: 7, searchVolume: "12.4K", kd: 54, serpFeatures: serpPool[1], bestRank: 4, worstRank: 18, trend: genRankTrend(5, 4) },
  { keyword: "排名追踪", rank: 7, change1d: -1, change7d: -2, change30d: 3, searchVolume: "8.7K", kd: 41, serpFeatures: serpPool[2], bestRank: 5, worstRank: 22, trend: genRankTrend(7, 5) },
  { keyword: "外链分析", rank: 12, change1d: 2, change7d: 6, change30d: 9, searchVolume: "5.3K", kd: 38, serpFeatures: serpPool[3], bestRank: 9, worstRank: 34, trend: genRankTrend(12, 6) },
  { keyword: "网站审计工具", rank: 18, change1d: -3, change7d: -5, change30d: -8, searchVolume: "9.1K", kd: 67, serpFeatures: serpPool[4], bestRank: 11, worstRank: 28, trend: genRankTrend(18, 5) },
  { keyword: "竞品分析", rank: 22, change1d: 1, change7d: 3, change30d: 5, searchVolume: "31.2K", kd: 49, serpFeatures: serpPool[5], bestRank: 15, worstRank: 41, trend: genRankTrend(22, 6) },
  { keyword: "内容优化", rank: 28, change1d: 0, change7d: 0, change30d: 2, searchVolume: "19.8K", kd: 35, serpFeatures: serpPool[6], bestRank: 19, worstRank: 47, trend: genRankTrend(28, 7) },
  { keyword: "搜索意图", rank: 34, change1d: 3, change7d: 8, change30d: 12, searchVolume: "4.6K", kd: 22, serpFeatures: serpPool[7], bestRank: 21, worstRank: 52, trend: genRankTrend(34, 8) },
];

export const rankCompetitors: RankCompetitorRow[] = [
  { domain: "example.com", favicon: "E", rank: 3, change: 11, isSelf: true },
  { domain: "ahrefs.com", favicon: "A", rank: 1, change: 0 },
  { domain: "semrush.com", favicon: "S", rank: 2, change: 1 },
  { domain: "moz.com", favicon: "M", rank: 5, change: -2 },
  { domain: "ubersuggest.com", favicon: "U", rank: 8, change: 3 },
];

export const rankLocations = ["中国", "美国", "日本", "英国", "德国"];
export const rankCities = ["北京", "上海", "广州", "深圳", "杭州"];

// ===== 竞品分析（PRD 4.5）=====

export interface CompetitorDomain {
  domain: string;
  favicon: string;
  organicTraffic: string;
  paidTraffic: string;
  keywords: number;
  backlinks: string;
  authority: number;
  isSelf?: boolean;
  color: string; // 折线图颜色
  trend: { month: string; value: number }[];
}

export interface KeywordGapGroup {
  category: string; // "我的独有" | "竞品独有" | "共同"
  count: number;
  keywords: { keyword: string; volume: string; kd: number }[];
}

export interface TopPageRow {
  url: string;
  traffic: string;
  keywords: number;
  topKeyword: string;
}

export const competitorDomains: CompetitorDomain[] = [
  {
    domain: "example.com",
    favicon: "E",
    organicTraffic: "14.2 万",
    paidTraffic: "3.1 万",
    keywords: 1284,
    backlinks: "1,927",
    authority: 76,
    isSelf: true,
    color: "#ffd400",
    trend: [
      // 大幅波动，6 月顶峰与 moz.com 低谷交叉
      { month: "1月", value: 8.4 },
      { month: "2月", value: 13.6 },
      { month: "3月", value: 9.2 },
      { month: "4月", value: 16.7 },
      { month: "5月", value: 11.5 },
      { month: "6月", value: 28.5 },
      { month: "7月", value: 13.8 },
      { month: "8月", value: 14.2 },
    ],
  },
  {
    domain: "ahrefs.com",
    favicon: "A",
    organicTraffic: "182 万",
    paidTraffic: "28 万",
    keywords: 8420,
    backlinks: "12.4 万",
    authority: 92,
    color: "#6c4cff",
    trend: [
      // 加大波动起伏
      { month: "1月", value: 168 },
      { month: "2月", value: 176 },
      { month: "3月", value: 162 },
      { month: "4月", value: 185 },
      { month: "5月", value: 171 },
      { month: "6月", value: 190 },
      { month: "7月", value: 178 },
      { month: "8月", value: 182 },
    ],
  },
  {
    domain: "semrush.com",
    favicon: "S",
    organicTraffic: "164 万",
    paidTraffic: "42 万",
    keywords: 7860,
    backlinks: "10.8 万",
    authority: 91,
    color: "#2f8cff",
    trend: [
      // 加大波动起伏
      { month: "1月", value: 158 },
      { month: "2月", value: 169 },
      { month: "3月", value: 151 },
      { month: "4月", value: 172 },
      { month: "5月", value: 160 },
      { month: "6月", value: 176 },
      { month: "7月", value: 155 },
      { month: "8月", value: 164 },
    ],
  },
  {
    domain: "moz.com",
    favicon: "M",
    organicTraffic: "48 万",
    paidTraffic: "6.2 万",
    keywords: 3120,
    backlinks: "4.6 万",
    authority: 88,
    color: "#21d19f",
    trend: [
      // 大幅波动，6 月低谷被 example.com 顶峰穿越
      { month: "1月", value: 49.5 },
      { month: "2月", value: 38.2 },
      { month: "3月", value: 47.6 },
      { month: "4月", value: 24.5 },
      { month: "5月", value: 41.8 },
      { month: "6月", value: 19.6 },
      { month: "7月", value: 36.5 },
      { month: "8月", value: 48 },
    ],
  },
];

export const keywordGapGroups: KeywordGapGroup[] = [
  {
    category: "我的独有",
    count: 412,
    keywords: [
      { keyword: "中文 seo 工具", volume: "3.4K", kd: 49 },
      { keyword: "百度排名查询", volume: "5.2K", kd: 38 },
      { keyword: "国内 seo 软件", volume: "2.1K", kd: 33 },
      { keyword: "360 搜索优化", volume: "1.8K", kd: 28 },
    ],
  },
  {
    category: "竞品独有",
    count: 1287,
    keywords: [
      { keyword: "best seo tool 2026", volume: "8.4K", kd: 62 },
      { keyword: "ahrefs vs semrush", volume: "12.6K", kd: 58 },
      { keyword: "free backlink checker", volume: "18.2K", kd: 51 },
      { keyword: "domain authority checker", volume: "9.7K", kd: 44 },
    ],
  },
  {
    category: "共同",
    count: 872,
    keywords: [
      { keyword: "seo 工具", volume: "18.2K", kd: 73 },
      { keyword: "关键词研究", volume: "11.2K", kd: 58 },
      { keyword: "排名追踪", volume: "8.7K", kd: 41 },
      { keyword: "外链分析", volume: "5.3K", kd: 38 },
    ],
  },
];

export const topPageRows: TopPageRow[] = [
  { url: "ahrefs.com/blog/seo-guide", traffic: "12.4 万", keywords: 184, topKeyword: "seo 教程" },
  { url: "semrush.com/features", traffic: "9.8 万", keywords: 142, topKeyword: "seo 工具" },
  { url: "ahrefs.com/free-tools", traffic: "8.1 万", keywords: 96, topKeyword: "免费 seo 工具" },
  { url: "moz.com/blog/keyword-research", traffic: "6.2 万", keywords: 78, topKeyword: "关键词研究" },
  { url: "semrush.com/academy", traffic: "5.7 万", keywords: 65, topKeyword: "seo 入门" },
  { url: "moz.com/free-seo-tools", traffic: "4.9 万", keywords: 52, topKeyword: "seo 工具" },
];

// ===== 内容优化（PRD 4.6）=====

export interface ContentCheckItem {
  name: string;
  passed: boolean;
  current: string;
  suggested: string;
}

export interface ContentTopic {
  word: string;
  covered: boolean; // true=已覆盖，false=缺失
}

export interface SerpCompetitorRow {
  rank: number;
  title: string;
  wordCount: number;
  topicsCovered: number;
  isSelf?: boolean;
}

export const contentCheckItems: ContentCheckItem[] = [
  { name: "Title 标签", passed: true, current: "32 字符 · 包含主关键词", suggested: "30-60 字符，主关键词靠前" },
  { name: "Meta 描述", passed: false, current: "缺失", suggested: "70-160 字符，包含主关键词与卖点" },
  { name: "H1 标题", passed: true, current: "1 个 H1，含主关键词", suggested: "全页仅 1 个 H1，包含主关键词" },
  { name: "关键词密度", passed: false, current: "0.4%", suggested: "0.8%-1.5%，自然分布" },
  { name: "内链数量", passed: true, current: "6 条", suggested: "3-8 条相关内链" },
  { name: "图片 Alt 文本", passed: false, current: "3/5 已填写", suggested: "所有信息性图片均需 Alt" },
  { name: "Schema 结构化数据", passed: false, current: "未检测到 Article 标记", suggested: "添加 Article / BreadcrumbList" },
];

export const contentTopics: ContentTopic[] = [
  { word: "seo 工具", covered: true },
  { word: "关键词研究", covered: true },
  { word: "排名追踪", covered: true },
  { word: "外链分析", covered: false },
  { word: "网站审计", covered: false },
  { word: "竞品分析", covered: false },
  { word: "内容优化", covered: true },
  { word: "搜索意图", covered: false },
  { word: "技术 SEO", covered: false },
  { word: "SERP 特征", covered: false },
  { word: "页面速度", covered: false },
  { word: "结构化数据", covered: false },
];

export const serpCompetitorRows: SerpCompetitorRow[] = [
  { rank: 1, title: "2026 年最好的 SEO 工具完整对比", wordCount: 4280, topicsCovered: 11 },
  { rank: 2, title: "SEO 工具选购指南：从入门到进阶", wordCount: 3650, topicsCovered: 10 },
  { rank: 3, title: "我们用过的 12 款 SEO 工具实测", wordCount: 5120, topicsCovered: 12 },
  { rank: 4, title: "SeeO · 一站式 SEO 数据分析平台", wordCount: 2140, topicsCovered: 4, isSelf: true },
  { rank: 5, title: "免费 vs 付费 SEO 工具怎么选", wordCount: 2980, topicsCovered: 8 },
  { rank: 6, title: "中小企业 SEO 工具推荐清单", wordCount: 3320, topicsCovered: 9 },
  { rank: 7, title: "SEO 工具使用教程（含案例）", wordCount: 4560, topicsCovered: 10 },
  { rank: 8, title: "中文 SEO 工具市场分析", wordCount: 2740, topicsCovered: 7 },
  { rank: 9, title: "如何用 SEO 工具提升排名", wordCount: 3890, topicsCovered: 9 },
  { rank: 10, title: "SEO 工具对比表（2026 更新）", wordCount: 3210, topicsCovered: 8 },
];

export const contentScoreMock = 68;
export const contentReadabilityMock = {
  score: 72,
  level: "较易读",
  suggestion: "平均句长偏长，建议拆分长句，多用短句和列表提升可读性",
};

export const contentWordCountSuggestion = {
  current: 2140,
  min: 3200,
  max: 4500,
  average: 3650,
};


// ===== 关键词策略构造器 · 文案层 =====
//
// 为什么单独一份 copy 而不是塞进 messages/*.json：
// 本页是 Semrush 参考图的 1:1 复刻，结果页的控件文案在参考图里本身就是英文
// （Topical Overview / Pillar page / Generate content …），只有空态表单是中文；
// 两类语言层混在 next-intl 命名空间里会让「哪些是 UI 文案、哪些是固定数据标签」失真。
// 空态文案随 locale 切换，结果页固定英文（与参考图一致）。
//
// 第二阶段接入真实数据后，若要把结果页英文标签也本地化，可整体迁回 messages。

export type BuilderLang = "zh" | "en";

export interface BuilderCopy {
  title: string;
  subtitle: string;
  seedLabel: string;
  viewExample: string;
  create: string;
  country: string;
  trialBefore: string;
  trialLink: string;
  trialAfter: string;
  tipTitle: string;
  tipBad: readonly [string, string];
  tipGood: readonly [string, string];
  seedRequired: string;
  phase2: (label: string) => string;
  exampleSeeds: readonly string[];
}

const ZH: BuilderCopy = {
  title: "关键词策略构建器",
  subtitle: "利用根据您的网站或关键词量身定制的策略，吸引更多流量。",
  seedLabel: "输入种子关键词",
  viewExample: "查看示例",
  create: "创建",
  country: "美国",
  trialBefore: "或者",
  trialLink: "获取免费试用版",
  trialAfter: "，深入体验该工具的各项功能。",
  tipTitle: "具体说明才能获得更好的结果：",
  tipBad: ["图书", "SEO"],
  tipGood: ["小学书籍", "搜索引擎优化"],
  seedRequired: "请至少输入一个种子关键词",
  phase2: (label) => `「${label}」将在第二阶段接入真实数据。`,
  exampleSeeds: ["books for elementary grades", "elementary school books"],
};

const EN: BuilderCopy = {
  title: "Keyword Strategy Builder",
  subtitle: "Use a strategy tailored to your site or keywords to attract more traffic.",
  seedLabel: "Enter seed keywords",
  viewExample: "View example",
  create: "Create",
  country: "United States",
  trialBefore: "Or ",
  trialLink: "get a free trial",
  trialAfter: " to explore everything this tool can do.",
  tipTitle: "Be specific for better results:",
  tipBad: ["books", "SEO"],
  tipGood: ["elementary school books", "search engine optimization"],
  seedRequired: "Enter at least one seed keyword",
  phase2: (label) => `"${label}" will connect to real data in phase 2.`,
  exampleSeeds: ["books for elementary grades", "elementary school books"],
};

export const BUILDER_COPY: Record<BuilderLang, BuilderCopy> = { zh: ZH, en: EN };

export function builderCopy(locale: string): BuilderCopy {
  return locale === "en" ? EN : ZH;
}

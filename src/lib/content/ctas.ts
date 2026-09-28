// ===== F｜CTA 库 =====
// 少量、与内容强相关的 CTA。刻意不收录 "Start now" / "Buy now" / "Best SEO tool"
// 这类泛化硬推话术（见 §11）。
// 每个 topic 的 cta 字段只能取这里的 id —— 由 content.test.ts 强制。

export interface Cta {
  id: string;
  text: string;
  /** 适用场景说明，避免误用 */
  useWhen: string;
  /** 对应产品里的真实入口（不新增页面） */
  href: string;
}

export const CTA_LIBRARY: readonly Cta[] = [
  {
    id: "free_audit",
    text: "Run a free SEO audit",
    useWhen: "内容主题是「不知道网站有什么问题」时",
    href: "/",
  },
  {
    id: "check_site",
    text: "Check your site",
    useWhen: "已解释完一个具体检查项，邀请对方自己验证",
    href: "/features/seo-audit",
  },
  {
    id: "see_affected_pages",
    text: "See which pages are affected",
    useWhen: "主题涉及成片出现的问题（重复标题、断链、无 canonical）",
    href: "/features/seo-audit",
  },
  {
    id: "track_change",
    text: "Track the change after you fix it",
    useWhen: "主题是「修完之后怎么验证」",
    href: "/features/rank-tracking",
  },
  {
    id: "expand_keyword",
    text: "Expand a seed keyword",
    useWhen: "主题围绕关键词选择与搜索意图",
    href: "/features/keyword-research",
  },
  {
    id: "compare_rankings",
    text: "Compare your rankings side by side",
    useWhen: "主题涉及竞品对比",
    href: "/features/competitor-analysis",
  },
  {
    id: "score_a_page",
    text: "Score a page against current top results",
    useWhen: "主题围绕内容优化与页面结构",
    href: "/features/content-optimization",
  },
  {
    id: "see_referring_domains",
    text: "See your referring domains",
    useWhen: "主题涉及外链与内容站流量来源",
    href: "/features/backlink-analysis",
  },
  {
    id: "read_docs",
    text: "See how the audit checks work",
    useWhen: "技术性较强、需要说明数据来源与检查口径",
    href: "/docs",
  },
  {
    id: "try_on_your_site",
    text: "Try it on your own site",
    useWhen: "通用收尾，适合产品教育类主题",
    href: "/",
  },
] as const;

export const CTA_IDS = CTA_LIBRARY.map((c) => c.id);

export function getCta(id: string): Cta | null {
  return CTA_LIBRARY.find((c) => c.id === id) ?? null;
}

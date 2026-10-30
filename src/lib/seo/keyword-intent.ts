// ===== 关键词意图文本规则估算（keyword-overview / keyword-expand 共用）=====
//
// 诚实边界：
//   - 这是基于关键词文本的确定性规则估算，**不是数据供应商提供的意图指标**；
//     UI 必须标注「估算」。
//   - 无规则命中时返回「未知」，绝不默认「导航型」——旧实现把一切无特征词
//     （含 "SEO audit tool" 这类工具需求词）判成导航型，属于伪确定性分类。
//   - 规则保持最小集合：只收录高置信信号（疑问词/比较价词/登录导航词），
//     不为个别案例扩充模糊词表。

// 「交易型」当前仅由 DataForSEO Labs 的供应商意图（transactional）产生；
// 本地文本规则不输出交易型（无法从文本可靠区分 commercial/transactional）。
export type KeywordIntent = "信息型" | "商业型" | "交易型" | "导航型" | "未知";

export function detectIntent(query: string): KeywordIntent {
  const q = query.toLowerCase();
  // 中文意图规则
  if (/什么|怎么|为什么|如何|是不是|哪些/.test(q)) return "信息型";
  if (/推荐|最好|对比|价格|费用|多少钱|哪个好/.test(q)) return "商业型";
  if (/登录|登入|官网/.test(q)) return "导航型";
  // 英文意图规则
  if (/\b(what|how|why|which|guide|tutorial|learn|is|are|does|do)\b/.test(q)) return "信息型";
  if (/\b(best|top|review|reviews|compare|comparison|vs|price|pricing|cheap|cheapest|alternative|alternatives|buy|cost)\b/.test(q)) return "商业型";
  if (/\b(login|log in|log into|sign in|signin|sign up|signup|logout)\b/.test(q)) return "导航型";
  // 无规则命中：明确「未知」，不猜测
  return "未知";
}

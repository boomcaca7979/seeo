// ===== 关键词「显示文本」格式化（纯函数，只服务于 UI 渲染） =====
//
// 真实 SERP / Labs 数据里存在机器切词留下的空格，例如：
//   "Ai agent 有 哪些"、"Ai agent 怎麼 用"、"SEO 是 什么 职位"
// 直接渲染时中文被空格打断，读起来是断的。本函数只解决「显示是否自然」，
// 它**不是**数据清洗：
//   - 不改大小写、不改词序、不增删词、不做简繁转换
//   - 返回值只用于屏幕渲染；API 请求、数据库写入、搜索跳转 URL、CSV 导出、
//     复制、研究快照一律继续用 keyword 原文（调用方自己保证）
//
// 规则（顺序即实现顺序）：
//   1. 全部空白字符（含全角空格 \u3000、&nbsp; \u00A0、制表/换行）归一为一个半角空格
//   2. 首尾空白去掉
//   3. 连续多个空格合并为一个
//   4. 相邻两个中文（汉字 / 假名）之间的空格去掉
//   5. 中文标点两侧的空格去掉（中文标点不占前导空格，也不该顶开后面的字）
//   6. 其余位置（中文 ↔ 英文/数字、英文 ↔ 英文）保留且只保留一个空格
//
// 刻意不处理：韩文（韩语用空格分词，"검색 엔진" 的空格是有语义的）、
// 英文语境里的 ASCII 标点（"SEO, tools" 的空格保持原样）。

/** 汉字 / 假名（不含量词符号与韩文） */
const CJK_WORD =
  /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** 中文标点：CJK 符号区 + 全角标点（排除全角数字/字母，它们是词不是标点） */
const CJK_PUNCT =
  /[\u2018\u2019\u201C\u201D\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/;

const isCjkWord = (ch: string) => CJK_WORD.test(ch);
const isCjkPunct = (ch: string) => CJK_PUNCT.test(ch);

/** 该空格是否应被吞掉（左字符 / 右字符都是单个 UTF-16 码元） */
function shouldDropSpace(left: string, right: string): boolean {
  // 中文标点永远贴着相邻字符：左标点（，。、）后面不留空格，右标点（（“《）前面不留空格
  if (isCjkPunct(left) || isCjkPunct(right)) return true;
  // 汉字/假名之间不留空格
  if (isCjkWord(left) && isCjkWord(right)) return true;
  return false;
}

/**
 * 关键词的显示文本（仅用于 UI）。
 * 输入原文，输出「去掉不合理中文空格」的展示串；对同一输入幂等。
 */
export function formatKeywordDisplay(keyword: string): string {
  if (!keyword) return "";
  // 1+3. 空白归一 + 合并（\s 已覆盖 \u00A0 \u3000 \u202F 等）
  const normalized = keyword.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === " ") {
      const left = out[out.length - 1] ?? "";
      const right = normalized[i + 1] ?? "";
      if (left && right && shouldDropSpace(left, right)) continue;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/** 显示文本是否与原文不同（用于判断「悬停才能看到原文」的提示是否需要出现） */
export function keywordDisplayDiffers(keyword: string): boolean {
  return formatKeywordDisplay(keyword) !== keyword;
}

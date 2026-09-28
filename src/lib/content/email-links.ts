// ===== F → C 连接：内容主题 ↔ 已存在的生命周期邮件模板 =====
// 规则（§18）：**不新建任何邮件模板**。只把适合做教育邮件的主题，
// 关联到 C 阶段已经注册的模板 key 上。
//
// 为什么这里不在运行时 import C：
//   C 的模板模块内部使用无扩展名相对导入，Node 原生运行本模块时会解析失败。
//   因此本文件只声明「允许关联的 key 名单」，由 content.test.ts 在测试期
//   与 C 的真实注册表 `LIFECYCLE_TEMPLATES` 逐一比对 —— 单一事实来源仍是 C，
//   这里只是引用，不是第二个注册表。

/** 仅允许关联到 C 已注册的邮件模板（测试会用 C 的真实注册表核对） */
export const LINKABLE_EMAIL_TEMPLATES: readonly string[] = ["seo_education_v1", "feature_education_v1"];

/**
 * 主题 → C 邮件模板。
 * 语义：这条主题的内容可以直接喂养该生命周期邮件，不需要另写一套。
 */
export const CONTENT_EMAIL_LINKS: Readonly<Record<string, string>> = {
  // 「为什么会这样」类解释 → seo_education_v1
  C001: "seo_education_v1",
  C002: "seo_education_v1",
  C003: "seo_education_v1",
  C006: "seo_education_v1",
  C010: "seo_education_v1",
  C011: "seo_education_v1",
  C018: "seo_education_v1",
  C019: "seo_education_v1",
  C024: "seo_education_v1",

  // 「怎么用工具把它解决」类 → feature_education_v1
  C005: "feature_education_v1",
  C007: "feature_education_v1",
  C008: "feature_education_v1",
  C022: "feature_education_v1",
  C025: "feature_education_v1",
  C026: "feature_education_v1",
  C027: "feature_education_v1",
};

/** 主题被关联到哪个邮件模板（无关联返回 null） */
export function emailTemplateFor(contentId: string): string | null {
  return CONTENT_EMAIL_LINKS[contentId] ?? null;
}

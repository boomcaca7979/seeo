// ===== 页面级 hreflang <link> 渲染（标准小写属性）=====
// 背景：Next 16 metadata API 的 alternates.languages 会被 React 序列化为
// camelCase `hrefLang` 属性（实测 16.2.12，与官方文档示例的小写 hreflang 不符）。
// HTML 属性名虽大小写不敏感，但 SEO 工具链（校验器/爬虫审计）普遍按小写
// hreflang 匹配，因此这里直接在页面树内渲染小写 <link rel="alternate">，
// React 会自动 hoist 到 <head>。
// 注意：prop 必须显式用小写 `hreflang`（React 对 `hrefLang` prop 输出 camelCase）。

import { hreflangAlternates } from "@/i18n/seo";

export default function HreflangAlternates({ path }: { path: string }) {
  const alternates = hreflangAlternates(path);
  return (
    <>
      {alternates.map((a) => (
        // spread 写法：@types/react 仅有 hrefLang（camelCase）类型定义，
        // 直接写 hreflang= 属性会 TS 报错；spread 非字面量不做 excess check
        <link key={a.hreflang} rel="alternate" {...a} />
      ))}
    </>
  );
}

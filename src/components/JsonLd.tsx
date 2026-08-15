// ===== JSON-LD 渲染组件（Server Component） =====
// 将 schema 对象输出为 <script type="application/ld+json">

export default function JsonLd({ schema }: { schema: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

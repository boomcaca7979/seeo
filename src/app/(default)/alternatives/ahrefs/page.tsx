import AlternativesPageContent from "@/components/AlternativesPageContent";

// ===== /alternatives/ahrefs 内容组件（en / zh）=====
// 复用 AlternativesPageContent 通用组件，文案走 messages（alternativesAhrefs）。
export default function AhrefsAlternativePage() {
  return (
    <AlternativesPageContent
      namespace="alternativesAhrefs"
      path="/alternatives/ahrefs"
      competitor="Ahrefs"
    />
  );
}

import AlternativesPageContent from "@/components/AlternativesPageContent";

// ===== /alternatives/semrush 内容组件（en / zh）=====
// 复用 AlternativesPageContent 通用组件，文案走 messages（alternativesSemrush）。
export default function SemrushAlternativePage() {
  return (
    <AlternativesPageContent
      namespace="alternativesSemrush"
      path="/alternatives/semrush"
      competitor="Semrush"
    />
  );
}

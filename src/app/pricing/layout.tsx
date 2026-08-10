import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "定价 · SeeO",
  description: "SeeO 定价方案：免费版、专业版、企业版。按需选择关键词追踪、技术审计与竞品分析功能。",
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

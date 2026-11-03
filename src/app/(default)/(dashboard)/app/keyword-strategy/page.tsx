"use client";

// ===== Keyword Strategy Builder（关键词策略构造器）=====
//
// 页面状态：空态（种子输入）→ 生成中（服务端后台任务 + 轮询）→ 结果态（真实策略数据）。
// 关键词、主题、Pillar/Subpages 全部来自服务端对 SerpApi 真实 SERP 的抓取与规则聚类；
// 搜索量 / KD / CPC 只有在拿到 DataForSEO 真实数据时才显示，否则显示「—」。

import { Suspense } from "react";
import KeywordStrategyBuilder from "@/components/keyword-strategy/KeywordStrategyBuilder";

export default function KeywordStrategyPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-[#f4f5f5]" />}>
      <KeywordStrategyBuilder />
    </Suspense>
  );
}

// ===== 公开只读分享页 =====
// 只按 share_token 读取；不返回、不展示归属用户/内部 id；不含任何写操作入口。
// token 撤销后本页立即 404。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStrategyByShareToken } from "@/lib/db/strategies";
import { formatKd, formatVolume } from "@/lib/seo/strategy-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared keyword strategy · SeeO",
  robots: { index: false, follow: false },
};

export default async function SharedStrategyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const record = await getStrategyByShareToken(token);
  if (!record || !record.doc) notFound();

  const doc = record.doc;
  const topicName = new Map(doc.topics.map((t) => [t.id, t.name]));
  const roleLabel = (role: string) =>
    role === "pillar" ? "Pillar" : role === "subpage" ? "Subpage" : "Ungrouped";
  const hasVolume = doc.meta.metrics.volume === "provider";

  return (
    <main className="min-h-screen bg-[#f4f5f5] px-4 py-8 text-[#1a1e19]">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full bg-[#eaeef6] px-2 text-[0.75rem] text-[#245ee2]">
            只读分享
          </span>
          <span className="text-[0.75rem] text-[#6b6c6b]">
            该页面由 SeeO 生成，访问者只能查看，不能修改或删除。
          </span>
        </div>

        <h1 className="mt-3 text-[1.5rem] leading-[32px] font-semibold">{record.name}</h1>
        <p className="mt-1 text-[0.8125rem] text-[#4b4d4a]">
          {record.market} · {record.device} · 种子：{record.seeds.join("、")} · 关键词 {doc.keywords.length} 个 · 主题{" "}
          {doc.topics.length} 个
        </p>
        <p className="mt-1 text-[0.75rem] text-[#6b6c6b]">
          数据来源：{doc.meta.sources.join(" / ") || "—"} · 采集时间：
          {doc.meta.fetchedAt ? new Date(doc.meta.fetchedAt).toLocaleString() : "—"} ·
          {hasVolume ? " 搜索量/KD 为供应商数据" : " 搜索量 / KD 未提供（显示为 —）"}
        </p>

        {/* 隐私边界：meta.warnings 含供应商原始报错（可能暴露账号/额度信息），
            属所有者私有诊断信息，公开只读页一律不渲染。 */}

        <section className="mt-5 rounded-md border border-[#e3e4e3] bg-white">
          <header className="border-b border-[#e9eae9] px-4 py-2 text-[0.8125rem] font-semibold">Topics</header>
          <div className="divide-y divide-[#eff0ef]">
            {doc.topics.map((topic) => {
              const pillar = topic.pillarId ? doc.keywords.find((k) => k.id === topic.pillarId) : null;
              return (
                <div key={topic.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-[0.875rem] font-semibold">{topic.name}</span>
                    <span className="text-[0.75rem] text-[#6b6c6b]">{topic.keywordCount} keywords</span>
                    <span className="text-[0.75rem] text-[#6b6c6b]">Total Volume: {formatVolume(topic.totalVolume)}</span>
                    <span className="text-[0.75rem] text-[#6b6c6b]">Average KD: {formatKd(topic.avgKd)}</span>
                  </div>
                  {pillar && (
                    <p className="mt-1 text-[0.8125rem]">
                      <span className="text-[#6b6c6b]">Pillar:</span> {pillar.keyword}
                    </p>
                  )}
                  {topic.pages.length > 0 && (
                    <p className="mt-1 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
                      <span className="text-[#6b6c6b]">Subpages:</span>{" "}
                      {topic.pages.slice(0, 12).map((p) => p.name).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-md border border-[#e3e4e3] bg-white">
          <header className="border-b border-[#e9eae9] px-4 py-2 text-[0.8125rem] font-semibold">
            Keywords ({doc.keywords.length})
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[#e9eae9] text-left text-[0.75rem] text-[#6b6c6b]">
                  <th className="px-4 py-2 font-normal">Keyword</th>
                  <th className="px-4 py-2 font-normal">Topic</th>
                  <th className="px-4 py-2 font-normal">Role</th>
                  <th className="px-4 py-2 font-normal">Intent</th>
                  <th className="px-4 py-2 text-right font-normal">KD %</th>
                  <th className="px-4 py-2 text-right font-normal">Volume</th>
                </tr>
              </thead>
              <tbody>
                {doc.keywords.slice(0, 500).map((k) => (
                  <tr key={k.id} className="border-b border-[#f2f3f2] last:border-b-0">
                    <td className="max-w-[320px] truncate px-4 py-2">{k.keyword}</td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-[#6b6c6b]">{topicName.get(k.topicId) ?? "—"}</td>
                    <td className="px-4 py-2 text-[#6b6c6b]">{roleLabel(k.role)}</td>
                    <td className="px-4 py-2 text-[#4b4d4a]">
                      {k.intent}
                      {k.intentSource === "estimated" ? "（估算）" : ""}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatKd(k.kd)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatVolume(k.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-6 text-[0.75rem] leading-[18px] text-[#8a8c89]">
          {doc.meta.method.clustering} {doc.meta.method.pillar}
        </p>
      </div>
    </main>
  );
}

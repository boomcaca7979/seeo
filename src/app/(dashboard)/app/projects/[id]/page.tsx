import Link from "next/link";
import { notFound } from "next/navigation";
import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { projects as mockProjects, rankRows } from "@/lib/mock-data";
import { matchMockProject } from "@/lib/project-match";
import type { DatabaseProject } from "@/lib/types";
import Sparkline from "@/components/dashboard/Sparkline";

// 服务端读 Supabase/Turso，避免静态预渲染
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 演示模式：直接从 mock-data 按 id 匹配
  if (!isAuthEnabled) {
    const mockProject = mockProjects.find((p) => p.id === id);
    if (!mockProject) notFound();
    const project: DatabaseProject = {
      id: mockProject.id,
      user_id: "demo-user",
      name: mockProject.domain,
      domain: mockProject.domain,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return renderDetail(project, matchMockProject(project.domain));
  }

  const supabase = await createServer();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  const project = data as DatabaseProject | null;
  if (!project) notFound();

  return renderDetail(project, matchMockProject(project.domain));
}

function renderDetail(
  project: DatabaseProject,
  mock: ReturnType<typeof matchMockProject>
) {
  const trendData = mock.trend.map((t) => ({ d: t.day, v: t.value }));

  const metrics = [
    {
      label: "自然流量预估",
      value: mock.organicTraffic,
      trend: "up" as const,
      trendValue: "+23.4%",
      spark: trendData,
    },
    {
      label: "关键词总数",
      value: mock.trackedKeywords.toLocaleString(),
      trend: "up" as const,
      trendValue: "+47",
      spark: trendData.map((d, i) => ({ ...d, v: d.v + i * 2 })),
    },
    {
      label: "外链总数",
      value: mock.backlinks,
      trend: "down" as const,
      trendValue: "-8",
      spark: trendData.map((d, i) => ({ ...d, v: d.v - i })).reverse(),
    },
    {
      label: "健康度评分",
      value: `${mock.healthScore}/100`,
      trend: "up" as const,
      trendValue: "+5",
      spark: trendData.map((d, i) => ({ ...d, v: 70 + i })),
    },
  ];

  const quickLinks = [
    { title: "技术审计", desc: "查看本站技术 SEO 问题", href: "/app/audit", tag: "诊断" },
    { title: "外链分析", desc: "查看外链来源与增长", href: "/app/backlinks", tag: "诊断" },
    { title: "竞品分析", desc: "对比竞品的流量与关键词", href: "/app/competitors", tag: "洞察" },
    { title: "内容优化", desc: "针对页面给出优化建议", href: "/app/content", tag: "优化" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 面包屑 */}
      <nav className="flex items-center gap-2 font-mono text-xs text-ink-40">
        <Link href="/app" className="hover:text-ink">工作台</Link>
        <span>/</span>
        <span className="text-ink-60">{project.domain}</span>
      </nav>

      {/* 项目标题 */}
      <div className="mt-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-card font-mono text-base font-bold text-ink">
          {mock.favicon}
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {project.name}
        </h1>
        <span className="badge-good">活跃</span>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-mono text-xs text-ink-40">{project.domain}</p>

      {/* 核心指标卡片 */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="card-a p-5">
            <div className="font-mono text-xs text-ink-40">{m.label}</div>
            <div className="mt-2 flex items-end justify-between">
              <span className="font-display text-2xl font-bold text-ink">
                {m.value}
              </span>
              <Sparkline data={m.spark} width={100} height={32} />
            </div>
            <div
              className={`mt-2 font-mono text-xs ${
                m.trend === "up" ? "text-pos" : "text-neg"
              }`}
            >
              {m.trend === "up" ? "▲" : "▼"} {m.trendValue}
              <span className="ml-1 text-ink-40">近 30 天</span>
            </div>
          </div>
        ))}
      </div>

      {/* 排名追踪概览 */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">
            排名追踪概览
          </h2>
          <Link
            href="/app/rank-tracking"
            className="font-sans text-sm font-medium text-ink-60 transition-colors hover:text-ink"
          >
            查看全部 →
          </Link>
        </div>

        <div className="card-a mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/40">
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">关键词</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">当前排名</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">7 天变化</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">搜索量</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">KD</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">意图</th>
                </tr>
              </thead>
              <tbody>
                {rankRows.slice(0, 6).map((r) => (
                  <tr
                    key={r.keyword}
                    className="border-b border-line-soft transition-colors hover:bg-line-soft/40"
                  >
                    <td className="px-4 py-3 font-sans text-sm font-medium text-ink">
                      {r.keyword}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-semibold text-ink">
                        #{r.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.change === 0 ? (
                        <span className="font-mono text-sm text-ink-40">—</span>
                      ) : (
                        <span
                          className={`font-mono text-sm font-semibold ${
                            r.change > 0 ? "text-pos" : "text-neg"
                          }`}
                        >
                          {r.change > 0 ? "▲" : "▼"} {Math.abs(r.change)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-ink-60">
                      {r.searchVolume}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-ink-60">
                      {r.kd}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge-info">{r.intent}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="mt-10">
        <h2 className="font-display text-lg font-bold text-ink">
          快捷入口
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map((q) => (
            <Link
              key={q.title}
              href={q.href}
              className="card-a group flex flex-col p-5 transition-colors hover:border-ink-25"
            >
              <span className="badge-info w-fit">{q.tag}</span>
              <h3 className="mt-3 font-display text-base font-bold text-ink">
                {q.title}
              </h3>
              <p className="mt-1 font-sans text-xs text-ink-60">
                {q.desc}
              </p>
              <span className="mt-3 font-sans text-xs font-medium text-ink-60 opacity-0 transition-opacity group-hover:opacity-100">
                进入 →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

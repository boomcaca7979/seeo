import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { rankRows } from "@/lib/mock-data";
import { matchMockProject } from "@/lib/project-match";
import type { DatabaseProject } from "@/lib/types";
import Sparkline from "@/components/dashboard/Sparkline";
import { getProjectById } from "@/lib/db";
import { formatNumber, type Locale } from "@/lib/ui-locale";

// 服务端读 Supabase/Turso，避免静态预渲染
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations("dashboard.shared.projectDetail");
  const locale = (await getLocale()) as Locale;

  // 演示模式：从 Turso/SQLite 数据库按 id 查询真实项目
  if (!isAuthEnabled) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) notFound();
    const row = await getProjectById("demo-user", numId);
    if (!row) notFound();
    const project: DatabaseProject = {
      id: String(row.id),
      user_id: "demo-user",
      name: row.name,
      domain: row.domain,
      created_at: row.created_at,
      updated_at: row.created_at,
    };
    return renderDetail(project, matchMockProject(project.domain), t, locale);
  }

  const supabase = await createServer();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  const project = data as DatabaseProject | null;
  if (!project) notFound();

  return renderDetail(project, matchMockProject(project.domain), t, locale);
}

function renderDetail(
  project: DatabaseProject,
  mock: ReturnType<typeof matchMockProject>,
  t: Awaited<ReturnType<typeof getTranslations>>,
  locale: Locale
) {
  const trendData = mock.trend.map((t) => ({ d: t.day, v: t.value }));

  const metrics = [
    {
      label: t("metricOrganicTraffic"),
      value: mock.organicTraffic,
      trend: "up" as const,
      trendValue: "+23.4%",
      spark: trendData,
    },
    {
      label: t("metricKeywords"),
      value: formatNumber(mock.trackedKeywords, locale),
      trend: "up" as const,
      trendValue: "+47",
      spark: trendData.map((d, i) => ({ ...d, v: d.v + i * 2 })),
    },
    {
      label: t("metricBacklinks"),
      value: mock.backlinks,
      trend: "down" as const,
      trendValue: "-8",
      spark: trendData.map((d, i) => ({ ...d, v: d.v - i })).reverse(),
    },
    {
      label: t("metricHealth"),
      value: `${mock.healthScore}/100`,
      trend: "up" as const,
      trendValue: "+5",
      spark: trendData.map((d, i) => ({ ...d, v: 70 + i })),
    },
  ];

  const quickLinks = [
    { title: t("quickLinkAuditTitle"), desc: t("quickLinkAuditDesc"), href: "/app/audit", tag: t("tagDiagnose") },
    { title: t("quickLinkBacklinksTitle"), desc: t("quickLinkBacklinksDesc"), href: "/app/backlinks", tag: t("tagDiagnose") },
    { title: t("quickLinkCompetitorsTitle"), desc: t("quickLinkCompetitorsDesc"), href: "/app/competitors", tag: t("tagInsight") },
    { title: t("quickLinkContentTitle"), desc: t("quickLinkContentDesc"), href: "/app/content", tag: t("tagOptimize") },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 面包屑 */}
      <nav className="flex items-center gap-2 font-mono text-xs text-ink-40">
        <Link href="/app" className="hover:text-ink">{t("breadcrumbHome")}</Link>
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
        <span className="badge-good">{t("statusActive")}</span>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-mono text-xs text-ink-40">{project.domain}</p>

      {/* 核心指标卡片（流量/关键词/外链/健康度为示意数据） */}
      <div className="mt-8 flex items-center gap-2">
        <span className="font-mono text-xs text-ink-40">{t("metricsTitle")}</span>
        <span className="badge-warn">{t("demoDataBadge")}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              <span className="ml-1 text-ink-40">{t("last30Days")}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 排名追踪概览 */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold text-ink">
              {t("rankOverviewTitle")}
            </h2>
            {/* 表格行数据为示意数据 */}
            <span className="badge-warn">{t("demoDataBadge")}</span>
          </div>
          <Link
            href="/app/position-tracking"
            className="font-sans text-sm font-medium text-ink-60 transition-colors hover:text-ink"
          >
            {t("viewAll")}
          </Link>
        </div>

        <div className="card-a mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/40">
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thKeyword")}</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thCurrentRank")}</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thChange7d")}</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thSearchVolume")}</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thKD")}</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thIntent")}</th>
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
          {t("quickLinksTitle")}
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
                {t("enter")}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

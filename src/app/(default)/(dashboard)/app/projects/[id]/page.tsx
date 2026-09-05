import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import type { DatabaseProject } from "@/lib/types";
import { getProjectById } from "@/lib/db";

// 服务端读 Supabase/Turso，避免静态预渲染
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations("dashboard.shared.projectDetail");

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
    return renderDetail(project, t);
  }

  const supabase = await createServer();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  const project = data as DatabaseProject | null;
  if (!project) notFound();

  return renderDetail(project, t);
}

function renderDetail(
  project: DatabaseProject,
  t: Awaited<ReturnType<typeof getTranslations>>
) {
  const quickLinks = [
    { title: t("quickLinkAuditTitle"), desc: t("quickLinkAuditDesc"), href: "/app/audit", tag: t("tagDiagnose") },
    { title: t("quickLinkBacklinksTitle"), desc: t("quickLinkBacklinksDesc"), href: "/app/backlinks", tag: t("tagDiagnose") },
    { title: t("quickLinkCompetitorsTitle"), desc: t("quickLinkCompetitorsDesc"), href: "/app/competitors", tag: t("tagInsight") },
    { title: t("quickLinkContentTitle"), desc: t("quickLinkContentDesc"), href: "/app/content", tag: t("tagOptimize") },
  ];

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 面包屑 */}
      <nav className="flex items-center gap-2 font-mono text-xs text-ink-40">
        <Link href="/app" className="hover:text-ink">{t("breadcrumbHome")}</Link>
        <span>/</span>
        <span className="text-ink-60">{project.domain}</span>
      </nav>

      {/* 项目标题 */}
      <div className="mt-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-card font-mono text-base font-semibold text-ink">
          {project.domain.charAt(0).toUpperCase()}
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {project.name}
        </h1>
        <span className="badge-good">{t("statusActive")}</span>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-2 font-mono text-xs text-ink-40">{project.domain}</p>

      {/* 快捷入口 */}
      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">
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
              <h3 className="mt-3 font-display text-base font-semibold text-ink">
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

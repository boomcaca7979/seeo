import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import type { DatabaseProject } from "@/lib/types";
import { getProjectByDomain, getProjectWithMetrics, countCompetitors } from "@/lib/db";
import {
  DEMO_USER_ID,
  readOwnedProject,
  type ProjectOwnership,
  type ProjectSource,
} from "@/lib/project-access";
import { buildWorkQueue, type WorkQueue, type WorkTask } from "@/lib/seo/work-queue";
import { pickText } from "@/lib/seo/audit-ltext";
import { composeDashboardTitle } from "@/lib/dashboard-titles";
import { formatDate, type Locale } from "@/lib/ui-locale";
import { formatRelativeTime, type RelativeTimeT } from "@/lib/relative-time";
import PageHeader from "@/components/viz/PageHeader";
import MetricCard from "@/components/viz/MetricCard";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { priorityTone, scoreTone, unifiedStatusTone, type VizTone } from "@/components/viz/tokens";
import ProjectActionLinks from "@/components/dashboard/ProjectActionLinks";
import NotFoundPanel from "@/components/dashboard/NotFoundPanel";

// 服务端读 Supabase/Turso，避免静态预渲染
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ProjectData {
  project: DatabaseProject;
  /** SQLite 内部整数项目 id（竞品表按它关联）；无对应记录 = null（不猜） */
  sqliteProjectId: number | null;
  metrics: Awaited<ReturnType<typeof getProjectWithMetrics>> | null;
  competitorCount: number | null;
  queue: WorkQueue | null;
}

const MAX_TASKS = 3;

/** 待处理 = 队列中的 open + in_progress（与工作台同一口径，不另建筛选规则） */
function openTasks(queue: WorkQueue | null): WorkTask[] {
  if (!queue) return [];
  return queue.tasks.filter((t) => t.status === "open" || t.status === "in_progress");
}

/** SQLite datetime('…') 为 "YYYY-MM-DD HH:MM:SS"（UTC），Supabase 为 ISO。统一成可解析的 ISO。 */
function toIso(raw: string): string {
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
}

interface ProjectIdentity {
  userId: string;
  project: DatabaseProject;
  /** SQLite 内部整数项目 id（竞品表按它关联）；无对应记录 = null（不猜） */
  sqliteProjectId: number | null;
}

/**
 * 只做「这一条项目属于当前用户吗 + 拿到 domain」这一步。
 * generateMetadata 与页面渲染共用同一份归属判定，避免为了标题另写一套隔离逻辑；
 * 判据本身在 @/lib/project-access，与 proxy 的路由级 404 完全同源。
 * 返回 null = 数据源确认「名下没有这条项目」→ notFound；数据源故障则抛错（不当 404）。
 */
async function loadProjectIdentity(id: string): Promise<ProjectIdentity | null> {
  let ownership: ProjectOwnership;
  let userId: string;

  if (!isAuthEnabled) {
    // 演示模式：从 Turso/SQLite 按 id 查询真实项目
    const source: ProjectSource = { mode: "demo" };
    ownership = await readOwnedProject(id, source);
    userId = DEMO_USER_ID;
  } else {
    const supabase = await createServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    userId = user.id;
    ownership = await readOwnedProject(id, { mode: "supabase", client: supabase, userId });
  }

  if (ownership.status === "missing") return null;
  const { project } = ownership;

  // 指标 / 竞品 / 队列按 domain 或 SQLite 整数 id 关联本地库，先解析。
  // demo 库的项目行本身就带整数主键；鉴权模式的项目主键在 Supabase，需按 domain 回查。
  const sqliteProjectId = isAuthEnabled
    ? (await getProjectByDomain(userId, project.domain).catch(() => null))?.id ?? null
    : Number(project.id);
  return { userId, project, sqliteProjectId };
}

async function loadProjectData(id: string): Promise<ProjectData | null> {
  const identity = await loadProjectIdentity(id);
  if (!identity) return null;
  const { userId, project, sqliteProjectId } = identity;
  return collectData(userId, project, sqliteProjectId);
}

async function collectData(
  userId: string,
  project: DatabaseProject,
  sqliteProjectId: number | null
): Promise<ProjectData> {
  const [metrics, competitorCount, queue] = await Promise.all([
    getProjectWithMetrics(userId, {
      id: project.id,
      name: project.name,
      domain: project.domain,
      created_at: project.created_at,
    }).catch(() => null),
    sqliteProjectId === null
      ? Promise.resolve(null)
      : countCompetitors(userId, sqliteProjectId).catch(() => null),
    buildWorkQueue({ userId, domain: project.domain, projectId: sqliteProjectId }).catch(
      () => null
    ),
  ]);
  return { project, sqliteProjectId, metrics, competitorCount, queue };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const identity = await loadProjectIdentity(id);
  // 项目不存在/非本人 → 组件里渲染 NotFoundPanel。metadata 必须与那份正文同一份文案：
  // 客户端 hydration 按路由树解析 metadata，只写品牌名会让 404 顶着「SeeO」或
  // dashboard layout 的概览标题（实测 /app/projects/99999 曾输出「Website overview · SeeO」）。
  if (!identity) {
    const tn = await getTranslations("dashboard.notFound");
    return {
      title: composeDashboardTitle(tn("title")),
      description: tn("subtitle"),
    };
  }
  const t = await getTranslations("dashboard.shared.projectDetail");
  return {
    title: composeDashboardTitle(t("pageTitle", { domain: identity.project.domain })),
  };
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadProjectData(id);
  // 确认「名下没有这条项目」→ 本地化错误面板，不调 notFound()：
  // 站内 RSC 导航里 notFound() 会让 Next 额外注入一条 <meta name="robots" content="noindex">，
  // 与 (default) layout 的 noindex, follow 叠成两条。文档请求的 HTTP 404 仍由 proxy 定住。
  if (!data) return <NotFoundPanel />;
  const t = await getTranslations("dashboard.shared.projectDetail");
  const ta = await getTranslations("dashboard.actions");
  const tv = await getTranslations("dashboard.viz");
  const tc = await getTranslations("dashboard.common");
  const locale = (await getLocale()) as Locale;
  const relT: RelativeTimeT = (key, values) => tc(key, values);
  return renderDetail(data, { t, ta, tv, locale, relT });
}

interface DetailTranslations {
  t: Awaited<ReturnType<typeof getTranslations>>;
  ta: Awaited<ReturnType<typeof getTranslations>>;
  tv: Awaited<ReturnType<typeof getTranslations>>;
  locale: Locale;
  relT: RelativeTimeT;
}

function renderDetail(data: ProjectData, { t, ta, tv, locale, relT }: DetailTranslations) {
  const { project, metrics, competitorCount, queue } = data;
  const domain = project.domain;
  const domainQs = `domain=${encodeURIComponent(domain)}`;
  const lang = locale === "zh" ? "zh" : "en";

  // 读取失败与"确实没有数据"是两回事，分开呈现（绝不把没测过说成没问题）
  const queueFailed = queue === null;
  const metricsFailed = metrics === null;
  const audit = queue?.coverage.audit ?? null;
  const hasAudit = Boolean(audit?.available);
  const tasks = openTasks(queue);
  const p0 = tasks.filter((x) => x.priority.level === "P0").length;
  const p1 = tasks.filter((x) => x.priority.level === "P1").length;
  const unreadAlerts = metrics?.alertCount ?? null;
  const trackedKeywords = metrics?.trackedKeywordCount ?? null;
  const rankUp = metrics?.rankUp7d ?? 0;
  const rankDown = metrics?.rankDown7d ?? 0;

  const failedLabel = t("dataUnavailable");
  const failedReason = t("dataUnavailableReason");

  // 页头状态：全部由队列真实结果推导
  const headerStatus: { label: string; tone: VizTone } = queueFailed
    ? { label: t("statusLoadFailed"), tone: "neutral" }
    : !hasAudit
      ? { label: t("statusNoAudit"), tone: "neutral" }
      : p0 > 0
        ? { label: t("statusHasP0", { n: p0 }), tone: "neg" }
        : tasks.length > 0
          ? { label: t("statusHasOpen", { n: tasks.length }), tone: "warn" }
          : { label: t("statusNothingOpen"), tone: "pos" };

  const lastAuditAt = audit?.finishedAt ?? null;
  const healthScore = audit?.healthScore ?? null;

  return (
    <div className="dash-container p-6 lg:p-8">
      <PageHeader
        crumbs={[{ label: t("breadcrumbHome"), href: "/app" }, { label: t("crumbCurrent") }]}
        title={project.name}
        actions={<StatusBadge label={headerStatus.label} tone={headerStatus.tone} />}
        meta={
          <>
            <span className="font-mono text-ink-60">{domain}</span>
            <span aria-hidden>·</span>
            <span>{t("metaAdded", { date: formatDate(new Date(toIso(project.created_at)), locale) })}</span>
            {unreadAlerts !== null && unreadAlerts > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>{t("metaAlerts", { count: unreadAlerts })}</span>
              </>
            ) : null}
          </>
        }
      />

      {/* ===== 项目数据概览：只呈现口径明确、确实存在的数据 ===== */}
      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold text-ink">{t("overviewTitle")}</h2>
        <p className="mt-1 font-sans text-xs text-ink-40">{t("overviewSubtitle")}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t("metricHealth")}
            value={queueFailed || !hasAudit ? null : healthScore}
            unit={hasAudit && healthScore !== null ? "/ 100" : undefined}
            tone={scoreTone(hasAudit ? healthScore : null)}
            hint={t("metricHealthHint")}
            hintStyle="plain"
            caption={
              !queueFailed && hasAudit && lastAuditAt
                ? `${t("lastAuditAt")} ${formatRelativeTime(toIso(lastAuditAt), locale, relT)}` +
                  (audit?.pagesCrawled ? ` · ${t("pagesCrawled", { n: audit.pagesCrawled })}` : "")
                : undefined
            }
            unavailableLabel={queueFailed ? failedLabel : t("noAudit")}
            unavailableReason={queueFailed ? failedReason : t("noAuditReason")}
            status={
              !queueFailed && hasAudit && audit?.partial
                ? { label: t("partialAuditBadge"), tone: "warn" }
                : null
            }
          />

          <MetricCard
            label={t("metricOpenTasks")}
            value={queueFailed ? null : !hasAudit && tasks.length === 0 ? null : tasks.length}
            hint={t("metricOpenTasksHint")}
            hintStyle="plain"
            caption={
              queueFailed
                ? undefined
                : tasks.length === 0
                  ? t("allClearCaption")
                  : `${t("priorityBreakdown", { p0, p1 })} · ${t("restP2", { n: Math.max(0, tasks.length - p0 - p1) })}` +
                    (hasAudit ? "" : ` ${t("openTasksNoAuditCaption")}`)
            }
            unavailableLabel={queueFailed ? failedLabel : t("notMeasured")}
            unavailableReason={queueFailed ? failedReason : t("noAuditReason")}
          />

          <MetricCard
            label={t("metricKeywords")}
            value={metricsFailed ? null : trackedKeywords}
            hint={t("metricKeywordsHint")}
            hintStyle="plain"
            caption={
              trackedKeywords === null
                ? undefined
                : trackedKeywords === 0
                  ? t("noKeywordsCaption")
                  : rankUp + rankDown === 0
                    ? t("noRankMovement")
                    : t("rankMovement", { up: rankUp, down: rankDown })
            }
            unavailableLabel={failedLabel}
            unavailableReason={failedReason}
          />

          <MetricCard
            label={t("metricCompetitors")}
            value={competitorCount}
            hint={t("metricCompetitorsHint")}
            hintStyle="plain"
            caption={
              competitorCount === null
                ? undefined
                : competitorCount === 0
                  ? t("noCompetitorsCaption")
                  : t("competitorsAddedOnlyCaption")
            }
            unavailableLabel={failedLabel}
            unavailableReason={failedReason}
          />
        </div>
      </section>

      {/* ===== 下一步：本项目真实队列里排在最前的待处理事项 ===== */}
      <section className="card-a mt-6 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">{t("todoTitle")}</h2>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{t("todoSubtitle")}</p>
          </div>
          <Link href="/app/actions" className="btn-secondary px-3 py-1.5 text-xs">
            {ta("panel.cta")}
          </Link>
        </header>

        {queueFailed ? (
          <div className="mt-4 rounded-md border border-dashed border-line px-4 py-6 text-center">
            <div className="font-sans text-sm font-medium text-ink-60">{failedLabel}</div>
            <p className="mt-1 font-sans text-xs text-ink-40">{failedReason}</p>
            <Link href={`/app/audit?${domainQs}`} className="btn-secondary mt-4 px-3 py-1.5 text-xs">
              {t("openAuditCta")}
            </Link>
          </div>
        ) : !hasAudit && tasks.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-line px-4 py-6 text-center">
            <div className="font-sans text-sm font-medium text-ink-60">{t("todoNoAuditTitle")}</div>
            <p className="mt-1 max-w-md font-sans text-xs text-ink-40">{t("todoNoAuditHint")}</p>
            <Link href={`/app/audit?${domainQs}`} className="btn-primary mt-4 px-3 py-1.5 text-xs">
              {t("runAuditCta")}
            </Link>
          </div>
        ) : tasks.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-line px-4 py-6 text-center">
            <div className="font-sans text-sm font-medium text-ink-60">{t("todoEmptyTitle")}</div>
            <p className="mt-1 font-sans text-xs text-ink-40">{t("todoEmptyHint")}</p>
          </div>
        ) : (
          <>
            {/* 未审计但队列里确有机会项：两者都要说清，不能用空状态盖住真实待办 */}
            {!hasAudit ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line px-4 py-3">
                <p className="min-w-0 font-sans text-xs text-ink-40">{t("todoAuditNotice")}</p>
                <Link
                  href={`/app/audit?${domainQs}`}
                  className="btn-secondary flex-none px-3 py-1.5 text-xs"
                >
                  {t("runAuditCta")}
                </Link>
              </div>
            ) : null}
            <ul className="mt-4 divide-y divide-line-soft">
            {tasks.slice(0, MAX_TASKS).map((task) => {
              // 与行动中心/工作台同一取文顺序：本地化标题 → 本地化建议 → 引擎生成的兜底文本 → 类型键
              const title =
                pickText(task.title, lang) ||
                pickText(task.recommendationI18n, lang) ||
                task.fallbackTitle ||
                task.type;
              const primary = task.execution.primary;
              return (
                <li
                  key={task.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        label={task.priority.level}
                        tone={priorityTone(task.priority.level)}
                        dot={false}
                      />
                      <span className="badge-info">
                        {ta(`source.${task.source}` as "source.audit")}
                      </span>
                      <StatusBadge
                        label={ta(`status.${task.status}` as "status.open")}
                        tone={unifiedStatusTone(task.status)}
                        title={ta(`status.${task.status}_hint` as "status.open_hint")}
                      />
                    </div>
                    <div className="mt-2 font-sans text-sm font-medium text-ink">{title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-sans text-xs text-ink-40">
                      {task.target ? (
                        <span className="max-w-[24rem] truncate font-mono">
                          {task.target.replace(/^https?:\/\//, "")}
                        </span>
                      ) : null}
                      {task.affectedPages !== null ? (
                        <span>{tv("scopePages", { n: task.affectedPages })}</span>
                      ) : null}
                      {task.findings !== null ? (
                        <span>{tv("scopeFindings", { n: task.findings })}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-none">
                    {task.execution.available && primary ? (
                      <Link
                        href={primary.href}
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {ta(primary.labelKey as "act.openIssue")} →
                      </Link>
                    ) : (
                      <span className="font-sans text-xs text-ink-40">
                        {ta(
                          `act.${task.execution.unavailableReason ?? "executionUnavailable"}` as
                            "act.executionUnavailable"
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            </ul>
          </>
        )}

        {!queueFailed && tasks.length > MAX_TASKS ? (
          <Link
            href="/app/actions"
            className="mt-3 inline-block font-mono text-xs font-semibold text-brand hover:underline"
          >
            {t("viewAllTasks", { n: tasks.length })} →
          </Link>
        ) : null}
      </section>

      {/* ===== 数据缺口：队列真实检出的缺口，每项直达补齐入口（未审计时上面已给出唯一下一步） ===== */}
      {queue && hasAudit && queue.coverage.gaps.length > 0 ? (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold text-ink">{t("gapsTitle")}</h2>
          <p className="mt-1 font-sans text-xs text-ink-40">{t("gapsSubtitle")}</p>
          <ul className="mt-4 space-y-2">
            {queue.coverage.gaps.map((g) => {
              const href = GAP_HREF[g]?.(domainQs) ?? null;
              return (
                <li
                  key={g}
                  className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-sans text-xs text-ink-60">
                    {ta(`gap.${g}` as "gap.no_completed_audit")}
                  </span>
                  {href ? (
                    <Link
                      href={href}
                      className="font-mono text-xs font-semibold text-brand hover:underline"
                    >
                      {tv("openAction")} →
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ===== 快捷操作：每个入口都带上当前项目上下文 ===== */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink">{t("quickLinksTitle")}</h2>
        <p className="mt-1 font-sans text-xs text-ink-40">{t("quickLinksSubtitle", { domain })}</p>
        <ProjectActionLinks
          projectId={project.id}
          links={[
            {
              key: "audit",
              title: t("quickLinkAuditTitle"),
              desc: t("quickLinkAuditDesc"),
              tag: t("tagDiagnose"),
              href: `/app/audit?${domainQs}`,
            },
            {
              key: "position",
              title: t("quickLinkPositionTitle"),
              desc: t("quickLinkPositionDesc"),
              tag: t("tagTrack"),
              href: `/app/position-tracking?${domainQs}`,
            },
            {
              key: "competitors",
              title: t("quickLinkCompetitorsTitle"),
              desc: t("quickLinkCompetitorsDesc"),
              tag: t("tagInsight"),
              href: "/app/competitors",
            },
            {
              key: "content",
              title: t("quickLinkContentTitle"),
              desc: t("quickLinkContentDesc"),
              tag: t("tagOptimize"),
              href: `/app/content?${domainQs}`,
            },
            {
              key: "backlinks",
              title: t("quickLinkBacklinksTitle"),
              desc: t("quickLinkBacklinksDesc"),
              tag: t("tagInsight"),
              href: `/app/backlinks?${domainQs}`,
            },
            {
              key: "opportunities",
              title: t("quickLinkOpportunitiesTitle"),
              desc: t("quickLinkOpportunitiesDesc"),
              tag: t("tagExecute"),
              href: "/app/opportunities",
            },
          ]}
        />
      </section>
    </div>
  );
}

/** 缺口 → 带当前域名上下文的补齐入口（只映射真实存在的页面） */
const GAP_HREF: Record<string, (domainQs: string) => string> = {
  no_completed_audit: (q) => `/app/audit?${q}`,
  quick_audit_only_homepage: (q) => `/app/audit?${q}`,
  audit_partial: (q) => `/app/audit?${q}`,
  no_dashboard_snapshot: (q) => `/app/audit?${q}`,
  no_tracked_keywords: (q) => `/app/position-tracking?${q}`,
  no_growth_opportunities: () => "/app/opportunities",
  no_project_selected: () => "/app/opportunities",
  backlink_source_unavailable: () => "/app/backlinks",
};

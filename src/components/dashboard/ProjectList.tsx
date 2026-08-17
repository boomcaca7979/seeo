"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { isAuthEnabled } from "@/lib/auth-config";
import type { ProjectWithMetrics, AlertRow } from "@/lib/db";
import Modal from "@/components/dashboard/Modal";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { canSubmitDelete } from "@/lib/delete-guard";
import { formatRelativeTime } from "@/lib/relative-time";
import ChartCard from "@/components/dashboard/charts/ChartCard";
import HealthScoreBars from "@/components/dashboard/charts/HealthScoreBars";
import AlertAreaChart from "@/components/dashboard/charts/AlertAreaChart";

interface ProjectListProps {
  projects: ProjectWithMetrics[];
  alerts: AlertRow[];
  displayName: string;
  unreadAlertCount: number;
}

/** 健康分着色：≥80 绿 / 60-79 橙 / <60 红 */
function scoreColor(score: number): string {
  if (score >= 80) return "text-pos";
  if (score >= 60) return "text-warn";
  return "text-neg";
}
function scoreBarClass(score: number): string {
  if (score >= 80) return "bg-score-pos";
  if (score >= 60) return "bg-score-warn";
  return "bg-score-neg";
}

const alertDotColor: Record<string, string> = {
  error: "bg-neg",
  warning: "bg-warn",
  info: "bg-ink-40",
};
const alertBadgeClass: Record<string, string> = {
  error: "badge-err",
  warning: "badge-warn",
  info: "badge-good",
};
function useTodayLabel(locale: "en" | "zh"): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const d = new Date();
    // 按当前 UI locale 输出「2026年8月17日 · 星期一」/「Aug 17, 2026 · Monday」
    const datePart = d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const weekday = d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
      weekday: "long",
    });
    const id = window.setTimeout(() => setLabel(`${datePart} · ${weekday}`), 0);
    return () => window.clearTimeout(id);
  }, [locale]);
  return label;
}

export default function ProjectList({
  projects,
  alerts,
  displayName,
  unreadAlertCount,
}: ProjectListProps) {
  const router = useRouter();
  const { show, Toast } = useToast();
  const t = useTranslations("dashboard.projectList");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectWithMetrics | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const todayLabel = useTodayLabel(locale);

  // 各项目健康分（仅含已审计的）
  const healthData = useMemo(
    () =>
      projects
        .filter((p) => p.healthScore !== null)
        .map((p) => ({ name: p.name, score: p.healthScore as number })),
    [projects]
  );

  // 近 7 天预警聚合（按 created_at 取日期，计数）
  const alertAreaData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        count: 0,
      });
    }
    alerts.forEach((a) => {
      const d = new Date(a.created_at.endsWith("Z") ? a.created_at : a.created_at + "Z");
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const slot = days.find((s) => s.date === key);
      if (slot) slot.count += 1;
    });
    return days;
  }, [alerts]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    const domain = (formData.get("domain") as string).trim();

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(data, t("createFailed"));
        show(message, "error");
        setCreating(false);
        return;
      }
      setModalOpen(false);
      show(t("createdToast"), "success");
      // 优先使用服务端返回的 domain（已规范化），跳转到审计页
      const savedDomain = (data?.data?.domain ?? domain) as string;
      router.push(`/app/audit?domain=${encodeURIComponent(savedDomain)}`);
    } catch {
      show(tc("networkError"), "error");
    }
    setCreating(false);
  };

  // 删除提交：参数显式传入渲染时捕获的项目对象（不读 selectedProjectId、不用数组 index）。
  // 发请求前经 canSubmitDelete 最后一道防线校验 id/domain，非法一律拒绝并报错。
  const handleDelete = async (target: ProjectWithMetrics) => {
    if (!canSubmitDelete(target)) {
      show(t("deleteGuardFailed"), "error");
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(target.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || t("deleteFailed"), "error");
        setDeleting(false);
        return;
      }
      setDeleteTarget(null);
      show(t("deletedToast", { domain: target.domain }), "success");
      router.refresh();
    } catch {
      show(tc("networkError"), "error");
    }
    setDeleting(false);
  };

  return (
    <div>
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
        {/* eyebrow 行 */}
        <div className="flex items-center justify-between font-sans text-[11px] text-ink-40">
          <span>{todayLabel || "\u00A0"}</span>
          <span>
            {isAuthEnabled ? t("dataUpdatedAt") : t("dataUpdatedAtDemo")}
          </span>
        </div>

        {/* 主标题 + 新建按钮 */}
        <div className="mt-3 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1
              className="font-display font-bold tracking-tight text-ink"
              style={{ fontSize: 32, lineHeight: 1.2 }}
            >
              {t("greeting", { name: displayName })}
            </h1>
            <p className="mt-1.5 font-sans text-sm text-ink-60">
              {t("summary", { projects: projects.length, alerts: unreadAlertCount })}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary"
          >
            <span className="text-base leading-none">＋</span>
            {t("newProject")}
          </button>
        </div>

        {/* 01 我的项目 */}
        <section className="mt-10">
          {/* 区块头：编号 + 标题 + 发丝线 + 计数 */}
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-40">01</span>
            <h2 className="font-display text-base font-bold text-ink">{t("myProjects")}</h2>
            <div className="hairline flex-1" />
            <span className="font-sans text-xs text-ink-40">{t("total", { count: projects.length })}</span>
          </div>

          {projects.length === 0 ? (
            <div className="card-a mt-4 p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line font-mono text-2xl text-ink-40">
                  ∅
                </div>
                <div className="mt-3 font-sans text-sm font-medium text-ink">
                  {t("emptyTitle")}
                </div>
                <div className="mt-1 font-sans text-xs text-ink-40">
                  {t("emptyHint")}
                </div>
                <button
                  onClick={() => setModalOpen(true)}
                  className="btn-primary mt-6"
                >
                  <span className="text-base leading-none">＋</span>
                  {t("createFirst")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => {
                const score = p.healthScore;
                const hasScore = score !== null;
                return (
                  <div
                    key={p.id}
                    className="group relative flex flex-col card-a p-5 hover:border-ink-25"
                  >
                    {/* 删除按钮（常显，不依赖 hover） */}
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-40 hover:bg-line-soft hover:text-neg"
                      aria-label={t("deleteProject")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                        <path
                          d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    <Link href={`/app/projects/${p.id}`} className="flex flex-col">
                      {/* 头部：域名 + URL */}
                      <div className="pr-8">
                        <div
                          className="font-display font-bold text-ink"
                          style={{ fontSize: "16.5px", lineHeight: 1.3 }}
                        >
                          {p.name}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-40">
                          {p.domain}
                        </div>
                      </div>

                      {/* 健康分 + 标签 */}
                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <div className="font-sans text-[10px] tracking-wider uppercase text-ink-40">
                            {t("healthScore")}
                          </div>
                          <div className={`mt-0.5 font-sans text-2xl font-bold ${hasScore ? scoreColor(score) : "text-ink-40"}`}>
                            {hasScore ? score : t("notAudited")}
                          </div>
                        </div>
                        {hasScore && (
                          <span className="font-mono text-[10px] text-ink-40">
                            / 100
                          </span>
                        )}
                      </div>
                      {/* 3px 细条按分数着色 */}
                      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-line-soft">
                        <div
                          className={`h-full rounded-full ${hasScore ? scoreBarClass(score) : "bg-line"}`}
                          style={{ width: hasScore ? `${score}%` : "0%" }}
                        />
                      </div>

                      {/* 发丝线分隔 */}
                      <div className="hairline mt-4" />

                      {/* 指标行：追踪关键词 / 近 7 天排名 */}
                      <div className="mt-3 flex items-center justify-between">
                        <div>
                          <div className="font-sans text-[10px] uppercase tracking-wider text-ink-40">
                            {t("trackedKeywords")}
                          </div>
                          <div className="mt-0.5 font-mono text-base font-semibold text-ink">
                            {p.trackedKeywordCount.toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-sans text-[10px] uppercase tracking-wider text-ink-40">
                            {t("rank7d")}
                          </div>
                          <div className="mt-0.5 flex items-center justify-end gap-1.5 font-mono text-xs">
                            <span className="text-pos">▲ {p.rankUp7d}</span>
                            <span className="text-neg">▼ {p.rankDown7d}</span>
                          </div>
                        </div>
                      </div>

                      {/* 底部元信息 + 右箭头 */}
                      <div className="mt-4 flex items-center justify-between">
                        <span className="font-sans text-[10px] text-ink-40">
                          {t("lastAudit")} {p.lastAuditTime ? formatRelativeTime(p.lastAuditTime, locale, tc) : t("notAudited")} · {t("alertsCount")} {p.alertCount}
                        </span>
                        <span className="font-mono text-sm text-ink-40 opacity-0 group-hover:opacity-100">
                          →
                        </span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 02 图表概览（健康分横条 + 预警面积图） */}
        <section className="mt-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-40">02</span>
            <h2 className="font-display text-base font-bold text-ink">{t("overview")}</h2>
            <div className="hairline flex-1" />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <ChartCard
              title={t("healthByProject")}
              subtitle={t("healthByProjectSub")}
              height={Math.max(220, healthData.length * 32 + 80)}
              className="lg:col-span-7"
            >
              <HealthScoreBars data={healthData} />
            </ChartCard>
            <ChartCard
              title={t("alerts7d")}
              subtitle={t("alerts7dSub", { count: alerts.length })}
              height={260}
              className="lg:col-span-5"
            >
              <AlertAreaChart data={alertAreaData} />
            </ChartCard>
          </div>
        </section>

        {/* 03 预警提醒 */}
        <section className="mt-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-40">03</span>
            <h2 className="font-display text-base font-bold text-ink">{t("alertsSection")}</h2>
            <div className="hairline flex-1" />
            <span
              className="font-sans text-[10px] font-bold tracking-wider text-brand"
              style={{ border: "1px solid currentColor", borderRadius: 3, padding: "2px 6px" }}
            >
              {tc("rankChange")}
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="card-a mt-4 p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line font-mono text-2xl text-ink-40">
                  ✓
                </div>
                <div className="mt-3 font-sans text-sm font-medium text-ink">
                  {t("noAlertsTitle")}
                </div>
              </div>
            </div>
          ) : (
            <div className="card-a mt-4 overflow-hidden">
              {alerts.map((a, idx) => (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 px-5 py-3.5 hover:bg-[#FBFAF4] ${
                    idx !== alerts.length - 1 ? "border-b border-line-soft" : ""
                  }`}
                >
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${alertDotColor[a.level]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-sans text-sm text-ink">{a.title}</div>
                    <div className="font-sans text-[10px] text-ink-40">
                      {a.domain ?? "—"} · {formatRelativeTime(a.created_at, locale, tc)}
                    </div>
                  </div>
                  <span className={alertBadgeClass[a.level]}>
                    {t(a.level === "error" ? "alertError" : a.level === "warning" ? "alertWarning" : "alertInfo")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 新建项目模态框 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("createTitle")}
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="btn-secondary"
            >
              {tc("cancel")}
            </button>
            <button
              type="submit"
              form="new-project-form"
              disabled={creating}
              className="btn-primary"
            >
              {creating ? t("creating") : t("createCta")}
            </button>
          </>
        }
      >
        <form id="new-project-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="font-sans text-xs text-ink-60">{t("projectName")}</label>
            <input
              name="name"
              type="text"
              required
              placeholder={t("projectNamePlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <div>
            <label className="font-sans text-xs text-ink-60">{t("domain")}</label>
            <input
              name="domain"
              type="text"
              required
              placeholder="example.com"
              className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <p className="mt-1.5 font-sans text-[10px] text-ink-40">
              {t("domainHint")}
            </p>
          </div>
        </form>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t("deleteTitle")}
        footer={
          <>
            <button
              onClick={() => setDeleteTarget(null)}
              className="btn-secondary"
            >
              {tc("cancel")}
            </button>
            <button
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={deleting || !canSubmitDelete(deleteTarget)}
              className="btn-primary"
              style={{ backgroundColor: "var(--color-neg)", color: "#fff" }}
            >
              {deleting ? t("deleting") : t("deleteCta")}
            </button>
          </>
        }
      >
        <p className="font-sans text-sm text-ink-60">
          {t("deleteConfirm", { name: deleteTarget?.name ?? "", domain: deleteTarget?.domain ?? "" })}
        </p>
        {/* 最终核对：完整项目 UUID（与 DELETE 请求 ?id= 参数一致） */}
        <p className="mt-1.5 font-mono text-[11px] break-all text-ink-40">
          ID: {deleteTarget?.id}
        </p>
        <p className="mt-2 font-sans text-xs text-ink-40">
          {t("deleteNote")}
        </p>
      </Modal>

      <Toast />
    </div>
  );
}

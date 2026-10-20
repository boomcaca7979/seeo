"use client";

// ===== 工作台首页头部（/app 第一层）=====
// 与 /app/audit 共用同一排布：日期/数据更新时间 → 页面标题 + 操作入口 → 元信息条。
// 现有入口一个不少：新建项目（共享创建流程）、行动中心、增长机会、运行审计。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { isAuthEnabled } from "@/lib/auth-config";
import { useCreateProject } from "@/components/dashboard/CreateProjectContext";
import PageHeader from "@/components/viz/PageHeader";

function useTodayLabel(locale: "en" | "zh"): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const d = new Date();
    const intl = locale === "zh" ? "zh-CN" : "en-US";
    const datePart = d.toLocaleDateString(intl, { year: "numeric", month: "long", day: "numeric" });
    const weekday = d.toLocaleDateString(intl, { weekday: "long" });
    const id = window.setTimeout(() => setLabel(`${datePart} · ${weekday}`), 0);
    return () => window.clearTimeout(id);
  }, [locale]);
  return label;
}

export interface WorkspaceHeaderProps {
  displayName: string;
  projectCount: number;
  auditedCount: number;
  /** 未读预警数（右上角入口保留原有语义） */
  unreadAlertCount: number;
}

export default function WorkspaceHeader({
  displayName,
  projectCount,
  auditedCount,
  unreadAlertCount,
}: WorkspaceHeaderProps) {
  const t = useTranslations("dashboard.projectList");
  const tw = useTranslations("dashboard.workspace");
  const ts = useTranslations("dashboard.sidebar");
  const locale = useLocale() as "en" | "zh";
  const todayLabel = useTodayLabel(locale);
  const { openCreateProject } = useCreateProject();

  return (
    <div className="dash-container px-6 pt-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2 font-sans text-xs text-ink-40">
        <span>{todayLabel || "\u00A0"}</span>
        <span>{isAuthEnabled ? t("dataUpdatedAt") : t("dataUpdatedAtDemo")}</span>
      </div>

      <PageHeader
        title={t("greeting", { name: displayName })}
        subtitle={tw("subtitle")}
        actions={
          <>
            <button onClick={openCreateProject} className="btn-primary">
              <span className="text-base leading-none">＋</span>
              {t("newProject")}
            </button>
            <Link href="/app/audit" className="btn-secondary">
              {ts("audit")}
            </Link>
            <Link href="/app/actions" className="btn-secondary">
              {ts("actions")}
            </Link>
            <Link href="/app/opportunities" className="btn-secondary">
              {ts("opportunities")}
            </Link>
          </>
        }
        meta={
          <>
            <span>{tw("metaProjects", { n: projectCount })}</span>
            <span>·</span>
            <span>{tw("metaAudited", { n: auditedCount })}</span>
            <span>·</span>
            <span>{t("alertsCount")} {unreadAlertCount}</span>
          </>
        }
      />
    </div>
  );
}

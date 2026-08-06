"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import ScoreRing from "@/components/dashboard/ScoreRing";
import { TableSkeleton } from "@/components/dashboard/Skeleton";

interface IssueGroup {
  type: string;
  severity: "error" | "warning" | "notice";
  affectedPages: number;
  sampleUrl: string;
  detail: string;
  suggestion: string | null;
}

interface AuditData {
  id: number;
  domain: string;
  status: "running" | "completed" | "failed";
  pagesCrawled: number;
  healthScore: number | null;
  errors: number;
  warnings: number;
  notices: number;
  startedAt: string;
  finishedAt: string | null;
  issues: IssueGroup[];
}

const severityConfig = {
  error: { label: "错误", badge: "badge-err", dot: "bg-neg", printColor: "#B23B34" },
  warning: { label: "警告", badge: "badge-warn", dot: "bg-warn", printColor: "#8a6a00" },
  notice: { label: "提示", badge: "badge-info", dot: "bg-ink-25", printColor: "#6b7280" },
} as const;

const STORAGE_KEY = "seeo:last-audit-domain";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export default function AuditReportPrintPage() {
  const router = useRouter();
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [domain, setDomain] = useState<string>("");
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const saved = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    if (!saved) {
      // 推迟到下一帧避免 effect 同步路径 setState
      const id = window.setTimeout(() => {
        setNotFound(true);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setDomain(saved), 0);
    void (async () => {
      try {
        const res = await fetch(`/api/audit/latest?domain=${encodeURIComponent(saved)}`, { cache: "no-store" });
        const json = await res.json();
        if (res.ok) {
          if (!json.data) {
            setNotFound(true);
          } else if (json.data.status !== "completed") {
            setNotFound(true);
          } else {
            setAudit(json.data as AuditData);
          }
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
    return () => window.clearTimeout(id);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleBack = () => {
    router.push("/app/audit");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8 print:hidden">
        <TableSkeleton rows={4} />
        <div className="mt-4">
          <TableSkeleton rows={8} />
        </div>
      </div>
    );
  }

  if (notFound || !audit) {
    return (
      <div className="mx-auto max-w-3xl p-6 lg:p-8 print:hidden">
        <div className="card-a border border-dashed border-line p-12 text-center">
          <div className="font-display text-lg font-bold text-ink">
            暂无可打印的审计报告
          </div>
          <p className="mt-3 font-sans text-sm text-ink-60">
            {domain
              ? `域名 ${domain} 还没有完成的审计记录`
              : "尚未选择审计域名"}
          </p>
          <p className="mt-1 font-mono text-xs text-ink-40">
            请先到技术审计页发起一次完整审计
          </p>
          <button
            onClick={handleBack}
            className="btn-primary mt-6"
          >
            前往技术审计
          </button>
        </div>
      </div>
    );
  }

  const healthScore = audit.healthScore ?? 0;
  const scoreLevel = healthScore >= 80 ? "优秀" : healthScore >= 60 ? "及格" : "待优化";

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8 print-area">
      {/* 操作栏（打印时隐藏） */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          onClick={handleBack}
          className="btn-secondary"
        >
          ← 返回审计
        </button>
        <button
          onClick={handlePrint}
          className="btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M6 9V2h12v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <rect x="6" y="14" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          打印 / 存为 PDF
        </button>
      </div>

      {/* 报告头 */}
      <div className="card-a p-6 print-header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-xs text-ink-40 print-mono">SeeO · 技术审计报告</div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink print-title sm:text-3xl">
              {audit.domain}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-60 print-mono">
              <span>审计时间：{formatTime(audit.finishedAt ?? audit.startedAt)}</span>
              <span>·</span>
              <span>已爬取页面：{audit.pagesCrawled.toLocaleString()}</span>
              <span>·</span>
              <span>报告 ID：#{audit.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 print-score-block">
            <ScoreRing score={healthScore} size={88} thickness={8} />
            <div>
              <div className="font-display text-base font-bold text-ink print-title">健康度</div>
              <div className="font-mono text-xs text-ink-40 print-mono">{scoreLevel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 三级计数 */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-neg print-dot-error" />
            <span className="font-mono text-xs text-ink-40 print-mono">错误</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-bold text-neg print-num-error">
            {audit.errors.toLocaleString()}
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink-40 print-mono">需立即修复</div>
        </div>
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warn print-dot-warning" />
            <span className="font-mono text-xs text-ink-40 print-mono">警告</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-bold text-warn print-num-warning">
            {audit.warnings.toLocaleString()}
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink-40 print-mono">建议尽快处理</div>
        </div>
        <div className="card-a p-5 print-card">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ink-25 print-dot-notice" />
            <span className="font-mono text-xs text-ink-40 print-mono">提示</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-bold text-ink print-num-notice">
            {audit.notices.toLocaleString()}
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink-40 print-mono">可择机优化</div>
        </div>
      </div>

      {/* 问题清单 */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink print-title">
            问题清单
          </h2>
          <span className="font-mono text-xs text-ink-40 print-mono">
            共 {audit.issues.length} 类问题
          </span>
        </div>

        {audit.issues.length === 0 ? (
          <div className="card-a mt-4 border border-dashed border-line p-10 text-center">
            <div className="font-display text-base font-bold text-ink-40">未检测到问题</div>
            <p className="mt-2 font-sans text-sm text-ink-40">本次审计未发现 SEO 问题</p>
          </div>
        ) : (
          <div className="card-a mt-4 overflow-hidden print-table">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40 print-thead">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">问题类型</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">级别</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">影响页面</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">详情</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">示例 URL</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40 print-mono">修复建议</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.issues.map((issue, idx) => {
                    const cfg = severityConfig[issue.severity];
                    return (
                      <tr
                        key={`${issue.type}-${idx}`}
                        className="border-b border-line-soft print-row"
                      >
                        <td className="px-4 py-3 font-sans text-sm font-medium text-ink print-cell-title">
                          {issue.type}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`${cfg.badge} print-badge`}
                            data-severity={issue.severity}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} print-dot`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-ink print-cell">
                          {issue.affectedPages.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-sans text-xs text-ink-60 print-cell">
                          {issue.detail}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-60 print-cell">
                          <span className="block max-w-[200px] truncate" title={issue.sampleUrl}>
                            {issue.sampleUrl.replace(/^https?:\/\//, "")}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-sans text-xs text-ink-60 print-cell">
                          {issue.suggestion ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 页脚（打印时显示） */}
      <div className="mt-8 hidden border-t border-line-soft pt-4 font-mono text-[10px] text-ink-40 print-footer">
        本报告由 SeeO 自动生成 · {formatTime(audit.finishedAt ?? audit.startedAt)} · 域名 {audit.domain}
      </div>
    </div>
  );
}

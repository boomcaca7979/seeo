// 审计报告模板（用于 PDF 渲染）

import { useTranslations, useLocale } from "next-intl";
import { formatNumber } from "@/lib/ui-locale";

export interface AuditReportProps {
  projectName: string;
  domain: string;
  healthScore: number;
  issues: Array<{ type: string; severity: string; url: string; detail: string; suggestion: string }>;
  coverage: Array<{ id: string; name: string; passed: boolean }>;
  generatedAt: string;
}

const COLORS = {
  bg: "#F6F4EC",
  card: "#FFFFFF",
  ink: "#14121A",
  ink60: "#5A5563",
  ink40: "#8E8898",
  line: "#E6E2D6",
  brand: "#E8B84A",
  pos: "#21D19F",
  warn: "#C98A0A",
  neg: "#E14B4B",
};

const cardStyle: React.CSSProperties = {
  background: COLORS.card,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  padding: 16,
};

const severityColor = (s: string): string => {
  if (s === "error") return COLORS.neg;
  if (s === "warning") return COLORS.warn;
  return COLORS.ink40;
};

export default function AuditReport({ projectName, domain, healthScore, issues, coverage, generatedAt }: AuditReportProps) {
  const t = useTranslations("dashboard.pdf.audit");
  const locale = useLocale() as "en" | "zh";
  const severityLabel = (s: string): string => {
    if (s === "error") return t("severityError");
    if (s === "warning") return t("severityWarning");
    return t("severityNotice");
  };
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const notices = issues.filter((i) => i.severity === "notice" || i.severity === "info").length;
  const passedCount = coverage.filter((c) => c.passed).length;
  const scoreColor = healthScore >= 80 ? COLORS.pos : healthScore >= 60 ? COLORS.warn : COLORS.neg;

  return (
    <div
      id="report-content"
      style={{
        background: COLORS.bg,
        color: COLORS.ink,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 40,
        minWidth: 720,
      }}
    >
      {/* 封面 */}
      <div style={{ borderBottom: `2px solid ${COLORS.ink}`, paddingBottom: 16, marginBottom: 24 }}>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40 }}>{t("docLabel")}</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px" }}>{projectName}</h1>
        <div style={{ fontSize: 13, color: COLORS.ink60 }}>{domain}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40, marginTop: 4 }}>
          {t("generatedAt", { time: generatedAt })}
        </div>
      </div>

      {/* 健康分 + 统计 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 12, marginBottom: 24 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("healthScore")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 42, fontWeight: 700, color: scoreColor, marginTop: 4 }}>
            {healthScore}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>/ 100</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <SummaryCard label={t("summaryErrors")} value={formatNumber(errors, locale)} color={COLORS.neg} />
          <SummaryCard label={t("summaryWarnings")} value={formatNumber(warnings, locale)} color={COLORS.warn} />
          <SummaryCard label={t("summaryNotices")} value={formatNumber(notices, locale)} color={COLORS.ink60} />
        </div>
      </div>

      {/* 问题清单 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("issuesTitle", { count: issues.length })}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.line}`, textAlign: "left" }}>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thSeverity")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thType")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thUrl")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thDetail")}</th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 16, textAlign: "center", color: COLORS.pos }}>
                  {t("noIssues")}
                </td>
              </tr>
            ) : (
              issues.slice(0, 50).map((issue, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <td style={{ padding: "8px 6px", color: severityColor(issue.severity), fontWeight: 600 }}>
                    {severityLabel(issue.severity)}
                  </td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10 }}>{issue.type}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {issue.url}
                  </td>
                  <td style={{ padding: "8px 6px", fontSize: 11 }}>{issue.detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 检查项覆盖 */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          {t("coverageTitle", { passed: passedCount, total: coverage.length })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {coverage.map((c) => (
            <div
              key={c.id}
              style={{
                border: `1px solid ${COLORS.line}`,
                borderRadius: 6,
                padding: "6px 8px",
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: c.passed ? COLORS.pos : COLORS.neg, fontWeight: 700 }}>
                  {c.passed ? "✓" : "✗"}
                </span>
                <span style={{ fontWeight: 500, fontSize: 10 }}>{c.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, fontFamily: "monospace", fontSize: 10, color: COLORS.ink40, textAlign: "center" }}>
        {t("footer")}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color = COLORS.ink }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center" }}>
      <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

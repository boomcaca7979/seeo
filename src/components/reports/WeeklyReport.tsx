// 综合周报模板（用于 PDF 渲染）

import { useTranslations, useLocale } from "next-intl";
import { formatNumber } from "@/lib/ui-locale";

export interface WeeklyReportProps {
  projectName: string;
  period: string;
  rankSummary: { up: number; down: number; out: number; total: number };
  auditSummary: { avgScore: number | null; count: number };
  keywordSummary: { total: number; active: number };
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

export default function WeeklyReport({
  projectName,
  period,
  rankSummary,
  auditSummary,
  keywordSummary,
  generatedAt,
}: WeeklyReportProps) {
  const t = useTranslations("dashboard.pdf.weekly");
  const locale = useLocale() as "en" | "zh";
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
        <div style={{ fontSize: 13, color: COLORS.ink60 }}>{period}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40, marginTop: 4 }}>
          {t("generatedAt", { time: generatedAt })}
        </div>
      </div>

      {/* 执行摘要 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("keywordsTotal")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: COLORS.ink, marginTop: 4 }}>
            {formatNumber(keywordSummary.total, locale)}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, marginTop: 2 }}>
            {t("activeCount", { count: formatNumber(keywordSummary.active, locale) })}
          </div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("rankChange")}</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 8 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.pos }}>{rankSummary.up}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>{t("up")}</div>
            </div>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.neg }}>{rankSummary.down}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>{t("down")}</div>
            </div>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.ink40 }}>{rankSummary.out}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>{t("out")}</div>
            </div>
          </div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("auditAvg")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: auditSummary.avgScore !== null ? (auditSummary.avgScore >= 80 ? COLORS.pos : auditSummary.avgScore >= 60 ? COLORS.warn : COLORS.neg) : COLORS.ink40, marginTop: 4 }}>
            {auditSummary.avgScore ?? "—"}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, marginTop: 2 }}>
            {t("auditCount", { count: auditSummary.count })}
          </div>
        </div>
      </div>

      {/* 排名变化明细 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("rankDetailTitle")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <SummaryItem label={t("detailTotal")} value={rankSummary.total} color={COLORS.ink} />
          <SummaryItem label={t("detailUp")} value={rankSummary.up} color={COLORS.pos} />
          <SummaryItem label={t("detailDown")} value={rankSummary.down} color={COLORS.neg} />
          <SummaryItem label={t("detailOut")} value={rankSummary.out} color={COLORS.warn} />
        </div>
      </div>

      {/* 审计摘要 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("auditSummaryTitle")}</div>
        <div style={{ fontSize: 12, color: COLORS.ink60, lineHeight: 1.8 }}>
          {t.rich("auditSummaryText", {
            count: auditSummary.count,
            strong: (chunks) => <strong style={{ color: COLORS.ink }}>{chunks}</strong>,
          })}
          {auditSummary.avgScore !== null ? (
            t.rich("auditSummaryScore", {
              score: auditSummary.avgScore,
              strong: (chunks) => <strong style={{ color: auditSummary.avgScore !== null && auditSummary.avgScore >= 80 ? COLORS.pos : auditSummary.avgScore !== null && auditSummary.avgScore >= 60 ? COLORS.warn : COLORS.neg }}>{chunks}</strong>,
            })
          ) : (
            t("auditSummaryNone")
          )}
        </div>
      </div>

      {/* 关键词概况 */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("keywordOverviewTitle")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <SummaryItem label={t("overviewTotal")} value={keywordSummary.total} color={COLORS.ink} />
          <SummaryItem label={t("overviewActive")} value={keywordSummary.active} color={COLORS.pos} />
        </div>
      </div>

      <div style={{ marginTop: 24, fontFamily: "monospace", fontSize: 10, color: COLORS.ink40, textAlign: "center" }}>
        {t("footer", { period })}
      </div>
    </div>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number; color: string }) {
  const locale = useLocale() as "en" | "zh";
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>
        {formatNumber(value, locale)}
      </div>
    </div>
  );
}

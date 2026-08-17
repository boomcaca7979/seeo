// 排名报告模板（用于 PDF 渲染，使用内联样式确保 html2canvas 正确渲染）

import { useTranslations, useLocale } from "next-intl";
import { formatNumber } from "@/lib/ui-locale";

export interface RankingReportProps {
  projectName: string;
  domain: string;
  keywords: Array<{
    keyword: string;
    todayPosition: number | null;
    lastPosition: number | null;
    change: number | null;
    targetUrl: string | null;
  }>;
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
  neg: "#E14B4B",
};

const cardStyle: React.CSSProperties = {
  background: COLORS.card,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  padding: 16,
};

export default function RankingReport({ projectName, domain, keywords, generatedAt }: RankingReportProps) {
  const t = useTranslations("dashboard.pdf.ranking");
  const locale = useLocale() as "en" | "zh";
  const total = keywords.length;
  const top3 = keywords.filter((k) => k.todayPosition !== null && k.todayPosition <= 3).length;
  const top10 = keywords.filter((k) => k.todayPosition !== null && k.todayPosition <= 10).length;
  const top100 = keywords.filter((k) => k.todayPosition !== null && k.todayPosition <= 100).length;
  const positions = keywords
    .map((k) => k.todayPosition)
    .filter((p): p is number => p !== null);
  const avg = positions.length > 0 ? Math.round(positions.reduce((s, p) => s + p, 0) / positions.length) : null;

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

      {/* 摘要卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 24 }}>
        <SummaryCard label={t("summaryTracked")} value={formatNumber(total, locale)} />
        <SummaryCard label="Top 3" value={formatNumber(top3, locale)} color={COLORS.pos} />
        <SummaryCard label="Top 10" value={formatNumber(top10, locale)} color={COLORS.pos} />
        <SummaryCard label="Top 100" value={formatNumber(top100, locale)} />
        <SummaryCard label={t("summaryAvg")} value={avg !== null ? formatNumber(avg, locale) : "—"} color={avg !== null && avg <= 10 ? COLORS.pos : COLORS.ink} />
      </div>

      {/* 详细表格 */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("detailTitle")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.line}`, textAlign: "left" }}>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thKeyword")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thCurrent")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thLast")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thChange")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thTargetUrl")}</th>
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, textAlign: "center", color: COLORS.ink40 }}>
                  {t("empty")}
                </td>
              </tr>
            ) : (
              keywords.map((k, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <td style={{ padding: "8px 6px", fontWeight: 500 }}>{k.keyword}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{k.todayPosition ?? "—"}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", color: COLORS.ink60 }}>{k.lastPosition ?? "—"}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", color: k.change === null ? COLORS.ink40 : k.change > 0 ? COLORS.pos : k.change < 0 ? COLORS.neg : COLORS.ink60 }}>
                    {k.change === null ? "—" : k.change > 0 ? `↑${k.change}` : k.change < 0 ? `↓${Math.abs(k.change)}` : t("changeFlat")}
                  </td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {k.targetUrl ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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

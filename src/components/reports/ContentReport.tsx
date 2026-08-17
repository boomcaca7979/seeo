// 内容检查报告模板（用于 PDF 渲染）

import { useTranslations, useLocale } from "next-intl";
import { formatNumber } from "@/lib/ui-locale";

export interface ContentReportProps {
  projectName: string;
  url: string;
  contentScore: number;
  readabilityScore: number;
  readabilityLevel: string;
  wordCount: number;
  keywordDensity: Array<{ keyword: string; count: number; density: number }>;
  titleSuggestions: string[];
  headingStructure: Array<{ level: number; text: string }>;
  topKeywords: Array<{ word: string; count: number }>;
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

export default function ContentReport({
  projectName,
  url,
  contentScore,
  readabilityScore,
  readabilityLevel,
  wordCount,
  keywordDensity,
  titleSuggestions,
  headingStructure,
  topKeywords,
  generatedAt,
}: ContentReportProps) {
  const t = useTranslations("dashboard.pdf.content");
  const locale = useLocale() as "en" | "zh";
  const scoreColor = contentScore >= 80 ? COLORS.pos : contentScore >= 60 ? COLORS.warn : COLORS.neg;
  const readColor = readabilityScore >= 80 ? COLORS.pos : readabilityScore >= 60 ? COLORS.warn : COLORS.neg;

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
        <div style={{ fontSize: 13, color: COLORS.ink60 }}>{url}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40, marginTop: 4 }}>
          {t("generatedAt", { time: generatedAt })}
        </div>
      </div>

      {/* 评分 + 可读性 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("contentScore")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 700, color: scoreColor, marginTop: 4 }}>
            {contentScore}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>/ 100</div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("readability")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 700, color: readColor, marginTop: 4 }}>
            {readabilityScore}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, marginTop: 2 }}>{readabilityLevel}</div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("wordCount")}</div>
          <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 700, color: COLORS.ink, marginTop: 4 }}>
            {formatNumber(wordCount, locale)}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("wordCountUnit")}</div>
        </div>
      </div>

      {/* 关键词密度 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("densityTitle")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.line}`, textAlign: "left" }}>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thKeyword")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thCount")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thDensity")}</th>
              <th style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>{t("thStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {keywordDensity.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 16, textAlign: "center", color: COLORS.ink40 }}>
                  {t("empty")}
                </td>
              </tr>
            ) : (
              keywordDensity.map((item, idx) => {
                const status = item.density >= 2 && item.density <= 5 ? t("statusIdeal") : item.density > 5 ? t("statusOveruse") : t("statusLow");
                const statusColor = item.density >= 2 && item.density <= 5 ? COLORS.pos : item.density > 5 ? COLORS.warn : COLORS.ink40;
                return (
                  <tr key={idx} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <td style={{ padding: "8px 6px", fontWeight: 500 }}>{item.keyword}</td>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{item.count}</td>
                    <td style={{ padding: "8px 6px", fontFamily: "monospace", fontWeight: 700 }}>{item.density}%</td>
                    <td style={{ padding: "8px 6px", color: statusColor }}>{status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 标题建议 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("titleSuggestions")}</div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {titleSuggestions.map((s, idx) => (
            <li key={idx} style={{ padding: "6px 0", borderBottom: `1px solid ${COLORS.line}`, fontSize: 12, display: "flex", gap: 8 }}>
              <span style={{ color: s.includes("良好") ? COLORS.pos : COLORS.warn, fontWeight: 700 }}>
                {s.includes("良好") ? "✓" : "•"}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 标题结构 + 高频词 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("headingStructure")}</div>
          {headingStructure.length === 0 ? (
            <div style={{ padding: 12, textAlign: "center", color: COLORS.ink40, fontSize: 11 }}>{t("emptyHeadings")}</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {headingStructure.map((h, idx) => (
                <li key={idx} style={{ padding: "4px 0", fontSize: 11, display: "flex", gap: 6, paddingLeft: (h.level - 1) * 12 }}>
                  <span style={{ fontFamily: "monospace", color: COLORS.brand, fontWeight: 700 }}>H{h.level}</span>
                  <span style={{ color: COLORS.ink60 }}>{h.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("topWords")}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <tbody>
              {topKeywords.length === 0 ? (
                <tr>
                  <td style={{ padding: 12, textAlign: "center", color: COLORS.ink40 }}>{t("emptyTopWords")}</td>
                </tr>
              ) : (
                topKeywords.map((k, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace", color: COLORS.ink40, width: 24 }}>
                      {String(idx + 1).padStart(2, "0")}
                    </td>
                    <td style={{ padding: "4px 6px", fontWeight: 500 }}>{k.word}</td>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace", color: COLORS.ink60, textAlign: "right" }}>
                      {k.count}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 24, fontFamily: "monospace", fontSize: 10, color: COLORS.ink40, textAlign: "center" }}>
        {t("footer")}
      </div>
    </div>
  );
}

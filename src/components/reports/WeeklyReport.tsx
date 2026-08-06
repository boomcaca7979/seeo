// 综合周报模板（用于 PDF 渲染）

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
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40 }}>SeeO · 综合周报</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px" }}>{projectName}</h1>
        <div style={{ fontSize: 13, color: COLORS.ink60 }}>{period}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.ink40, marginTop: 4 }}>
          生成时间：{generatedAt}
        </div>
      </div>

      {/* 执行摘要 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>关键词总数</div>
          <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: COLORS.ink, marginTop: 4 }}>
            {keywordSummary.total.toLocaleString()}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, marginTop: 2 }}>
            活跃 {keywordSummary.active.toLocaleString()}
          </div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>本周排名变化</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 8 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.pos }}>{rankSummary.up}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>上升</div>
            </div>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.neg }}>{rankSummary.down}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>下降</div>
            </div>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: COLORS.ink40 }}>{rankSummary.out}</div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>出榜</div>
            </div>
          </div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink40 }}>审计平均分</div>
          <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: auditSummary.avgScore !== null ? (auditSummary.avgScore >= 80 ? COLORS.pos : auditSummary.avgScore >= 60 ? COLORS.warn : COLORS.neg) : COLORS.ink40, marginTop: 4 }}>
            {auditSummary.avgScore ?? "—"}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.ink60, marginTop: 2 }}>
            共 {auditSummary.count} 次审计
          </div>
        </div>
      </div>

      {/* 排名变化明细 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>排名变化明细</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <SummaryItem label="追踪关键词总数" value={rankSummary.total} color={COLORS.ink} />
          <SummaryItem label="本周上升" value={rankSummary.up} color={COLORS.pos} />
          <SummaryItem label="本周下降" value={rankSummary.down} color={COLORS.neg} />
          <SummaryItem label="跌出 Top 100" value={rankSummary.out} color={COLORS.warn} />
        </div>
      </div>

      {/* 审计摘要 */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>审计摘要</div>
        <div style={{ fontSize: 12, color: COLORS.ink60, lineHeight: 1.8 }}>
          本周共执行 <strong style={{ color: COLORS.ink }}>{auditSummary.count}</strong> 次技术审计。
          {auditSummary.avgScore !== null ? (
            <>平均健康分 <strong style={{ color: auditSummary.avgScore >= 80 ? COLORS.pos : auditSummary.avgScore >= 60 ? COLORS.warn : COLORS.neg }}>{auditSummary.avgScore}</strong> 分。</>
          ) : (
            "本周暂无已完成的审计。"
          )}
        </div>
      </div>

      {/* 关键词概况 */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>关键词概况</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <SummaryItem label="总关键词数" value={keywordSummary.total} color={COLORS.ink} />
          <SummaryItem label="有排名的关键词" value={keywordSummary.active} color={COLORS.pos} />
        </div>
      </div>

      <div style={{ marginTop: 24, fontFamily: "monospace", fontSize: 10, color: COLORS.ink40, textAlign: "center" }}>
        本报告由 SeeO 自动生成 · 数据周期 {period}
      </div>
    </div>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: COLORS.ink40 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

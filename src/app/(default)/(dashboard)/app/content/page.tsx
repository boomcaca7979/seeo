"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import ScoreRing from "@/components/dashboard/ScoreRing";
import DomainSelect from "@/components/dashboard/DomainSelect";
import { formatNumber, intlLocale, type Locale } from "@/lib/ui-locale";

interface CheckItem {
  name: string;
  passed: boolean;
  current: string;
  suggested: string;
}

interface KeywordAnalysisData {
  keyword: string;
  inTitle: boolean;
  inH1: boolean;
  inMetaDescription: boolean;
  inBody: boolean;
  density: number;
  occurrences: number;
}

interface KeywordDensityItem {
  keyword: string;
  count: number;
  density: number;
}

interface HeadingItem {
  level: number;
  text: string;
}

interface TopKeywordItem {
  word: string;
  count: number;
}

interface ContentAnalysisResult {
  wordCount: number;
  readabilityScore: number;
  readabilityLevel: string;
  keywordDensity: KeywordDensityItem[];
  headingStructure: HeadingItem[];
  internalLinksCount: number;
  externalLinksCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  metaTitleLength: number;
  metaDescriptionLength: number;
  first100Words: string;
  topKeywords: TopKeywordItem[];
  titleSuggestions: string[];
  contentScore: number;
}

interface ContentHistoryComparison {
  current: { contentScore: number; wordCount: number; checkedAt: string };
  previous: { contentScore: number; wordCount: number; checkedAt: string } | null;
  scoreChange: number;
  wordCountChange: number;
  readabilityChange: number;
  newSuggestions: string[];
  resolvedSuggestions: string[];
}

interface CheckResult {
  url: string;
  finalUrl: string;
  keyword: string;
  score: number;
  wordCount: number;
  density: number;
  checks: CheckItem[];
  keywordAnalysis: KeywordAnalysisData;
  responseTimeMs: number;
  analysis: ContentAnalysisResult;
  comparison: ContentHistoryComparison | null;
  historyId: number | null;
}

interface HistoryRow {
  id: number;
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  created_at: string;
  content_score: number | null;
  readability_score: number | null;
  readability_level: string | null;
  comparison: string | null;
}

function formatTime(
  iso: string | null,
  locale: Locale,
  tc: (key: "justNow" | "minutesAgo" | "hoursAgo", values?: { n: number }) => string
): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return tc("justNow");
    if (diff < 3_600_000) return tc("minutesAgo", { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return tc("hoursAgo", { n: Math.floor(diff / 3_600_000) });
    return d.toLocaleString(intlLocale(locale), { hour12: false });
  } catch {
    return iso;
  }
}

function scoreColorClass(score: number): string {
  if (score >= 80) return "text-pos";
  if (score >= 60) return "text-warn";
  return "text-neg";
}

function densityBadge(density: number): { key: "densityIdeal" | "densityHigh" | "densityLow"; cls: string } {
  if (density >= 2 && density <= 5) return { key: "densityIdeal", cls: "badge-pos" };
  if (density > 5) return { key: "densityHigh", cls: "badge-warn" };
  return { key: "densityLow", cls: "badge-info" };
}

function suggestionType(text: string): { key: "sugGood" | "sugAdvice" | "sugHint"; cls: string } {
  if (text.includes("良好") || text.includes("正确")) return { key: "sugGood", cls: "badge-pos" };
  if (text.includes("过长") || text.includes("过短") || text.includes("未包含") || text.includes("缺少")) {
    return { key: "sugAdvice", cls: "badge-warn" };
  }
  return { key: "sugHint", cls: "badge-info" };
}

export default function ContentPage() {
  const t = useTranslations("dashboard.content");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as Locale;
  const { show, Toast } = useToast();
  const [url, setUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [targetKeywordsInput, setTargetKeywordsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/content/check");
      const json = await res.json();
      if (res.ok) setHistory(json.data ?? []);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void loadHistory();
  }, [loadHistory]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      show(t("errUrl"), "error");
      return;
    }
    const targetKeywords = targetKeywordsInput
      .split(/[,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (targetKeywords.length === 0) {
      show(t("errKeywords"), "error");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/content/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          keyword: targetKeywords[0],
          targetKeywords,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("checkFailed"));
        setError(message);
        show(message, "error");
        return;
      }
      setResult(json.data);
      show(t("analysisDone", { score: json.data.analysis.contentScore }), "success");
      await loadHistory();
    } catch (err) {
      const msg = `${tc("networkError")} ${(err as Error).message}`;
      setError(msg);
      show(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const hasResult = result !== null;
  const analysis = result?.analysis;
  const comparison = result?.comparison;
  const contentScore = analysis?.contentScore ?? 0;
  const readabilityLevel = analysis?.readabilityLevel ?? t("readabilityDefault");
  const readabilityScore = analysis?.readabilityScore ?? 0;

  const maxTopCount = analysis
    ? Math.max(...analysis.topKeywords.map((k) => k.count), 1)
    : 1;

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t("title")}
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-2 font-sans text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* URL 输入区 */}
      <form
        onSubmit={handleAnalyze}
        className="card-a mt-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="font-mono text-xs text-ink-40">{t("urlLabel")}</label>
          <DomainSelect
            value={domain}
            onChange={(d) => {
              setDomain(d);
              setUrl(`https://${d}`);
            }}
            placeholder={t("domainPlaceholder")}
            className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/blog/post-1"
            className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="font-mono text-xs text-ink-40">{t("keywordsLabel")}</label>
          <input
            type="text"
            value={targetKeywordsInput}
            onChange={(e) => setTargetKeywordsInput(e.target.value)}
            placeholder={t("keywordsPlaceholder")}
            className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <div className="flex-shrink-0">
          {history.length > 0 && (
            <select
              className="rounded-md border border-line bg-card px-3 py-2 font-mono text-xs text-ink-60 focus:border-ink-25 focus:outline-none"
              onChange={(e) => {
                const h = history.find((x) => x.id === Number(e.target.value));
                if (h) {
                  setUrl(h.url);
                  setTargetKeywordsInput(h.keyword);
                }
              }}
              value=""
            >
              <option value="">{t("historySelect")}</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.url.slice(0, 40)} · {h.keyword}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary disabled:opacity-60"
        >
          {loading ? t("analyzingBtn") : t("analyzeBtn")}
        </button>
      </form>

      {/* 加载骨架 */}
      {loading && (
        <div className="mt-6 space-y-4">
          <TableSkeleton rows={4} />
          <TableSkeleton rows={6} />
        </div>
      )}

      {/* 错误提示 */}
      {!loading && error && (
        <div className="card-a mt-6 border-neg/30 p-6 text-center">
          <div className="font-display text-base font-semibold text-neg">{t("errorTitle")}</div>
          <p className="mt-2 font-sans text-sm text-ink-60">{error}</p>
          <p className="mt-1 font-mono text-xs text-ink-40">{t("errorHint")}</p>
        </div>
      )}

      {/* 结果区 */}
      {!loading && hasResult && result && analysis && (
        <>
          {/* 内容评分卡 */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="card-a flex flex-col items-center justify-center p-6 lg:col-span-4">
              <ScoreRing score={contentScore} size={140} thickness={10} showLabel />
              <div className="mt-3 font-display text-base font-semibold text-ink">
                {t("contentScore")}
              </div>
              <div className="mt-2">
                {readabilityScore >= 80 ? (
                  <span className="badge-pos">{readabilityLevel}</span>
                ) : readabilityScore >= 60 ? (
                  <span className="badge-warn">{readabilityLevel}</span>
                ) : (
                  <span className="badge-err">{readabilityLevel}</span>
                )}
              </div>
              {comparison ? (
                <div className="mt-2 font-mono text-xs">
                  {comparison.previous === null ? (
                    <span className="badge-info">{t("firstAnalysis")}</span>
                  ) : (
                    <>
                      <span className={comparison.scoreChange >= 0 ? "text-pos" : "text-neg"}>
                        {comparison.scoreChange >= 0 ? "↑" : "↓"} {t("pointsUnit", { n: Math.abs(comparison.scoreChange) })}
                      </span>
                      <span className="ml-2 text-ink-40">
                        {t("wordsChange", {
                          n: `${comparison.wordCountChange >= 0 ? "+" : ""}${formatNumber(comparison.wordCountChange, locale)}`,
                        })}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-2 font-mono text-xs text-ink-40">{t("basedOnReal")}</div>
              )}
            </div>

            {/* 统计卡网格 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-8">
              <StatCard label={t("statWords")} value={formatNumber(analysis.wordCount, locale)} />
              <StatCard
                label={t("statReadability")}
                value={`${analysis.readabilityScore}`}
                sub={analysis.readabilityLevel}
                valueClass={scoreColorClass(analysis.readabilityScore)}
              />
              <StatCard label={t("statInternal")} value={formatNumber(analysis.internalLinksCount, locale)} />
              <StatCard label={t("statExternal")} value={formatNumber(analysis.externalLinksCount, locale)} />
              <StatCard
                label={t("statImages")}
                value={formatNumber(analysis.imagesCount, locale)}
                sub={analysis.imagesWithoutAlt > 0 ? t("imagesMissingAlt", { n: analysis.imagesWithoutAlt }) : t("imagesAllAlt")}
                subClass={analysis.imagesWithoutAlt > 0 ? "text-neg" : "text-pos"}
              />
              <StatCard
                label="Meta"
                value={`${analysis.metaTitleLength}/${analysis.metaDescriptionLength}`}
                sub={t("statMetaSub")}
                valueClass={
                  analysis.metaTitleLength >= 30 && analysis.metaTitleLength <= 60
                    ? "text-pos"
                    : "text-warn"
                }
              />
            </div>
          </div>

          {/* 关键词密度 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("kwTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {analysis.keywordDensity.length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-ink-40">
                  {t("kwEmpty")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line-soft bg-line-soft/40">
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thKeyword")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thOccurrences")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thDensity")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.keywordDensity.map((item) => {
                        const badge = densityBadge(item.density);
                        return (
                          <tr key={item.keyword} className="border-b border-line-soft">
                            <td className="px-4 py-3 font-sans text-sm font-medium text-ink">{item.keyword}</td>
                            <td className="px-4 py-3 font-mono text-sm text-ink-60">{formatNumber(item.count, locale)}</td>
                            <td className="px-4 py-3 font-mono text-sm font-semibold text-ink">{item.density}%</td>
                            <td className="px-4 py-3">
                              <span className={badge.cls}>{t(badge.key)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* 标题建议 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("sugTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <ul className="space-y-2">
                {analysis.titleSuggestions.map((suggestion, idx) => {
                  const resolved = comparison?.resolvedSuggestions.includes(suggestion);
                  const type = suggestionType(suggestion);
                  return (
                    <li key={idx} className="flex items-start gap-3">
                      <span className={type.cls}>{t(type.key)}</span>
                      <span
                        className={`flex-1 font-sans text-sm ${
                          resolved ? "text-ink-40 line-through" : "text-ink"
                        }`}
                      >
                        {suggestion}
                      </span>
                      {resolved && <span className="badge-pos">{t("resolved")}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* 标题结构 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("headTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {!analysis.headingStructure.some((h) => h.level === 1) && (
                <div className="mb-3">
                  <span className="badge-err">{t("missingH1")}</span>
                </div>
              )}
              {!analysis.headingStructure.some((h) => h.level === 2) && (
                <div className="mb-3">
                  <span className="badge-warn">{t("addH2")}</span>
                </div>
              )}
              {analysis.headingStructure.length === 0 ? (
                <div className="py-4 text-center font-mono text-xs text-ink-40">
                  {t("noHeadings")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {analysis.headingStructure.map((heading, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2"
                      style={{ paddingLeft: `${(heading.level - 1) * 1.5}rem` }}
                    >
                      <span className="badge-info">H{heading.level}</span>
                      <span className="flex-1 font-sans text-sm text-ink-60">{heading.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 高频词 TOP 10 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("topTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {analysis.topKeywords.length === 0 ? (
                <div className="py-4 text-center font-mono text-xs text-ink-40">
                  {t("topEmpty")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {analysis.topKeywords.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <span className="w-6 flex-shrink-0 font-mono text-xs text-ink-40">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="w-32 flex-shrink-0 truncate font-sans text-sm font-medium text-ink">
                        {item.word}
                      </span>
                      <div className="flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-line-soft">
                          <div
                            className="h-full rounded-full bg-brand/60"
                            style={{ width: `${(item.count / maxTopCount) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-12 flex-shrink-0 text-right font-mono text-xs text-ink-60">
                        {item.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 内容预览 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("previewTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <p className="font-sans text-sm leading-relaxed text-ink-60">
                {analysis.first100Words || t("previewEmpty")}
              </p>
            </div>
          </div>

          {/* 历史对比 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("cmpTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            {!comparison || comparison.previous === null ? (
              <div className="card-a mt-4 p-6 text-center">
                <span className="badge-info">{t("firstAnalysis")}</span>
                <p className="mt-2 font-mono text-xs text-ink-40">
                  {t("cmpEmpty")}
                </p>
              </div>
            ) : (
              <HistoryComparisonView comparison={comparison} />
            )}
          </div>

          {/* SEO 检测清单（保留原有） */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-ink">{t("checklistTitle")}</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <p className="font-mono text-xs text-ink-40">{t("realFetch", { url: result.finalUrl })}</p>
              <div className="mt-4 divide-y divide-line-soft">
                {result.checks.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 py-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                        item.passed ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"
                      }`}
                    >
                      {item.passed ? "✓" : "✗"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-sm font-medium text-ink">{item.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs">
                        <span className="text-ink-40">
                          {t("currentLabel")}<span className="text-ink-60">{item.current}</span>
                        </span>
                        <span className="text-ink-40">
                          {t("suggestedLabel")}<span className="text-warn">{item.suggested}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 空状态 */}
      {!loading && !hasResult && !error && (
        <div className="card-a mt-6 border border-dashed border-line p-10 text-center">
          <div className="font-display text-base font-semibold text-ink-40">{t("emptyTitle")}</div>
          <p className="mt-2 font-sans text-sm text-ink-40">
            {t("emptyDesc")}
          </p>
        </div>
      )}

      {/* 最近检测历史 */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">{t("recentTitle")}</h2>
          <button
            onClick={loadHistory}
            className="font-sans text-xs font-medium text-ink-60 hover:text-ink"
          >
            {t("refresh")}
          </button>
        </div>
        <div className="card-a mt-4 overflow-hidden">
          {historyLoading ? (
            <TableSkeleton rows={3} />
          ) : history.length === 0 ? (
            <div className="px-4 py-10 text-center font-mono text-xs text-ink-40">
              {t("historyEmpty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">URL</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thKeyword")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thContentScore")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thWords")}</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thTime")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr
                      key={h.id}
                      className="cursor-pointer border-b border-line-soft transition-colors hover:bg-line-soft/40"
                      onClick={() => {
                        setUrl(h.url);
                        setTargetKeywordsInput(h.keyword);
                      }}
                    >
                      <td className="max-w-xs truncate px-4 py-3 font-mono text-sm text-ink">{h.url}</td>
                      <td className="px-4 py-3 font-sans text-sm text-ink-60">{h.keyword}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-sm font-semibold ${
                          (h.content_score ?? h.score) >= 80 ? "text-pos" : (h.content_score ?? h.score) >= 60 ? "text-warn" : "text-neg"
                        }`}>
                          {h.content_score ?? h.score}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-60">{formatNumber(h.word_count, locale)}</td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-40">{formatTime(h.created_at, locale, tc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Toast />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueClass = "text-ink",
  subClass = "text-ink-40",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  subClass?: string;
}) {
  return (
    <div className="card-a p-4">
      <div className="font-mono text-xs text-ink-40">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${valueClass}`}>{value}</div>
      {sub && <div className={`mt-0.5 font-mono text-xs ${subClass}`}>{sub}</div>}
    </div>
  );
}

function HistoryComparisonView({ comparison }: { comparison: ContentHistoryComparison }) {
  const t = useTranslations("dashboard.content");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as Locale;
  const prev = comparison.previous;
  if (!prev) return null;
  return (
    <div className="card-a mt-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 上次 */}
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="font-mono text-xs text-ink-40">{t("prevLabel")}</div>
          <div className="mt-1 font-mono text-xs text-ink-60">
            {formatTime(prev.checkedAt, locale, tc)}
          </div>
          <div className={`mt-2 font-mono text-2xl font-semibold ${scoreColorClass(prev.contentScore)}`}>
            {prev.contentScore}
            <span className="text-sm text-ink-40">{" "}{t("pointSuffix")}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-40">
            {t("wordsUnit", { n: formatNumber(prev.wordCount, locale) })}
          </div>
        </div>

        {/* 变化 */}
        <div className="flex flex-col items-center justify-center">
          <div className="font-mono text-xs text-ink-40">{t("changeLabel")}</div>
          <div className={`mt-1 font-mono text-2xl font-semibold ${
            comparison.scoreChange > 0 ? "text-pos" :
            comparison.scoreChange < 0 ? "text-neg" : "text-ink-40"
          }`}>
            {comparison.scoreChange > 0 ? "↑" : comparison.scoreChange < 0 ? "↓" : "→"}
            {" "}{t("pointsUnit", { n: Math.abs(comparison.scoreChange) })}
          </div>
          <div className={`mt-0.5 font-mono text-xs ${
            comparison.wordCountChange > 0 ? "text-pos" :
            comparison.wordCountChange < 0 ? "text-neg" : "text-ink-40"
          }`}>
            {t("wordsUnit", {
              n: `${comparison.wordCountChange >= 0 ? "+" : ""}${formatNumber(comparison.wordCountChange, locale)}`,
            })}
          </div>
        </div>

        {/* 本次 */}
        <div className="rounded-lg border-2 border-brand bg-brand/5 p-4">
          <div className="font-mono text-xs text-brand">{t("currentAnalysis")}</div>
          <div className="mt-1 font-mono text-xs text-ink-60">
            {formatTime(comparison.current.checkedAt, locale, tc)}
          </div>
          <div className={`mt-2 font-mono text-2xl font-semibold ${scoreColorClass(comparison.current.contentScore)}`}>
            {comparison.current.contentScore}
            <span className="text-sm text-ink-40">{" "}{t("pointSuffix")}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-40">
            {t("wordsUnit", { n: formatNumber(comparison.current.wordCount, locale) })}
          </div>
        </div>
      </div>

      {(comparison.newSuggestions.length > 0 || comparison.resolvedSuggestions.length > 0) && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {comparison.newSuggestions.length > 0 && (
            <div>
              <div className="flex items-center gap-2">
                <span className="badge-err">{t("newSug")}</span>
                <span className="font-mono text-xs text-ink-40">
                  {t("itemCount", { n: comparison.newSuggestions.length })}
                </span>
              </div>
              <ul className="mt-2 space-y-2">
                {comparison.newSuggestions.map((s, idx) => (
                  <li key={idx} className="rounded-md border border-line-soft bg-card px-3 py-2 font-sans text-xs text-ink">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {comparison.resolvedSuggestions.length > 0 && (
            <div>
              <div className="flex items-center gap-2">
                <span className="badge-pos">{t("resolved")}</span>
                <span className="font-mono text-xs text-ink-40">
                  {t("itemCount", { n: comparison.resolvedSuggestions.length })}
                </span>
              </div>
              <ul className="mt-2 space-y-2">
                {comparison.resolvedSuggestions.map((s, idx) => (
                  <li key={idx} className="rounded-md border border-line-soft bg-card px-3 py-2 font-sans text-xs text-ink-40 line-through">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

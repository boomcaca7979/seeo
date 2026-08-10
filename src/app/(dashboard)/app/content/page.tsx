"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import ScoreRing from "@/components/dashboard/ScoreRing";
import DomainSelect from "@/components/dashboard/DomainSelect";

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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

function scoreColorClass(score: number): string {
  if (score >= 80) return "text-pos";
  if (score >= 60) return "text-warn";
  return "text-neg";
}

function densityBadge(density: number): { label: string; cls: string } {
  if (density >= 2 && density <= 5) return { label: "理想", cls: "badge-pos" };
  if (density > 5) return { label: "堆砌风险", cls: "badge-warn" };
  return { label: "偏低", cls: "badge-info" };
}

function suggestionType(text: string): { label: string; cls: string } {
  if (text.includes("良好") || text.includes("正确")) return { label: "良好", cls: "badge-pos" };
  if (text.includes("过长") || text.includes("过短") || text.includes("未包含") || text.includes("缺少")) {
    return { label: "建议", cls: "badge-warn" };
  }
  return { label: "提示", cls: "badge-info" };
}

export default function ContentPage() {
  const { show, Toast } = useToast();
  const [url, setUrl] = useState("");
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
      show("请填写页面 URL", "error");
      return;
    }
    const targetKeywords = targetKeywordsInput
      .split(/[,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (targetKeywords.length === 0) {
      show("请填写至少一个目标关键词", "error");
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
        const { message } = handleBillingError(json, "检测失败");
        setError(message);
        show(message, "error");
        return;
      }
      setResult(json.data);
      show(`分析完成：内容评分 ${json.data.analysis.contentScore} 分`, "success");
      await loadHistory();
    } catch (err) {
      const msg = `网络错误：${(err as Error).message}`;
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
  const readabilityLevel = analysis?.readabilityLevel ?? "中等";
  const readabilityScore = analysis?.readabilityScore ?? 0;

  const maxTopCount = analysis
    ? Math.max(...analysis.topKeywords.map((k) => k.count), 1)
    : 1;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">07</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          内容优化
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        分析页面内容质量、可读性、关键词密度和 SEO 友好度。
      </p>

      {/* URL 输入区 */}
      <form
        onSubmit={handleAnalyze}
        className="card-a mt-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="font-mono text-xs text-ink-40">页面 URL</label>
          <DomainSelect
            value=""
            onChange={(d) => setUrl(`https://${d}`)}
            placeholder="选择项目域名自动填充"
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/blog/post-1"
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="font-mono text-xs text-ink-40">目标关键词（逗号分隔）</label>
          <input
            type="text"
            value={targetKeywordsInput}
            onChange={(e) => setTargetKeywordsInput(e.target.value)}
            placeholder="如：seo 工具, 内容优化"
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <div className="flex-shrink-0">
          {history.length > 0 && (
            <select
              className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs text-ink-60 focus:border-ink-25 focus:outline-none"
              onChange={(e) => {
                const h = history.find((x) => x.id === Number(e.target.value));
                if (h) {
                  setUrl(h.url);
                  setTargetKeywordsInput(h.keyword);
                }
              }}
              value=""
            >
              <option value="">历史记录</option>
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
          {loading ? "分析中…" : "分析"}
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
          <div className="font-display text-base font-bold text-neg">分析失败</div>
          <p className="mt-2 font-sans text-sm text-ink-60">{error}</p>
          <p className="mt-1 font-mono text-xs text-ink-40">请检查 URL 是否正确、目标站点是否可访问</p>
        </div>
      )}

      {/* 结果区 */}
      {!loading && hasResult && result && analysis && (
        <>
          {/* 内容评分卡 */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="card-a flex flex-col items-center justify-center p-6 lg:col-span-4">
              <ScoreRing score={contentScore} size={140} thickness={10} showLabel />
              <div className="mt-3 font-display text-base font-bold text-ink">
                内容评分
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
                    <span className="badge-info">首次分析</span>
                  ) : (
                    <>
                      <span className={comparison.scoreChange >= 0 ? "text-pos" : "text-neg"}>
                        {comparison.scoreChange >= 0 ? "↑" : "↓"} {Math.abs(comparison.scoreChange)} 分
                      </span>
                      <span className="ml-2 text-ink-40">
                        字数 {comparison.wordCountChange >= 0 ? "+" : ""}
                        {comparison.wordCountChange.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-2 font-mono text-xs text-ink-40">基于真实抓取结果计算</div>
              )}
            </div>

            {/* 统计卡网格 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-8">
              <StatCard label="字数" value={analysis.wordCount.toLocaleString()} />
              <StatCard
                label="可读性"
                value={`${analysis.readabilityScore}`}
                sub={analysis.readabilityLevel}
                valueClass={scoreColorClass(analysis.readabilityScore)}
              />
              <StatCard label="内链" value={analysis.internalLinksCount.toLocaleString()} />
              <StatCard label="外链" value={analysis.externalLinksCount.toLocaleString()} />
              <StatCard
                label="图片"
                value={analysis.imagesCount.toLocaleString()}
                sub={analysis.imagesWithoutAlt > 0 ? `${analysis.imagesWithoutAlt} 缺 alt` : "全部有 alt"}
                subClass={analysis.imagesWithoutAlt > 0 ? "text-neg" : "text-pos"}
              />
              <StatCard
                label="Meta"
                value={`${analysis.metaTitleLength}/${analysis.metaDescriptionLength}`}
                sub="标题/描述"
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
              <span className="font-mono text-xs text-ink-40">07-1</span>
              <h2 className="font-display text-lg font-bold text-ink">关键词密度</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {analysis.keywordDensity.length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-ink-40">
                  暂无目标关键词，请在上方输入
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line-soft bg-line-soft/40">
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">关键词</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">出现次数</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">密度</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.keywordDensity.map((item) => {
                        const badge = densityBadge(item.density);
                        return (
                          <tr key={item.keyword} className="border-b border-line-soft">
                            <td className="px-4 py-3 font-sans text-sm font-medium text-ink">{item.keyword}</td>
                            <td className="px-4 py-3 font-mono text-sm text-ink-60">{item.count.toLocaleString()}</td>
                            <td className="px-4 py-3 font-mono text-sm font-bold text-ink">{item.density}%</td>
                            <td className="px-4 py-3">
                              <span className={badge.cls}>{badge.label}</span>
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
              <span className="font-mono text-xs text-ink-40">07-2</span>
              <h2 className="font-display text-lg font-bold text-ink">标题建议</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <ul className="space-y-2">
                {analysis.titleSuggestions.map((suggestion, idx) => {
                  const resolved = comparison?.resolvedSuggestions.includes(suggestion);
                  const type = suggestionType(suggestion);
                  return (
                    <li key={idx} className="flex items-start gap-3">
                      <span className={type.cls}>{type.label}</span>
                      <span
                        className={`flex-1 font-sans text-sm ${
                          resolved ? "text-ink-40 line-through" : "text-ink"
                        }`}
                      >
                        {suggestion}
                      </span>
                      {resolved && <span className="badge-pos">已修复</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* 标题结构 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-ink-40">07-3</span>
              <h2 className="font-display text-lg font-bold text-ink">标题结构</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {!analysis.headingStructure.some((h) => h.level === 1) && (
                <div className="mb-3">
                  <span className="badge-err">缺少 H1</span>
                </div>
              )}
              {!analysis.headingStructure.some((h) => h.level === 2) && (
                <div className="mb-3">
                  <span className="badge-warn">建议添加 H2</span>
                </div>
              )}
              {analysis.headingStructure.length === 0 ? (
                <div className="py-4 text-center font-mono text-xs text-ink-40">
                  页面未检测到任何标题标签
                </div>
              ) : (
                <ul className="space-y-1.5">
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
              <span className="font-mono text-xs text-ink-40">07-4</span>
              <h2 className="font-display text-lg font-bold text-ink">高频词 TOP 10</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              {analysis.topKeywords.length === 0 ? (
                <div className="py-4 text-center font-mono text-xs text-ink-40">
                  未提取到高频词
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
              <span className="font-mono text-xs text-ink-40">07-5</span>
              <h2 className="font-display text-lg font-bold text-ink">内容预览</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <p className="font-sans text-sm leading-relaxed text-ink-60">
                {analysis.first100Words || "（未提取到正文内容）"}
              </p>
            </div>
          </div>

          {/* 历史对比 */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-ink-40">07-6</span>
              <h2 className="font-display text-lg font-bold text-ink">历史对比</h2>
              <div className="hairline flex-1" />
            </div>
            {!comparison || comparison.previous === null ? (
              <div className="card-a mt-4 p-6 text-center">
                <span className="badge-info">首次分析</span>
                <p className="mt-2 font-mono text-xs text-ink-40">
                  暂无历史数据，下次分析后将显示对比
                </p>
              </div>
            ) : (
              <HistoryComparisonView comparison={comparison} />
            )}
          </div>

          {/* SEO 检测清单（保留原有） */}
          <div className="mt-10">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-ink-40">07-7</span>
              <h2 className="font-display text-lg font-bold text-ink">页面 SEO 检测清单</h2>
              <div className="hairline flex-1" />
            </div>
            <div className="card-a mt-4 p-5">
              <p className="font-mono text-xs text-ink-40">真实抓取 {result.finalUrl}</p>
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
                          当前：<span className="text-ink-60">{item.current}</span>
                        </span>
                        <span className="text-ink-40">
                          建议：<span className="text-warn">{item.suggested}</span>
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
          <div className="font-display text-base font-bold text-ink-40">输入 URL 开始分析</div>
          <p className="mt-2 font-sans text-sm text-ink-40">
            填写页面 URL 和目标关键词，点击「分析」即可获取内容质量报告
          </p>
        </div>
      )}

      {/* 最近检测历史 */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">最近检测</h2>
          <button
            onClick={loadHistory}
            className="font-sans text-xs font-medium text-ink-60 hover:text-ink"
          >
            刷新
          </button>
        </div>
        <div className="card-a mt-4 overflow-hidden">
          {historyLoading ? (
            <TableSkeleton rows={3} />
          ) : history.length === 0 ? (
            <div className="px-4 py-10 text-center font-mono text-xs text-ink-40">
              暂无历史记录，开始第一次分析吧
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/40">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">URL</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">关键词</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">内容评分</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">字数</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">时间</th>
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
                      <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-ink">{h.url}</td>
                      <td className="px-4 py-3 font-sans text-sm text-ink-60">{h.keyword}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-sm font-bold ${
                          (h.content_score ?? h.score) >= 80 ? "text-pos" : (h.content_score ?? h.score) >= 60 ? "text-warn" : "text-neg"
                        }`}>
                          {h.content_score ?? h.score}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">{h.word_count.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-40">{formatTime(h.created_at)}</td>
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
      <div className={`mt-1 font-mono text-2xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className={`mt-0.5 font-mono text-[10px] ${subClass}`}>{sub}</div>}
    </div>
  );
}

function HistoryComparisonView({ comparison }: { comparison: ContentHistoryComparison }) {
  const prev = comparison.previous;
  if (!prev) return null;
  return (
    <div className="card-a mt-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 上次 */}
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="font-mono text-xs text-ink-40">上次分析</div>
          <div className="mt-1 font-mono text-xs text-ink-60">
            {formatTime(prev.checkedAt)}
          </div>
          <div className={`mt-2 font-mono text-2xl font-bold ${scoreColorClass(prev.contentScore)}`}>
            {prev.contentScore}
            <span className="text-sm text-ink-40"> 分</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-40">
            {prev.wordCount.toLocaleString()} 字
          </div>
        </div>

        {/* 变化 */}
        <div className="flex flex-col items-center justify-center">
          <div className="font-mono text-xs text-ink-40">变化</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${
            comparison.scoreChange > 0 ? "text-pos" :
            comparison.scoreChange < 0 ? "text-neg" : "text-ink-40"
          }`}>
            {comparison.scoreChange > 0 ? "↑" : comparison.scoreChange < 0 ? "↓" : "→"}
            {" "}{Math.abs(comparison.scoreChange)} 分
          </div>
          <div className={`mt-0.5 font-mono text-[10px] ${
            comparison.wordCountChange > 0 ? "text-pos" :
            comparison.wordCountChange < 0 ? "text-neg" : "text-ink-40"
          }`}>
            {comparison.wordCountChange >= 0 ? "+" : ""}
            {comparison.wordCountChange.toLocaleString()} 字
          </div>
        </div>

        {/* 本次 */}
        <div className="rounded-lg border-2 border-brand bg-brand/5 p-4">
          <div className="font-mono text-xs text-brand">本次分析</div>
          <div className="mt-1 font-mono text-xs text-ink-60">
            {formatTime(comparison.current.checkedAt)}
          </div>
          <div className={`mt-2 font-mono text-2xl font-bold ${scoreColorClass(comparison.current.contentScore)}`}>
            {comparison.current.contentScore}
            <span className="text-sm text-ink-40"> 分</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-40">
            {comparison.current.wordCount.toLocaleString()} 字
          </div>
        </div>
      </div>

      {(comparison.newSuggestions.length > 0 || comparison.resolvedSuggestions.length > 0) && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {comparison.newSuggestions.length > 0 && (
            <div>
              <div className="flex items-center gap-2">
                <span className="badge-err">新增建议</span>
                <span className="font-mono text-xs text-ink-40">
                  {comparison.newSuggestions.length} 条
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
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
                <span className="badge-pos">已修复</span>
                <span className="font-mono text-xs text-ink-40">
                  {comparison.resolvedSuggestions.length} 条
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
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

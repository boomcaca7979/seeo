"use client";

import { useState } from "react";
import {
  keywordOverview,
  relatedKeywords,
  type RelatedKeyword,
} from "@/lib/mock-data";
import { useToast } from "@/components/dashboard/Toast";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  COMMON_YAXIS_PROPS,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
} from "@/components/dashboard/chart-theme";
import type { SerpResult } from "@/lib/seo/types";

type Tab = "phrase" | "related" | "question";
type Device = "PC" | "移动端";

interface UsageBadge {
  used: number;
  limit: number;
}

interface SerpState {
  loading: boolean;
  data: SerpResult | null;
  error: string | null;
}

interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
}

interface ExpandState {
  loading: boolean;
  data: ExpandData | null;
  error: string | null;
}

// 地区选项（value 对应 SerpApi location 字符串）
const KEYWORD_LOCATIONS = ["中国", "美国", "英国", "日本", "香港", "台湾"];

// 搜索意图判定
function detectIntent(query: string): string {
  if (/什么|怎么|为什么|如何|是不是|哪些/.test(query)) return "信息型";
  if (/推荐|最好|对比|价格|费用|多少钱|哪个好/.test(query)) return "商业型";
  return "导航型";
}

export default function KeywordsPage() {
  const [tab, setTab] = useState<Tab>("phrase");
  const [searchValue, setSearchValue] = useState(keywordOverview.keyword);
  const [serp, setSerp] = useState<SerpState>({ loading: false, data: null, error: null });
  const [expand, setExpand] = useState<ExpandState>({ loading: false, data: null, error: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [trackingIds, setTrackingIds] = useState<Record<string, boolean>>({});
  const { show, Toast } = useToast();

  // 真实 SERP 接口已切换为 related_searches / related_questions
  // 「短语匹配」Tab 仍用 mock
  const phraseData: RelatedKeyword[] = relatedKeywords.phrase;

  // 真实相关词：把 SerpApi related_searches 适配成表格行
  const relatedData: RelatedKeyword[] = (serp.data?.relatedSearches ?? []).map((r, i) => ({
    keyword: r.query,
    volume: ["—", "低", "中", "高"][i % 4],
    kd: 20 + ((i * 7) % 60),
    cpc: "—",
    intent: i % 3 === 0 ? "信息型" : i % 3 === 1 ? "商业调查型" : "交易型",
  }));

  // 真实疑问词：People Also Ask
  const questionData: RelatedKeyword[] = (serp.data?.relatedQuestions ?? []).map((q, i) => ({
    keyword: q.question,
    volume: ["—", "低", "中"][i % 3],
    kd: 15 + ((i * 5) % 50),
    cpc: "—",
    intent: "信息型",
  }));

  const tabs: { key: Tab; label: string; data: RelatedKeyword[]; real: boolean }[] = [
    { key: "phrase", label: "短语匹配", data: phraseData, real: false },
    { key: "related", label: "相关词", data: relatedData, real: true },
    { key: "question", label: "疑问词", data: questionData, real: true },
  ];
  const current = tabs.find((t) => t.key === tab)!;

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchValue.trim();
    if (!kw) {
      show("请输入关键词", "error");
      return;
    }
    setSerp({ loading: true, data: null, error: null });
    setExpand({ loading: true, data: null, error: null });

    // 并行发起 SERP + 拓词请求
    const serpPromise = (async () => {
      try {
        const res = await fetch(
          `/api/seo/serp?keyword=${encodeURIComponent(kw)}&location=${encodeURIComponent(location)}&device=${encodeURIComponent(device)}`
        );
        const json = await res.json();
        if (!res.ok) {
          const msg = json?.error ?? "查询失败";
          setSerp({ loading: false, data: null, error: msg });
          show(msg, "error");
          return;
        }
        setSerp({ loading: false, data: json.data, error: null });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
        if (json.data?.fromCache) {
          show(`已加载「${kw}」（缓存数据，未消耗额度）`, "info");
        } else {
          show(`已加载「${kw}」的真实 SERP 数据`, "success");
        }
      } catch (err) {
        const msg = `网络错误：${(err as Error).message}`;
        setSerp({ loading: false, data: null, error: msg });
        show(msg, "error");
      }
    })();

    const expandPromise = (async () => {
      try {
        const res = await fetch("/api/keywords/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: kw, location, device }),
        });
        const json = await res.json();
        if (!res.ok) {
          const msg = json?.error ?? "拓词失败";
          setExpand({ loading: false, data: null, error: msg });
          return;
        }
        setExpand({ loading: false, data: json.data, error: null });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      } catch (err) {
        const msg = `拓词网络错误：${(err as Error).message}`;
        setExpand({ loading: false, data: null, error: msg });
      }
    })();

    await Promise.all([serpPromise, expandPromise]);
  };

  const handleTrackFromExpand = async (keyword: string) => {
    if (trackingIds[keyword]) {
      show("该词已在追踪中", "info");
      return;
    }
    setTrackingIds((prev) => ({ ...prev, [keyword]: true }));
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          location,
          device,
          domain: "semrush.com",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json?.error ?? "添加失败", "error");
        setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
        return;
      }
      show(`已添加追踪：${keyword}`, "success");
      if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
      setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
    }
  };

  const expandTotal = (expand.data?.related.length ?? 0) + (expand.data?.paa.length ?? 0);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">02</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          关键词研究
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        输入一个种子词，看清它的搜索量、难度、意图和相关词。
      </p>

      {/* 搜索框 + 地区/设备选择器 */}
      <form onSubmit={handleAnalyze} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-lg border border-line bg-card px-3 py-2.5 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            {KEYWORD_LOCATIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value as Device)}
            className="rounded-lg border border-line bg-card px-3 py-2.5 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            <option value="PC">PC</option>
            <option value="移动端">移动端</option>
          </select>
        </div>
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-40">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="输入关键词，如：seo 工具（点击分析拉取真实 SERP）"
            className="w-full rounded-lg border border-line bg-card py-3 pl-11 pr-4 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={serp.loading}
          className="btn-primary px-6 py-3"
        >
          {serp.loading ? "分析中…" : "分析"}
        </button>
      </form>

      {/* 概览卡片 */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 趋势图 */}
        <div className="card-a p-5 lg:col-span-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">
                {keywordOverview.keyword}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-ink-40">
                12 个月搜索量趋势 · <span className="badge-warn">示意数据</span>
              </p>
            </div>
            <span className="badge-warn">
              {keywordOverview.intent}
            </span>
          </div>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={keywordOverview.trend} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid {...COMMON_GRID_PROPS} />
                <XAxis dataKey="month" {...COMMON_XAXIS_PROPS} />
                <YAxis {...COMMON_YAXIS_PROPS} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#C98A0A"
                  strokeWidth={2}
                  fill="#ECE9DD"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 指标 — 搜索量/KD/CPC 全部标注「估算」 */}
        <div className="grid grid-cols-2 gap-4 lg:col-span-4">
          <MetricCard label="搜索量" value={keywordOverview.searchVolume} sub="月均" estimated />
          <MetricCard label="关键词难度" value={String(keywordOverview.kd)} sub="较难" estimated />
          <MetricCard label="CPC" value={keywordOverview.cpc} sub="广告竞争 中" estimated />
          <div className="card-a p-5">
            <div className="font-mono text-xs text-ink-40">SERP 特征</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {keywordOverview.serpFeatures.map((f) => (
                <span key={f} className="rounded bg-line-soft px-1.5 py-0.5 font-mono text-[10px] text-ink-60">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 拓词建议 */}
      <div className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">02-1</span>
          <h2 className="font-display text-lg font-bold text-ink">
            拓词建议
          </h2>
          <div className="hairline flex-1" />
          <span className="font-mono text-xs text-ink-40">
            {expand.data ? `共 ${expandTotal} 个拓词建议` : "点击分析拉取拓词数据"}
            {usage && ` · 本月 API 已用 ${usage.used}/${usage.limit}`}
          </span>
        </div>

        {expand.loading ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ExpandSkeleton />
            <ExpandSkeleton />
          </div>
        ) : expand.error ? (
          <div className="card-a mt-4 p-6 text-center font-sans text-sm text-neg">
            {expand.error}
          </div>
        ) : expand.data ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 相关搜索 */}
            <div className="card-a p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-ink">相关搜索</h3>
                <span className="font-mono text-xs text-ink-40">{expand.data.related.length} 个</span>
              </div>
              {expand.data.related.length === 0 ? (
                <div className="mt-4 py-6 text-center font-mono text-xs text-ink-40">
                  暂无相关搜索数据
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {expand.data.related.map((q) => (
                    <ExpandTag
                      key={q}
                      query={q}
                      tracked={!!trackingIds[q]}
                      onTrack={() => handleTrackFromExpand(q)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* People Also Ask */}
            <div className="card-a p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-ink">People Also Ask</h3>
                <span className="font-mono text-xs text-ink-40">{expand.data.paa.length} 个</span>
              </div>
              {expand.data.paa.length === 0 ? (
                <div className="mt-4 py-6 text-center font-mono text-xs text-ink-40">
                  暂无 PAA 数据
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {expand.data.paa.map((q) => (
                    <ExpandTag
                      key={q}
                      query={q}
                      tracked={!!trackingIds[q]}
                      onTrack={() => handleTrackFromExpand(q)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card-a mt-4 p-6 text-center">
            <div className="font-sans text-sm text-ink-40">点击上方「分析」按钮拉取拓词建议</div>
            <p className="mt-1 font-mono text-xs text-ink-40">
              包含 Google 相关搜索 + People Also Ask，可一键加入追踪
            </p>
          </div>
        )}
      </div>

      {/* SERP Top 10 真实数据区块 */}
      <div className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">·</span>
          <h2 className="font-display text-lg font-bold text-ink">
            SERP Top 10
          </h2>
          <div className="hairline flex-1" />
          <span className="font-mono text-xs text-ink-40">
            来自 Google 实时抓取
            {serp.data?.fromCache && " · 缓存数据 · 24h 内不重复计费"}
          </span>
        </div>
        <div className="card-a mt-4 overflow-hidden">
          {serp.loading ? (
            <SerpSkeleton />
          ) : serp.error ? (
            <div className="px-4 py-10 text-center font-sans text-sm text-neg">
              {serp.error}
            </div>
          ) : serp.data && serp.data.organic.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">排名</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">标题</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">域名</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {serp.data.organic.map((r) => (
                    <tr key={r.position} className="border-b border-line-soft/60 transition-colors hover:bg-[#FBFAF4]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-bold text-brand">#{r.position}</span>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={r.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-sans text-sm font-medium text-ink hover:text-brand-deep"
                        >
                          {r.title}
                        </a>
                        {r.date && (
                          <span className="ml-2 font-mono text-[10px] text-ink-40">{r.date}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-line-soft px-2 py-0.5 font-mono text-xs text-ink-60">
                          {r.domain}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-sans text-xs text-ink-60 line-clamp-2 max-w-md">
                        {r.snippet || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-10 text-center font-sans text-sm text-ink-40">
              点击上方「分析」按钮，拉取真实 SERP Top 10
            </div>
          )}
        </div>
      </div>

      {/* 相关关键词表格 */}
      <div className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">·</span>
          <h2 className="font-display text-lg font-bold text-ink">
            相关关键词
          </h2>
          <div className="hairline flex-1" />
          {current.real ? (
            <span className="badge-warn">估算</span>
          ) : (
            <span className="badge-warn">示意数据</span>
          )}
        </div>

        {/* Tab 切换：描边药丸 */}
        <div className="mt-4 flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={tab === t.key ? "btn-primary" : "btn-secondary"}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="card-a mt-4 overflow-hidden">
          {current.real && serp.loading ? (
            <SerpSkeleton rows={5} />
          ) : current.data.length === 0 ? (
            <div className="px-4 py-10 text-center font-sans text-sm text-ink-40">
              {current.real
                ? "暂无数据，点击上方「分析」拉取真实相关词"
                : "暂无数据"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">关键词</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">
                      搜索量{current.real && <span className="ml-1 text-ink-40">·估</span>}
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">
                      KD{current.real && <span className="ml-1 text-ink-40">·估</span>}
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">CPC</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">意图</th>
                    <th className="px-4 py-3 text-right font-mono text-xs font-semibold text-ink-40">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {current.data.map((r) => (
                    <tr
                      key={r.keyword}
                      className="border-b border-line-soft/60 transition-colors hover:bg-[#FBFAF4]"
                    >
                      <td className="px-4 py-3 font-sans text-sm font-medium text-ink">
                        {r.keyword}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-60">{r.volume}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-sm font-semibold ${
                          r.kd > 60 ? "text-neg" : r.kd > 40 ? "text-warn" : "text-pos"
                        }`}>
                          {r.kd}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-60">{r.cpc}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-line-soft px-2 py-0.5 font-mono text-xs text-ink-60">
                          {r.intent}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => show(`已加入追踪：${r.keyword}`, "success")}
                          className="font-sans text-xs font-medium text-brand hover:text-brand-deep"
                        >
                          + 追踪
                        </button>
                      </td>
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

function MetricCard({
  label,
  value,
  sub,
  estimated,
}: {
  label: string;
  value: string;
  sub: string;
  estimated?: boolean;
}) {
  return (
    <div className="relative card-a p-5">
      {estimated && (
        <span className="absolute right-3 top-3 badge-warn">估算</span>
      )}
      <div className="font-mono text-xs text-ink-40">{label}</div>
      <div className="mt-1 font-display text-xl font-bold text-ink">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-40">{sub}</div>
    </div>
  );
}

function ExpandTag({
  query,
  tracked,
  onTrack,
}: {
  query: string;
  tracked: boolean;
  onTrack: () => void;
}) {
  const intent = detectIntent(query);
  return (
    <div className="group relative inline-flex items-center gap-1.5 rounded-full border border-line bg-card pl-3 pr-1.5 py-1">
      <span className="font-sans text-xs text-ink">{query}</span>
      <span className="font-mono text-[10px] text-ink-40">{intent}</span>
      <button
        onClick={onTrack}
        disabled={tracked}
        className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
          tracked
            ? "bg-pos/15 text-pos"
            : "bg-line-soft text-ink-60 hover:bg-brand hover:text-ink"
        }`}
        title={tracked ? "已加入追踪" : "加入追踪"}
      >
        {tracked ? "✓" : "+"}
      </button>
    </div>
  );
}

function SerpSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3">
          <div className="h-3.5 w-8 rounded bg-line-soft" />
          <div className="h-3.5 w-1/3 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="h-3.5 flex-1 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

function ExpandSkeleton() {
  return (
    <div className="card-a p-5">
      <div className="h-4 w-24 rounded bg-line-soft" />
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-7 rounded-full bg-line-soft"
            style={{ width: `${60 + (i * 13) % 80}px` }}
          />
        ))}
      </div>
    </div>
  );
}

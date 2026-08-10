"use client";

import { useState } from "react";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import type { SerpResult } from "@/lib/seo/types";

interface UsageBadge {
  used: number;
  limit: number;
}

interface SerpState {
  loading: boolean;
  data: SerpResult | null;
  error: string | null;
  keyword: string | null;
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

const KEYWORD_LOCATIONS = ["中国", "美国", "英国", "日本", "香港", "台湾"];
type Device = "PC" | "移动端";

function detectIntent(query: string): string {
  if (/什么|怎么|为什么|如何|是不是|哪些/.test(query)) return "信息型";
  if (/推荐|最好|对比|价格|费用|多少钱|哪个好/.test(query)) return "商业型";
  return "导航型";
}

export default function KeywordExpandPage() {
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [serp, setSerp] = useState<SerpState>({ loading: false, data: null, error: null, keyword: null });
  const [expand, setExpand] = useState<ExpandState>({ loading: false, data: null, error: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [trackingIds, setTrackingIds] = useState<Record<string, boolean>>({});
  const { show, Toast } = useToast();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchValue.trim();
    if (!kw) {
      show("请输入关键词", "error");
      return;
    }
    setSerp({ loading: true, data: null, error: null, keyword: kw });
    setExpand({ loading: true, data: null, error: null });

    const serpPromise = (async () => {
      try {
        const res = await fetch(
          `/api/seo/serp?keyword=${encodeURIComponent(kw)}&location=${encodeURIComponent(location)}&device=${encodeURIComponent(device)}`
        );
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, "查询失败");
          setSerp({ loading: false, data: null, error: message, keyword: kw });
          show(message, "error");
          return;
        }
        setSerp({ loading: false, data: json.data, error: null, keyword: kw });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      } catch (err) {
        const msg = `网络错误：${(err as Error).message}`;
        setSerp({ loading: false, data: null, error: msg, keyword: kw });
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
          const { message } = handleBillingError(json, "拓词失败");
          setExpand({ loading: false, data: null, error: message });
          return;
        }
        setExpand({ loading: false, data: json.data, error: null });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      } catch (err) {
        setExpand({ loading: false, data: null, error: `拓词网络错误：${(err as Error).message}` });
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
      const projRes = await fetch("/api/projects", { cache: "no-store" });
      const projJson = await projRes.json();
      const userProjects: { domain?: string }[] = projJson?.data ?? [];
      const firstDomain = userProjects[0]?.domain?.trim();
      if (!firstDomain) {
        show("请先在概览页创建项目，再添加追踪", "error");
        setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
        return;
      }
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, location, device, domain: firstDomain }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, "添加失败");
        show(message, "error");
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

  const hasResult = !!serp.data || !!expand.data;
  const expandTotal = (expand.data?.related.length ?? 0) + (expand.data?.paa.length ?? 0);

  // 相关词表格（真实，来自 SERP）
  const relatedRows = (serp.data?.relatedSearches ?? []).map((r, i) => ({
    keyword: r.query,
    intent: i % 3 === 0 ? "信息型" : i % 3 === 1 ? "商业调查型" : "交易型",
  }));

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <h1 className="text-[28px] font-semibold leading-tight text-ink">拓词建议</h1>
      <p className="mt-1 text-sm text-ink-60">
        输入种子词，获取 Google 相关搜索、People Also Ask 与可追踪的相关关键词。
      </p>

      {/* 搜索框 */}
      <form onSubmit={handleAnalyze} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            {KEYWORD_LOCATIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value as Device)}
            className="rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink focus:border-ink-25 focus:outline-none"
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
            placeholder="输入关键词，如：SEO工具、网站建设"
            className="w-full rounded-lg border border-line bg-card py-3 pl-11 pr-4 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <button type="submit" disabled={serp.loading} className="btn-primary px-6 py-3">
          {serp.loading ? "分析中…" : "分析"}
        </button>
      </form>

      {usage && (
        <div className="mt-4 text-xs text-ink-40">
          本月 API 已用 {usage.used}/{usage.limit}
        </div>
      )}

      {/* 未分析时纯空态 */}
      {!hasResult && !serp.loading && !expand.loading && !serp.error && !expand.error && (
        <div className="mt-8 card-a flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink-40">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 text-sm font-medium text-ink">输入种子词，点击分析拉取拓词建议</div>
          <p className="mt-1 text-xs text-ink-40">包含 Google 相关搜索 + People Also Ask，可一键加入追踪</p>
        </div>
      )}

      {/* 拓词建议区 */}
      {(expand.loading || expand.data || expand.error) && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold text-ink">拓词建议</h2>
            <span className="text-xs text-ink-40">
              {expand.data ? `共 ${expandTotal} 个拓词建议` : expand.loading ? "拉取中…" : ""}
            </span>
          </div>

          {expand.loading ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ExpandSkeleton />
              <ExpandSkeleton />
            </div>
          ) : expand.error ? (
            <div className="card-a mt-4 p-6 text-center text-sm text-neg">{expand.error}</div>
          ) : expand.data ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card-a p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">相关搜索</h3>
                  <span className="text-xs text-ink-40">{expand.data.related.length} 个</span>
                </div>
                {expand.data.related.length === 0 ? (
                  <div className="mt-4 py-6 text-center text-xs text-ink-40">暂无相关搜索数据</div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {expand.data.related.map((q) => (
                      <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                    ))}
                  </div>
                )}
              </div>
              <div className="card-a p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">People Also Ask</h3>
                  <span className="text-xs text-ink-40">{expand.data.paa.length} 个</span>
                </div>
                {expand.data.paa.length === 0 ? (
                  <div className="mt-4 py-6 text-center text-xs text-ink-40">暂无 PAA 数据</div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {expand.data.paa.map((q) => (
                      <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 相关关键词表格 */}
      {(serp.loading || (serp.data && serp.data.relatedSearches.length > 0) || serp.error) && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold text-ink">相关关键词</h2>
            <span className="text-xs text-ink-40">来自 SERP 相关搜索</span>
          </div>
          <div className="card-a mt-3 overflow-hidden">
            {serp.loading ? (
              <SerpSkeleton rows={5} />
            ) : serp.error ? (
              <div className="p-6 text-center text-sm text-neg">{serp.error}</div>
            ) : relatedRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-40">暂无相关关键词</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-soft bg-line-soft/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">关键词</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">意图</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-ink-40">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatedRows.map((r) => (
                      <tr key={r.keyword} className="border-b border-line-soft/60 transition-colors hover:bg-line-soft/40">
                        <td className="px-4 py-3 text-sm font-medium text-ink">{r.keyword}</td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-line-soft px-2 py-0.5 text-xs text-ink-60">{r.intent}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleTrackFromExpand(r.keyword)}
                            className="text-xs font-medium text-accent hover:underline"
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
      )}

      <Toast />
    </div>
  );
}

function ExpandTag({ query, tracked, onTrack }: { query: string; tracked: boolean; onTrack: () => void }) {
  const intent = detectIntent(query);
  return (
    <div className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-card pl-3 pr-1.5 py-1">
      <span className="text-xs text-ink">{query}</span>
      <span className="text-[10px] text-ink-40">{intent}</span>
      <button
        onClick={onTrack}
        disabled={tracked}
        className={`rounded-full px-1.5 py-0.5 text-[10px] transition-colors ${
          tracked ? "bg-pos/15 text-pos" : "bg-line-soft text-ink-60 hover:bg-ink hover:text-card"
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
          <div className="h-3.5 w-1/3 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="ml-auto h-3.5 w-10 rounded bg-line-soft" />
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
          <div key={i} className="h-7 rounded-full bg-line-soft" style={{ width: `${60 + (i * 13) % 80}px` }} />
        ))}
      </div>
    </div>
  );
}

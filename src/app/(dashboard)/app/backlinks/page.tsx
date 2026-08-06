"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useToast } from "@/components/dashboard/Toast";
import { TableSkeleton } from "@/components/dashboard/Skeleton";

interface BacklinkSummary {
  totalBacklinks: number | null;
  referringDomains: number | null;
  domainRank: number | null;
  dofollowPct: number | null;
}

interface BacklinkItem {
  sourceUrl: string | null;
  anchor: string | null;
  targetUrl: string | null;
  dofollow: boolean | null;
  sourceRank: number | null;
  firstSeen: string | null;
}

interface BacklinkData {
  summary: BacklinkSummary;
  backlinks: BacklinkItem[];
  cachedAt: string;
  fromCache: boolean;
}

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

function formatNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export default function BacklinksPage() {
  const { show, Toast } = useToast();
  const [domain, setDomain] = useState(() => {
    // 默认域名：localStorage 上次 → 空（用户手动输入）
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem("seeo:last-backlink-domain") ?? "";
      }
    } catch {
      // ignore
    }
    return "";
  });
  const [data, setData] = useState<BacklinkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCache = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backlinks?domain=${encodeURIComponent(d)}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setData(json.data ?? null);
      } else {
        setError(json?.error ?? "加载失败");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (domain.trim()) {
      const id = window.setTimeout(() => void loadCache(domain), 0);
      return () => window.clearTimeout(id);
    }
  }, [loadCache, domain]);

  const handleDomainChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = domain.trim();
    if (!d) return;
    await loadCache(d);
  };

  const handleAnalyze = async () => {
    const d = domain.trim();
    if (!d) {
      show("请输入域名", "error");
      return;
    }
    setAnalyzing(true);
    setError(null);
    show("正在拉取外链数据，预计 10-30 秒…", "info");
    try {
      const res = await fetch("/api/backlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error ?? "拉取失败";
        setError(msg);
        show(msg, "error");
        return;
      }
      try {
        localStorage.setItem("seeo:last-backlink-domain", d);
      } catch {
        // ignore
      }
      setData(json.data);
      show(json.data?.fromCache ? "命中缓存，未重复扣费" : "拉取完成", "success");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      show(`网络错误：${msg}`, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const hasData = data !== null;
  const metrics = [
    { label: "外链总数", value: hasData ? formatNum(data!.summary.totalBacklinks) : "—" },
    { label: "引荐域名", value: hasData ? formatNum(data!.summary.referringDomains) : "—" },
    { label: "权威度", value: hasData ? formatNum(data!.summary.domainRank) : "—" },
    { label: "DoFollow 占比", value: hasData && data!.summary.dofollowPct !== null ? `${data!.summary.dofollowPct}%` : "—" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">04</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          外链分析
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        数据来自 DataForSEO Backlinks API，覆盖外链总数、引荐域名、权威度、DoFollow 占比与外链明细。
      </p>

      {/* 工具栏 */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form onSubmit={handleDomainChange} className="flex items-end gap-2">
          <div>
            <label className="font-sans text-xs text-ink-40">分析域名</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="输入域名，如：example.com"
              className="mt-1.5 w-48 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <button type="submit" className="btn-secondary">
            查看
          </button>
        </form>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !domain.trim()}
          className="btn-primary disabled:opacity-60"
        >
          {analyzing ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              拉取中…
            </>
          ) : (
            "分析"
          )}
        </button>
      </div>

      {/* 加载骨架 */}
      {loading && (
        <div className="mt-6 space-y-4">
          <TableSkeleton rows={1} />
          <TableSkeleton rows={6} />
        </div>
      )}

      {/* 失败横幅 */}
      {!loading && error && (
        <div className="card-a mt-6 border-neg/30 bg-neg/5 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neg/15 font-mono text-sm text-neg">!</span>
            <div>
              <div className="font-display text-sm font-bold text-neg">拉取失败</div>
              <p className="mt-1 font-sans text-sm text-ink-60">{error}</p>
              {domain && (
                <p className="mt-1 font-sans text-xs text-ink-40">域名：{domain}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 指标卡 */}
      {!loading && !error && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((m) => (
            <div
              key={m.label}
              className={`card-a p-5 ${!hasData ? "opacity-60" : ""}`}
            >
              <div className="font-sans text-xs text-ink-40">{m.label}</div>
              <div className={`mt-1 font-display text-2xl font-bold ${hasData ? "text-ink" : "text-ink-40"}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 外链列表 */}
      {!loading && !error && hasData && (
        <div className="card-a mt-6 overflow-hidden">
          <div className="border-b border-line-soft px-4 py-3">
            <span className="font-display text-sm font-bold text-ink">外链明细</span>
            <span className="ml-2 font-mono text-xs text-ink-40">
              共 {data!.backlinks.length} 条 · 按 source rank 降序
            </span>
          </div>
          {data!.backlinks.length === 0 ? (
            <div className="px-4 py-10 text-center font-sans text-sm text-ink-40">
              DataForSEO 未返回外链明细（该域名可能无外链或数据源未覆盖）
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">来源页面</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">锚文本</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">类型</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">Rank</th>
                    <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">首次发现</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.backlinks.map((b, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-ink break-all max-w-[280px]">
                        {b.sourceUrl ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-sans text-xs text-ink-60 max-w-[200px] truncate">
                        {b.anchor ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {b.dofollow === null ? (
                          <span className="text-ink-40">—</span>
                        ) : b.dofollow ? (
                          <span className="badge-info">DoFollow</span>
                        ) : (
                          <span className="badge-warn">NoFollow</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">
                        {b.sourceRank ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">
                        {b.firstSeen ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-line-soft px-4 py-2 font-sans text-xs text-ink-40">
            数据来自 DataForSEO · 抓取于 {formatTime(data!.cachedAt)}
            {data!.fromCache && <span className="ml-2 text-ink-40">（缓存命中）</span>}
          </div>
        </div>
      )}

      {/* 空态引导 */}
      {!loading && !error && !hasData && (
        <div className="card-a mt-6 p-10 text-center">
          <div className="font-display text-sm font-bold text-ink-60">暂无外链数据</div>
          <p className="mt-1.5 font-sans text-xs text-ink-40">
            输入域名，点击「分析」拉取真实外链数据
          </p>
        </div>
      )}

      <Toast />
    </div>
  );
}

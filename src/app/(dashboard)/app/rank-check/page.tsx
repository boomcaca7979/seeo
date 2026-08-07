"use client";

import { useState } from "react";
import { useToast } from "@/components/dashboard/Toast";
import DomainSelect from "@/components/dashboard/DomainSelect";
import type { RankResult } from "@/lib/seo/types";

const REGION_CITIES: Record<string, string[]> = {
  "中国": ["北京", "上海", "广州", "深圳"],
  "美国": ["纽约", "洛杉矶", "芝加哥"],
  "英国": ["伦敦", "曼彻斯特"],
  "日本": ["东京", "大阪"],
  "香港": ["香港"],
  "台湾": ["台北"],
};
const RANK_LOCATIONS = Object.keys(REGION_CITIES);
type Device = "PC" | "移动端";

export default function RankCheckPage() {
  const { show, Toast } = useToast();
  const [device, setDevice] = useState<Device>("PC");
  const [country, setCountry] = useState(RANK_LOCATIONS[0]);
  const [cities, setCities] = useState<string[]>(REGION_CITIES[RANK_LOCATIONS[0]]);
  const [city, setCity] = useState(REGION_CITIES[RANK_LOCATIONS[0]][0]);

  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<RankResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  const handleRegionChange = (region: string) => {
    setCountry(region);
    const next = REGION_CITIES[region] ?? [];
    setCities(next);
    setCity(next[0] ?? "");
  };

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = keyword.trim();
    const dm = domain.trim();
    if (!kw) {
      show("请输入关键词", "error");
      return;
    }
    if (!dm) {
      show("请输入域名", "error");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setHasQueried(true);
    try {
      const res = await fetch(
        `/api/seo/rank?keyword=${encodeURIComponent(kw)}&domain=${encodeURIComponent(dm)}&location=${encodeURIComponent(country)}&device=${encodeURIComponent(device)}`
      );
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error ?? "查询失败";
        setError(msg);
        show(msg, "error");
        return;
      }
      setResult(json.data);
      if (json.data?.fromCache) {
        show("命中缓存，未消耗额度", "info");
      } else {
        show("查询完成（消耗 1 次额度）", "success");
      }
    } catch (err) {
      const msg = `网络错误：${(err as Error).message}`;
      setError(msg);
      show(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="text-[28px] font-semibold leading-tight text-ink">实时查排名</h1>
      <p className="mt-1 text-sm text-ink-60">
        即时查询任意关键词 + 域名在 Google SERP 中的真实排名，24 小时内重复查询命中缓存不重复计费。
      </p>

      {/* 查询表单 */}
      <form onSubmit={handleCheck} className="card-a mt-6 p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="text-xs text-ink-40">关键词</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="如：seo 工具"
              className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-40">域名</label>
            <DomainSelect
              value={domain}
              onChange={setDomain}
              placeholder="example.com"
              className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-40">地区</label>
            <select
              value={country}
              onChange={(e) => handleRegionChange(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none"
            >
              {RANK_LOCATIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none"
            >
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-40">设备</label>
            <div className="flex gap-2">
              {(["PC", "移动端"] as Device[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className={device === d ? "btn-primary" : "btn-secondary"}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary ml-auto disabled:opacity-60"
          >
            {loading ? "查询中…" : "查询排名"}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-line-soft bg-line-soft/40 px-3 py-2 text-[11px] text-ink-60">
          实时查询消耗 1 次 API 额度（24h 内重复查询命中缓存不重复计费）
        </div>
      </form>

      {/* 查询结果 */}
      {hasQueried && (
        <div className="card-a mt-6 p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
              <div className="mt-3 text-sm text-ink-60">正在抓取 Google SERP…</div>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 text-sm text-neg">
              {error}
            </div>
          ) : result ? (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-ink-40">查询关键词</div>
                  <div className="mt-0.5 text-base font-semibold text-ink">{result.keyword}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-ink-40">查询域名</div>
                  <div className="mt-0.5 font-mono text-sm text-ink-60">{result.domain}</div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-line bg-line-soft/30 px-5 py-6 text-center">
                {result.rank === null ? (
                  <>
                    <div className="text-2xl font-bold text-ink-40">未进入前 100 名</div>
                    <div className="mt-2 text-xs text-ink-40">
                      {result.domain} 在「{result.keyword}」的 Google SERP 前 100 中未出现
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-ink-40">当前排名</span>
                      {result.fromCache && (
                        <span className="badge-warn">缓存数据</span>
                      )}
                    </div>
                    <div className="mt-2 text-5xl font-bold text-ink">#{result.rank}</div>
                    {result.matchedUrl && (
                      <a
                        href={result.matchedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block truncate font-mono text-xs text-accent hover:underline"
                        title={result.matchedUrl}
                      >
                        {result.matchedUrl}
                      </a>
                    )}
                  </>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between text-[11px] text-ink-40">
                <span>地区：{country} · {city} · {device}</span>
                <span>查询时间：{new Date(result.fetchedAt).toLocaleString("zh-CN")}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Toast />
    </div>
  );
}

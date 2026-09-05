"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
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

// 地区/城市显示名（仅 UI 展示；API location 参数值保持中文原值不变）
const LOCALE_DISPLAY: Record<"en" | "zh", Record<string, string>> = {
  zh: {},
  en: {
    "中国": "China", "美国": "United States", "英国": "United Kingdom",
    "日本": "Japan", "香港": "Hong Kong", "台湾": "Taiwan",
    "北京": "Beijing", "上海": "Shanghai", "广州": "Guangzhou", "深圳": "Shenzhen",
    "纽约": "New York", "洛杉矶": "Los Angeles", "芝加哥": "Chicago",
    "伦敦": "London", "曼彻斯特": "Manchester", "东京": "Tokyo", "大阪": "Osaka", "台北": "Taipei",
  },
};

export default function RankCheckPage() {
  const t = useTranslations("dashboard.rankCheck");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const { show, Toast } = useToast();
  const [device, setDevice] = useState<Device>("PC");
  const [country, setCountry] = useState(RANK_LOCATIONS[0]);

  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<RankResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  const handleRegionChange = (region: string) => {
    setCountry(region);
  };

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = keyword.trim();
    const dm = domain.trim();
    if (!kw) {
      show(t("errKeyword"), "error");
      return;
    }
    if (!dm) {
      show(t("errDomain"), "error");
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
        const { message } = handleBillingError(json, t("queryFailed"));
        setError(message);
        show(message, "error");
        return;
      }
      setResult(json.data);
      if (json.data?.fromCache) {
        show(t("cacheHit"), "info");
      } else {
        show(t("queryDone"), "success");
      }
    } catch (err) {
      const msg = `${tc("networkError")} ${(err as Error).message}`;
      setError(msg);
      show(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* 查询表单 */}
      <form onSubmit={handleCheck} className="card-a mt-6 p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="text-xs text-ink-40">{t("keyword")}</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("keywordPlaceholder")}
              className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-40">{t("domain")}</label>
            <DomainSelect
              value={domain}
              onChange={setDomain}
              placeholder="example.com"
              className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-40">{t("region")}</label>
            <select
              value={country}
              onChange={(e) => handleRegionChange(e.target.value)}
              className="rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none"
            >
              {RANK_LOCATIONS.map((c) => (
                <option key={c} value={c}>{display(c)}</option>
              ))}
            </select>

          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-40">{t("device")}</label>
            <div className="flex gap-2">
              {(["PC", "移动端"] as Device[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className={device === d ? "btn-primary" : "btn-secondary"}
                >
                  {d === "PC" ? "PC" : locale === "zh" ? "移动端" : "Mobile"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary ml-auto disabled:opacity-60"
          >
            {loading ? t("querying") : t("queryBtn")}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-line-soft bg-line-soft/40 px-3 py-2 text-xs text-ink-60">
          {t("quotaHint")}
        </div>
      </form>

      {/* 查询结果 */}
      {hasQueried && (
        <div className="card-a mt-6 p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
              <div className="mt-3 text-sm text-ink-60">{t("fetching")}</div>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 text-sm text-neg">
              {error}
            </div>
          ) : result ? (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-ink-40">{t("resultKeyword")}</div>
                  <div className="mt-0.5 text-base font-semibold text-ink">{result.keyword}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-ink-40">{t("resultDomain")}</div>
                  <div className="mt-0.5 font-mono text-sm text-ink-60">{result.domain}</div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-line bg-line-soft/30 px-5 py-6 text-center">
                {result.rank === null ? (
                  <>
                    <div className="text-2xl font-semibold text-ink-40">{t("notInTop100")}</div>
                    <div className="mt-2 text-xs text-ink-40">
                      {t("notInTop100Detail", { domain: result.domain, keyword: result.keyword })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-ink-40">{t("currentRank")}</span>
                      {result.fromCache && (
                        <span className="badge-warn">{t("cachedData")}</span>
                      )}
                    </div>
                    <div className="mt-2 text-5xl font-semibold text-ink">#{result.rank}</div>
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

              <div className="mt-4 flex items-center justify-between text-xs text-ink-40">
                <span>{t("regionLabel")}：{display(country)} · {device === "PC" ? "PC" : locale === "zh" ? "移动端" : "Mobile"}</span>
                <span>{t("queryTime")}：{new Date(result.fetchedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Toast />
    </div>
  );
}

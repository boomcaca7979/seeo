"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber, intlLocale, type Locale } from "@/lib/ui-locale";

// ===== 公开外链检查器（/tools/backlink-checker 的交互核心）=====
// 无需登录：输入域名 → 调用 /api/tools/backlink-checker → 展示真实预览结果。
// 结果区的字段全部来自接口返回（DataForSEO + SeeO 持久化快照），不做任何前端推算。

interface PublicBacklinkSample {
  sourceUrl: string | null;
  anchor: string | null;
  targetUrl: string | null;
  dofollow: boolean | null;
  sourceRank: number | null;
  firstSeen: string | null;
}

interface PublicBacklinkPreview {
  domain: string;
  summary: {
    totalBacklinks: number | null;
    referringDomains: number | null;
    domainRank: number | null;
    dofollowPct: number | null;
  };
  sample: PublicBacklinkSample[];
  sampleDofollow: number;
  storedLinks: number;
  cachedAt: string | null;
  fromCache: boolean;
  preview: { sampleLimit: number; storedLimit: number; cacheDays: number };
}

/** 错误码 → messages 中的错误文案 key（前端只认识错误码，不解析服务端文案）
 *  code 取值与 src/lib/errors/api-error-codes.ts 保持一致。 */
const ERROR_KEYS: Record<string, string> = {
  INVALID_DOMAIN: "errInvalidDomain",
  PRIVATE_HOST: "errPrivateHost",
  BACKLINK_COOLDOWN: "errCooldown",
  CHECKER_DAILY_LIMIT: "errIpLimit",
  CHECKER_RATE_LIMITED: "errBurst",
  CHECKER_BUDGET_EXHAUSTED: "errBudget",
  DATAFORSEO_NOT_CONFIGURED: "errUnavailable",
  CHECKER_UNAVAILABLE: "errUnavailable",
  UPSTREAM_TIMEOUT: "errTimeout",
  UPSTREAM_ERROR: "errUpstream",
  INVALID_JSON: "errGeneric",
  PAYLOAD_TOO_LARGE: "errGeneric",
  METHOD_NOT_ALLOWED: "errGeneric",
  NETWORK: "errGeneric",
};

/** 只有 1 分钟 ~ 2 小时的等待才值得展示具体时长（日额度类会让人等十几个小时，反而不必报分钟数） */
function retryMinutes(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 60 || seconds > 7200) return null;
  return Math.ceil(seconds / 60);
}

function formatDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const parsed = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(intlLocale(locale), { hour12: false });
}

export default function BacklinkChecker() {
  const t = useTranslations("backlinkChecker.checker");
  const tr = useTranslations("backlinkChecker.results");
  const locale = useLocale() as Locale;

  const [domainInput, setDomainInput] = useState("");
  const [data, setData] = useState<PublicBacklinkPreview | null>(null);
  const [error, setError] = useState<{ key: string; minutes: number | null } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;

    const value = domainInput.trim();
    if (!value) {
      setError({ key: "errInvalidDomain", minutes: null });
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/tools/backlink-checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: value }),
      });
      const json = (await res.json()) as {
        data?: PublicBacklinkPreview;
        code?: string;
        retryAfterSeconds?: number;
      };

      if (!res.ok || !json.data) {
        const key = ERROR_KEYS[json.code ?? ""] ?? "errGeneric";
        const seconds = typeof json.retryAfterSeconds === "number" ? json.retryAfterSeconds : 0;
        setError({ key, minutes: retryMinutes(seconds) });
        return;
      }

      setData(json.data);
    } catch {
      setError({ key: "errGeneric", minutes: null });
    } finally {
      setLoading(false);
    }
  }

  const num = (value: number | null) => (value === null || value === undefined ? "—" : formatNumber(value, locale));

  const metrics = data
    ? [
        { key: "totalBacklinks", value: num(data.summary.totalBacklinks) },
        { key: "referringDomains", value: num(data.summary.referringDomains) },
        { key: "domainRank", value: num(data.summary.domainRank) },
        { key: "dofollowPct", value: data.summary.dofollowPct === null ? "—" : `${data.summary.dofollowPct}%` },
      ]
    : [];

  return (
    <div className="w-full">
      {/* ---------- 输入区 ---------- */}
      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl">
        <div className="flex h-14 flex-col overflow-hidden rounded-lg border border-line bg-card transition-colors focus-within:border-ink sm:flex-row sm:items-stretch">
          <input
            type="text"
            value={domainInput}
            onChange={(event) => {
              setDomainInput(event.target.value);
              if (error) setError(null);
            }}
            placeholder={t("placeholder")}
            aria-label={t("label")}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent px-4 font-mono text-base text-ink placeholder:text-ink-40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-14 w-full flex-none rounded-none border-0 bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50 sm:h-auto sm:w-auto sm:whitespace-nowrap"
          >
            {loading ? t("submitting") : t("submit")}
          </button>
        </div>
        <p className="mt-2 text-left font-sans text-xs text-ink-40">{t("note")}</p>
      </form>

      {/* ---------- 错误 ---------- */}
      {error && (
        <div className="mx-auto mt-4 max-w-2xl">
          <div className="card-a border-neg/30 bg-neg/5 p-4">
            <p className="font-sans text-sm text-neg">{t(error.key)}</p>
            {error.minutes !== null && (
              <p className="mt-1 font-sans text-xs text-ink-60">{t("errRetryAfter", { minutes: error.minutes })}</p>
            )}
          </div>
        </div>
      )}

      {/* ---------- 加载 ---------- */}
      {loading && (
        <div className="mx-auto mt-8 max-w-4xl" aria-live="polite">
          <div className="flex items-center gap-2 font-sans text-sm text-ink-60">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 loading-spin">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {t("loading")}
          </div>
        </div>
      )}

      {/* ---------- 结果 ---------- */}
      {data && !loading && (
        <div className="mx-auto mt-8 w-full max-w-4xl" aria-live="polite">
          {/* 结果头 + 数据新鲜度 */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-ink">
              {tr("heading", { domain: data.domain })}
            </h2>
            <span className="font-mono text-xs text-ink-40">
              {data.fromCache
                ? tr("freshFromCache", { date: formatDateTime(data.cachedAt, locale) })
                : tr("freshFetched", { date: formatDateTime(data.cachedAt, locale) })}
            </span>
          </div>

          {/* 指标卡 */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.key} className="card-a p-4">
                <div className="font-sans text-xs text-ink-40">{tr(`metrics.${metric.key}`)}</div>
                <div className="mt-1 font-display text-2xl font-semibold text-ink">{metric.value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 font-sans text-xs text-ink-40">{tr("metricsNote", { days: data.preview.cacheDays })}</p>

          {/* 外链样本 */}
          <div className="card-a mt-6 overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft px-4 py-3">
              <span className="font-display text-sm font-semibold text-ink">{tr("sampleTitle")}</span>
              <span className="font-mono text-xs text-ink-40">
                {data.storedLinks > 0
                  ? tr("sampleMeta", { shown: data.sample.length, stored: data.storedLinks })
                  : tr("sampleEmptyMeta")}
              </span>
            </div>

            {data.sample.length === 0 ? (
              <div className="px-4 py-8 text-center font-sans text-sm text-ink-40">{tr("sampleEmpty")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-line-soft">
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{tr("thSource")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{tr("thAnchor")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{tr("thType")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{tr("thRank")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{tr("thFirstSeen")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sample.map((item, index) => (
                      <tr key={index} className="border-b border-line-soft last:border-0">
                        {/* 来源页以纯文本展示，刻意不渲染为可点击链接 */}
                        <td className="max-w-[280px] px-4 py-3 font-mono text-sm text-ink break-all">
                          {item.sourceUrl ?? "—"}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 font-sans text-sm text-ink-60">
                          {item.anchor ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {item.dofollow === null ? (
                            <span className="text-ink-40">—</span>
                          ) : item.dofollow ? (
                            <span className="badge-info">{tr("dofollow")}</span>
                          ) : (
                            <span className="badge-warn">{tr("nofollow")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-ink-60">{item.sourceRank ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-sm text-ink-60">{item.firstSeen ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-line-soft px-4 py-2 font-sans text-xs text-ink-40">
              {tr("sampleNote", { sampleLimit: data.preview.sampleLimit, storedLimit: data.preview.storedLimit })}
            </div>
          </div>

          {/* 样本内 dofollow 统计 */}
          <p className="mt-2 font-sans text-xs text-ink-40">
            {tr("sampleDofollow", { dofollow: data.sampleDofollow, total: data.sample.length })}
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError, resolveApiErrorMessage } from "@/lib/billing-error-client";
import { TableSkeleton } from "@/components/dashboard/Skeleton";
import DomainSelect from "@/components/dashboard/DomainSelect";
import { useEntitlements } from "@/components/billing/EntitlementsContext";
import { decideEntitlementFetch } from "@/lib/entitlement-fetch";
import { formatNumber, intlLocale, type Locale } from "@/lib/ui-locale";
import PageHeader from "@/components/viz/PageHeader";
import MetricCard from "@/components/viz/MetricCard";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { DistributionBar } from "@/components/viz/DistributionBar";

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

function formatTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(intlLocale(locale), { hour12: false });
  } catch {
    return iso;
  }
}

function formatNum(n: number | null, locale: Locale): string {
  if (n === null || n === undefined) return "—";
  return formatNumber(n, locale);
}

export default function BacklinksPage() {
  // useSearchParams 需要 Suspense 边界（静态预渲染时回退为 CSR）
  return (
    <Suspense fallback={null}>
      <BacklinksPageInner />
    </Suspense>
  );
}

function BacklinksPageInner() {
  const t = useTranslations("dashboard.backlinks");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as Locale;
  const { show, Toast } = useToast();
  const { features, loading: entitlementsLoading } = useEntitlements();
  // 初始值必须为空字符串：SSR 与客户端 hydration 首帧渲染一致，避免 hydration mismatch。
  // 记忆域名在挂载 effect 中恢复（见下方 initRef effect），域名记忆功能保持不变。
  const [domain, setDomain] = useState("");
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
        setError(resolveApiErrorMessage(json, undefined, t("loadFailed")) || t("loadFailed"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 挂载时确定域名（优先级：URL ?domain= > localStorage 上次查询域名），
  // 但**不在此处发请求**：外链是 Pro 专属，权益未确定/无权限时请求只会拿到 403。
  // 域名先落到 autoDomain，由下面的权益门控 effect 决定何时真正加载。
  // initRef 保证只解析一次（StrictMode 双执行下第二次被跳过）。
  const searchParams = useSearchParams();
  const initRef = useRef(false);
  const [autoDomain, setAutoDomain] = useState("");
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const queryDomain = (searchParams.get("domain") ?? "").trim();
    let saved = "";
    if (!queryDomain) {
      try {
        saved = (localStorage.getItem("seeo:last-backlink-domain") ?? "").trim();
      } catch {
        // ignore
      }
    }
    const target = queryDomain || saved;
    if (!target) return;
    setDomain(target);
    setAutoDomain(target);
  }, [searchParams]);

  // 三态门控：套餐未加载 → 等待；已确认无权限 → 不发请求（后端 guard 原样保留）；
  // 已确认有权限 → 每个域名只自动加载一次（ref 去重，避免重渲染或重进入时重复请求）。
  const autoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (decideEntitlementFetch({ loading: entitlementsLoading, allowed: features.backlinks }) !== "fetch") {
      return;
    }
    if (!autoDomain || autoLoadedRef.current === autoDomain) return;
    autoLoadedRef.current = autoDomain;
    void loadCache(autoDomain);
  }, [autoDomain, entitlementsLoading, features.backlinks, loadCache]);

  const handleDomainChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = domain.trim();
    if (!d) return;
    await loadCache(d);
  };

  const handleAnalyze = async () => {
    const d = domain.trim();
    if (!d) {
      show(t("errDomain"), "error");
      return;
    }
    setAnalyzing(true);
    setError(null);
    show(t("fetchingToast"), "info");
    try {
      const res = await fetch("/api/backlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("fetchFailed"));
        setError(message);
        show(message, "error");
        return;
      }
      try {
        localStorage.setItem("seeo:last-backlink-domain", d);
      } catch {
        // ignore
      }
      setData(json.data);
      show(json.data?.fromCache ? t("cacheHitToast") : t("fetchDoneToast"), "success");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      show(`${tc("networkError")} ${msg}`, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const hasData = data !== null;

  // Feature Gate：backlinks 为 Pro 专属功能
  if (!entitlementsLoading && !features.backlinks) {
    return (
      <div className="dash-container p-6 lg:p-8">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="card-a mt-6 p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-brand">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="mt-5 font-display text-lg font-semibold text-ink">{t("proTitle")}</h2>
          <p className="mt-2 font-sans text-sm text-ink-60">
            {t("proDesc")}
          </p>
          <Link href="/pricing" className="mt-5 inline-block btn-primary text-sm">
            {t("upgradeToPro")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-container p-4 lg:p-8">
      {/* 页头：标题 + 副标题 + 当前域名元信息 */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        meta={domain.trim() ? <span>{domain.trim()}</span> : null}
      />

      {/* 工具栏：选域名查缓存 / 一键拉取 */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form onSubmit={handleDomainChange} className="flex items-end gap-2">
          <div>
            <label className="font-sans text-xs text-ink-40">{t("analyzeDomain")}</label>
            <DomainSelect
              value={domain}
              onChange={(d) => {
                setDomain(d);
                try { localStorage.setItem("seeo:last-backlink-domain", d); } catch { /* ignore */ }
              }}
              className="mt-2 w-48 rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <button type="submit" className="btn-secondary">
            {t("viewBtn")}
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
              {t("analyzingBtn")}
            </>
          ) : (
            t("analyzeBtn")
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
              <div className="font-display text-sm font-semibold text-neg">{t("fetchFailedTitle")}</div>
              <p className="mt-1 font-sans text-sm text-ink-60">{error}</p>
              {domain && (
                <p className="mt-1 font-sans text-xs text-ink-40">{t("domainIs", { domain })}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 指标卡：口径各不相同，字段缺失时诚实降级（不用 0 冒充） */}
      {!loading && !error && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            hintStyle="plain"
            label={t("metricTotalBacklinks")}
            value={hasData && data!.summary.totalBacklinks !== null ? formatNum(data!.summary.totalBacklinks, locale) : null}
            unavailableLabel="—"
            unavailableReason={hasData ? undefined : t("metricNoData")}
            caption={t("metricTotalBacklinksCaption")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("metricReferringDomains")}
            value={hasData && data!.summary.referringDomains !== null ? formatNum(data!.summary.referringDomains, locale) : null}
            unavailableLabel="—"
            unavailableReason={hasData ? undefined : t("metricNoData")}
            caption={t("metricReferringDomainsCaption")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("metricAuthority")}
            value={hasData && data!.summary.domainRank !== null ? formatNum(data!.summary.domainRank, locale) : null}
            unavailableLabel="—"
            unavailableReason={hasData ? undefined : t("metricNoData")}
            caption={t("metricAuthorityCaption")}
          />
          <MetricCard
            hintStyle="plain"
            label={t("metricDofollow")}
            value={hasData && data!.summary.dofollowPct !== null ? `${data!.summary.dofollowPct}%` : null}
            unavailableLabel="—"
            unavailableReason={hasData ? undefined : t("metricNoData")}
            caption={t("metricDofollowCaption")}
          />
        </div>
      )}

      {/* DoFollow 分布（仅当占比可得时绘制，不虚构） */}
      {!loading && !error && hasData && data!.summary.dofollowPct !== null && (
        <div className="card-a mt-6 p-5">
          <h2 className="font-display text-lg font-semibold text-ink">{t("distTitle")}</h2>
          <p className="mt-1 font-mono text-xs text-ink-40">{t("distHint")}</p>
          <div className="mt-4">
            <DistributionBar
              label={t("distTitle")}
              segments={[
                { key: "dofollow", label: "DoFollow", value: data!.summary.dofollowPct!, tone: "pos" },
                { key: "nofollow", label: "NoFollow", value: Math.max(0, 100 - data!.summary.dofollowPct!), tone: "neutral" },
              ]}
            />
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 font-mono text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-ink-60">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-pos" aria-hidden />
                  DoFollow
                </span>
                <span className="shrink-0 text-ink">{data!.summary.dofollowPct}%</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 font-mono text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-ink-60">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-ink-25" aria-hidden />
                  NoFollow
                </span>
                <span className="shrink-0 text-ink">{Math.max(0, 100 - data!.summary.dofollowPct!)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 外链明细 */}
      {!loading && !error && hasData && (
        <div className="card-a mt-6 overflow-hidden">
          <div className="border-b border-line-soft px-5 py-3">
            <h2 className="inline font-display text-lg font-semibold text-ink">{t("detailsTitle")}</h2>
            <span className="ml-2 font-mono text-xs text-ink-40">
              {t("detailsMeta", { n: data!.backlinks.length })}
            </span>
          </div>
          {data!.backlinks.length === 0 ? (
            <div className="px-4 py-10 text-center font-sans text-sm text-ink-40">
              {t("detailsEmpty")}
            </div>
          ) : (
            <DataTable minWidthRem={46} ariaLabel={t("detailsTitle")}>
              <THead>
                <Th>{t("thSource")}</Th>
                <Th width="13rem">{t("thAnchor")}</Th>
                <Th width="7.5rem">{t("thType")}</Th>
                <Th width="6.5rem" align="right">Rank</Th>
                <Th width="11rem">{t("thFirstSeen")}</Th>
              </THead>
              <TBody>
                {data!.backlinks.map((b, i) => (
                  <TR key={i} className="hover:bg-line-soft/50">
                    <TD className="max-w-[24rem]">
                      <span className="block truncate font-mono text-xs text-ink" title={b.sourceUrl ?? undefined}>
                        {b.sourceUrl ?? "—"}
                      </span>
                    </TD>
                    <TD className="max-w-[13rem]">
                      <span className="block truncate text-ink-60" title={b.anchor ?? undefined}>
                        {b.anchor ?? "—"}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {b.dofollow === null ? (
                        <span className="text-ink-40">—</span>
                      ) : b.dofollow ? (
                        <span className="badge-info">DoFollow</span>
                      ) : (
                        <span className="badge-warn">NoFollow</span>
                      )}
                    </TD>
                    <TD numeric className="text-ink-60">{b.sourceRank ?? "—"}</TD>
                    <TD className="whitespace-nowrap font-mono text-xs text-ink-60">{b.firstSeen ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </DataTable>
          )}
          <div className="border-t border-line-soft px-5 py-2 font-sans text-xs text-ink-40">
            {t("dataFrom", { time: formatTime(data!.cachedAt, locale) })}
            {data!.fromCache && <span className="ml-2 text-ink-40">{t("cacheHitNote")}</span>}
          </div>
        </div>
      )}

      {/* 空态引导 */}
      {!loading && !error && !hasData && (
        <div className="card-a mt-6 p-10 text-center">
          <div className="font-display text-base font-semibold text-ink-60">{t("emptyTitle")}</div>
          <p className="mt-2 font-sans text-sm text-ink-40">
            {t("emptyDesc")}
          </p>
        </div>
      )}

      <Toast />
    </div>
  );
}

// ===== 关键词策略构造器 · 页面状态容器 =====
// 空态 → 创建（真实 API）→ 轮询进度 → 结果态（真实策略数据）。
// URL 上带 ?id= 即可直接打开已保存策略（刷新恢复，零供应商请求）。
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { BUILDER_COPY } from "./copy";
import { EmptyState, type MarketId } from "./EmptyState";
import { ResultsView, type StrategyViewData } from "./ResultsView";
import type { StrategyDoc } from "@/lib/seo/strategy-model";

type StrategyState = Omit<StrategyViewData, "doc"> & { doc: StrategyDoc | null };

function GeneratingScreen({ strategy }: { strategy: StrategyState }) {
  return (
    <div className="px-6 py-12">
      <div className="mx-auto w-full max-w-[930px] rounded-md bg-white px-6 py-10 text-center">
        <h1 className="text-[1.375rem] leading-[30px] font-semibold text-[#1a1e19]">正在生成关键词策略…</h1>
        <p className="mt-2 text-[0.875rem] leading-[22px] text-[#4b4d4a]">
          正在用 SerpApi 抓取「{strategy.seeds.join("、")}」的真实搜索结果（{strategy.market}）。
        </p>
        <div className="mx-auto mt-6 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-[#e3e4e3]">
          <span
            className="block h-full rounded-full bg-[#8796ef] transition-all"
            style={{ width: `${Math.max(5, strategy.progress)}%` }}
          />
        </div>
        <p className="mt-2 text-[0.8125rem] text-[#6b6c6b] tabular-nums">{strategy.progress}%</p>
        <p className="mt-6 text-[0.75rem] leading-[18px] text-[#8a8c89]">
          可以离开或刷新页面：任务在服务端继续执行，重新打开后会恢复进度与结果。
        </p>
      </div>
    </div>
  );
}

export default function KeywordStrategyBuilder() {
  const locale = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const copy = BUILDER_COPY[lang];
  const searchParams = useSearchParams();
  const initialSeed = (searchParams.get("seed") ?? "").trim();
  const idParam = searchParams.get("id");
  const { show, Toast } = useToast();

  const [strategy, setStrategy] = useState<StrategyState | null>(null);
  const [market, setMarket] = useState<MarketId>("us");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(idParam));
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStrategy = useCallback(async (id: number, silent = false) => {
    try {
      const res = await fetch(`/api/keywords/strategies/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (!silent) setLoadError(json.error ?? "策略加载失败");
        return null;
      }
      setStrategy(json.data as StrategyState);
      setLoadError(null);
      return json.data as StrategyState;
    } catch {
      if (!silent) setLoadError("策略加载失败，请检查网络后重试");
      return null;
    }
  }, []);

  // 直接打开已保存的策略（延迟一拍，避免 effect 同步体内 setState）
  useEffect(() => {
    if (!idParam) return;
    const id = Number(idParam);
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!Number.isInteger(id) || id <= 0) {
        setLoading(false);
        setLoadError("策略 id 无效");
        return;
      }
      setLoading(true);
      void loadStrategy(id).finally(() => {
        if (alive) setLoading(false);
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [idParam, loadStrategy]);

  const running = strategy?.status === "running";
  const strategyId = strategy?.id;

  // 生成中轮询：先查进度（轻量），状态变化后再取完整结果
  useEffect(() => {
    if (!running || !strategyId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/keywords/strategies/${strategyId}?progress=1`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const progress = Number(json.data?.progress ?? 0);
        setStrategy((prev) => (prev && prev.id === strategyId ? { ...prev, progress } : prev));
        if (json.data?.status !== "running") {
          await loadStrategy(strategyId, true);
        }
      } catch {
        // 网络抖动：下一轮继续
      }
    }, 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [running, strategyId, loadStrategy]);

  const createStrategy = useCallback(
    async (seeds: string[], marketId: MarketId) => {
      setBusy(true);
      try {
        const res = await fetch("/api/keywords/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seeds, market: marketId, device: "PC" }),
        });
        const json = await res.json();
        if (!res.ok) {
          show(json.error ?? "创建失败", "error");
          return;
        }
        const id: number = json.data.id;
        window.history.replaceState(null, "", `?id=${id}`);
        await loadStrategy(id);
        const warning = json.meta?.quota?.warning as string | undefined;
        show(
          json.data.duplicate
            ? "已存在相同策略，直接打开"
            : warning ?? "已开始生成真实策略",
          warning ? "info" : "info"
        );
      } catch {
        show("创建失败，请稍后重试", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadStrategy, show]
  );

  const notify = useCallback(
    (message: string, kind: "info" | "error" = "info") => show(message, kind),
    [show]
  );

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f5f5] px-6 py-16 text-center text-[0.875rem] text-[#4b4d4a]">
        正在加载策略…
        <Toast />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-full bg-[#f4f5f5] px-6 py-16 text-center">
        <p className="text-[0.875rem] text-[#c0392b]">{loadError}</p>
        <Link href="/app/keyword-strategy" className="mt-3 inline-block text-[0.8125rem] text-[#245ee2] hover:underline">
          返回新建策略
        </Link>
        <Toast />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f4f5f5] text-[#1a1e19]">
      {!strategy ? (
        <EmptyState
          copy={copy}
          lang={lang}
          initialSeeds={initialSeed}
          market={market}
          onMarketChange={setMarket}
          onCreate={createStrategy}
          onError={(message) => show(message, "info")}
          busy={busy}
        />
      ) : strategy.doc ? (
        <ResultsView
          strategy={{ ...strategy, doc: strategy.doc }}
          onChanged={setStrategy}
          onNotify={notify}
        />
      ) : (
        <GeneratingScreen strategy={strategy} />
      )}
      <Toast />
    </div>
  );
}

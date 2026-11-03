// ===== 空态：种子关键词输入（对齐参考图第一张）=====
"use client";

import { useEffect, useMemo, useState } from "react";
import type { BuilderCopy } from "./copy";
import { Check, ChevronDown, Cross } from "./icons";

export const MARKETS = [
  { id: "us", flag: "🇺🇸", zh: "美国", en: "United States" },
  { id: "uk", flag: "🇬🇧", zh: "英国", en: "United Kingdom" },
  { id: "cn", flag: "🇨🇳", zh: "中国", en: "China" },
  { id: "jp", flag: "🇯🇵", zh: "日本", en: "Japan" },
  { id: "de", flag: "🇩🇪", zh: "德国", en: "Germany" },
  { id: "hk", flag: "🇭🇰", zh: "香港", en: "Hong Kong" },
  { id: "tw", flag: "🇨🇳", zh: "台湾", en: "Taiwan" },
] as const;

export type MarketId = (typeof MARKETS)[number]["id"];

export function EmptyState({
  copy,
  lang,
  initialSeeds,
  market,
  onMarketChange,
  onCreate,
  onError,
  busy = false,
}: {
  copy: BuilderCopy;
  lang: "zh" | "en";
  initialSeeds: string;
  market: MarketId;
  onMarketChange: (id: MarketId) => void;
  onCreate: (seeds: string[], market: MarketId) => void;
  onError: (message: string) => void;
  busy?: boolean;
}) {
  const [seeds, setSeeds] = useState(initialSeeds);
  const [marketOpen, setMarketOpen] = useState(false);
  // 参考图里左侧提示卡是常驻显示的；这里默认展开，首次交互（点击/滚动）后收起，仍可 hover/focus 唤出。
  const [tipPinned, setTipPinned] = useState(true);
  const [tipHover, setTipHover] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!tipPinned) return;
    const dismiss = () => setTipPinned(false);
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("scroll", dismiss, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [tipPinned]);

  const tipVisible = (tipPinned && wide) || tipHover;

  const lines = useMemo(() => seeds.split("\n").filter((l) => l.trim().length > 0), [seeds]);
  const count = Math.min(lines.length, 5);
  const activeMarket = MARKETS.find((m) => m.id === market) ?? MARKETS[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      onError(copy.seedRequired);
      return;
    }
    if (lines.length > 5) {
      onError(lang === "zh" ? "最多输入 5 个种子关键词" : "Enter at most 5 seed keywords");
      return;
    }
    onCreate(lines, market);
  };

  return (
    <div className="px-6 py-10">
      <div className="mx-auto w-full max-w-[930px] rounded-md bg-white px-6 pt-10 pb-8 shadow-[0_1px_2px_rgba(26,30,25,0.05)]" style={{ borderRadius: 6 }}>
        <h1 className="text-center text-[1.875rem] leading-[36px] font-semibold tracking-[-0.4px] text-[#1a1e19]">{copy.title}</h1>
        <p className="mt-3 text-center text-[0.9375rem] leading-[20px] text-[#4b4d4a]">{copy.subtitle}</p>

        <form onSubmit={submit} className="mx-auto mt-9 w-full max-w-[688px]">
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onMouseEnter={() => setTipHover(true)}
              onMouseLeave={() => setTipHover(false)}
              onFocus={() => setTipHover(true)}
              onBlur={() => setTipHover(false)}
              aria-describedby="seed-hint"
              className="border-b border-dotted border-[#8a8c89] text-[0.875rem] leading-[22px] text-[#1a1e19]"
            >
              {copy.seedLabel}
            </button>
            <span className="inline-flex h-5 items-center rounded-full border border-[#d6d8d7] px-2 text-[0.75rem] text-[#4b4d4a] tabular-nums">
              {count} / 5
            </span>

            {tipVisible && (
              <div
                id="seed-hint"
                role="tooltip"
                className="pointer-events-none absolute top-full left-0 z-20 mt-2 w-[205px] rounded-md border border-[#e3e4e3] bg-white p-3 shadow-[0_6px_20px_rgba(26,30,25,0.14)] xl:top-1/2 xl:right-full xl:left-auto xl:mt-0 xl:mr-3 xl:-translate-y-1/2"
              >
                <p className="text-[0.75rem] leading-[18px] font-semibold text-[#1a1e19]">{copy.tipTitle}</p>
                <ul className="mt-1.5 space-y-1">
                  {copy.tipBad.map((t) => (
                    <li key={t} className="flex items-center gap-2 text-[0.75rem] leading-[18px] text-[#1a1e19]">
                      <Cross className="h-3 w-3 shrink-0 text-[#e0342b]" />
                      {t}
                    </li>
                  ))}
                  {copy.tipGood.map((t) => (
                    <li key={t} className="flex items-center gap-2 text-[0.75rem] leading-[18px] text-[#1a1e19]">
                      <Check className="h-3 w-3 shrink-0 text-[#12a06a]" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <textarea
            value={seeds}
            onChange={(e) => setSeeds(e.target.value)}
            spellCheck={false}
            aria-label={copy.seedLabel}
            placeholder={`1.  ${copy.exampleSeeds[0]}\n2.  `}
            className="mt-2 h-[88px] w-full resize-none rounded-md border-2 border-[#8796ef] bg-white px-3 py-2 text-[0.9375rem] leading-[26px] text-[#1a1e19] outline-none placeholder:text-[#b3b5b8] focus:border-[#6d70e6]"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSeeds(copy.exampleSeeds.join("\n"))}
              className="text-[0.875rem] leading-[22px] text-[#1a1e19] hover:underline hover:underline-offset-4"
            >
              {copy.viewExample}
            </button>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMarketOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={marketOpen}
                  className="inline-flex h-9 items-center gap-2 rounded-sm border border-[#d6d8d7] bg-white px-3 text-[0.875rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
                >
                  <span aria-hidden="true">{activeMarket.flag}</span>
                  <span>{lang === "zh" ? activeMarket.zh : activeMarket.en}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-[#4b4d4a]" />
                </button>
                {marketOpen && (
                  <>
                    <button type="button" aria-label="Close market menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMarketOpen(false)} />
                    <ul role="listbox" className="absolute right-0 z-20 mt-1 w-[180px] rounded-md border border-[#e3e4e3] bg-white py-1 shadow-[0_6px_20px_rgba(26,30,25,0.14)]">
                      {MARKETS.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={m.id === market}
                            onClick={() => {
                              onMarketChange(m.id);
                              setMarketOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f4f5f5]"
                          >
                            <span aria-hidden="true">{m.flag}</span>
                            {lang === "zh" ? m.zh : m.en}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center rounded-sm bg-[#191c19] px-5 text-[0.875rem] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (lang === "zh" ? "创建中…" : "Creating…") : copy.create}
              </button>
            </div>
          </div>
        </form>

        <div className="mx-auto mt-5 w-full max-w-[688px] border-t border-[#e9eae9]" />

        <p className="mt-5 text-center text-[0.875rem] leading-[22px] text-[#4b4d4a]">
          {copy.trialBefore}
          <button type="button" onClick={() => onError(copy.phase2(copy.trialLink))} className="text-[#245ee2] hover:underline">
            {copy.trialLink}
          </button>
          {copy.trialAfter}
        </p>
      </div>
    </div>
  );
}

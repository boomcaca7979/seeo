"use client";

// ===== 关键词研究四页共享 UI 原语 =====
// 关键词概览 / 魔法工具 / 策略构造器 / 已保存关键词 共用：
// 搜索入口（Semrush 式大搜索框）、市场/设备选择、来源/意图徽标、指标格式化、CSV 导出。
// 诚实边界与 keyword-expand 一致：null 一律显示「—」，绝不把缺失当 0。

import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/ui-locale";
import type { KeywordIntent } from "@/lib/seo/keyword-intent";
import type { KeywordOrigin } from "@/lib/seo/keyword-merge";

export const KEYWORD_LOCATIONS = ["中国", "美国", "英国", "日本", "香港", "台湾"];
export type Device = "PC" | "移动端";

// 地区/城市显示名（仅 UI 展示；API location 参数值保持中文原值不变）
export const LOCALE_DISPLAY: Record<"en" | "zh", Record<string, string>> = {
  zh: {},
  en: {
    "中国": "China", "美国": "United States", "英国": "United Kingdom",
    "日本": "Japan", "香港": "Hong Kong", "台湾": "Taiwan",
  },
};

export function useMarketDisplay() {
  const locale = useLocale() as "en" | "zh";
  return (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
}

export function deviceLabel(locale: "en" | "zh", d: Device): string {
  return d === "PC" ? "PC" : locale === "zh" ? "移动端" : "Mobile";
}

// ===== 搜索入口（Semrush 式：大搜索框为页面视觉中心）=====

export function KeywordSearchHero({
  searchValue,
  onSearchValueChange,
  location,
  onLocationChange,
  device,
  onDeviceChange,
  onSubmit,
  loading,
  submitLabel,
  placeholder,
  inputAriaLabel,
}: {
  searchValue: string;
  onSearchValueChange: (v: string) => void;
  location: string;
  onLocationChange: (v: string) => void;
  device: Device;
  onDeviceChange: (d: Device) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  submitLabel: string;
  placeholder: string;
  inputAriaLabel: string;
}) {
  const t = useTranslations("dashboard.keywords.shared");
  const display = useMarketDisplay();
  const locale = useLocale() as "en" | "zh";
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-40" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchValueChange(e.target.value)}
            placeholder={placeholder}
            aria-label={inputAriaLabel}
            className="h-12 w-full rounded-md border border-line bg-card py-2 pl-12 pr-4 text-base text-ink shadow-sm placeholder:text-ink-40 focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary h-12 px-8 text-sm disabled:opacity-60"
        >
          {loading ? t("searching") : submitLabel}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-40">
          {t("database")}
        </span>
        <select
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          aria-label={t("marketLabel")}
          className="h-9 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
        >
          {KEYWORD_LOCATIONS.map((c) => (
            <option key={c} value={c}>{display(c)}</option>
          ))}
        </select>
        <select
          value={device}
          onChange={(e) => onDeviceChange(e.target.value as Device)}
          aria-label={t("deviceLabel")}
          className="h-9 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
        >
          <option value="PC">PC</option>
          <option value="移动端">{locale === "zh" ? "移动端" : "Mobile"}</option>
        </select>
      </div>
    </form>
  );
}

// ===== 来源徽标 =====

const ORIGIN_LABEL_KEYS: Record<KeywordOrigin, string> = {
  seed: "originSeed",
  related: "originRelated",
  paa: "originPaa",
  autocomplete: "originAutocomplete",
  labs_suggestions: "originLabsSuggestions",
  labs_ideas: "originLabsIdeas",
  trends_queries: "originTrendsQueries",
  trends_topics: "originTrendsTopics",
  serp_content: "originSerpContent",
};

export function OriginBadge({ origin, compact = false }: { origin: KeywordOrigin; compact?: boolean }) {
  const t = useTranslations("dashboard.keywords.shared");
  // 视觉降噪：来源徽标统一中性灰（文字区分来源，色彩只留给状态语义）
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm border border-line text-ink-40 ${
        compact ? "px-1 py-0 font-sans text-xs leading-4" : "px-1.5 py-0.5 font-sans text-xs text-ink-60"
      }`}
    >
      {t(ORIGIN_LABEL_KEYS[origin])}
    </span>
  );
}

// ===== 意图徽标（文本规则估算，UI 必须标注）=====

export function intentText(value: KeywordIntent, zh: boolean): string {
  if (value === "信息型") return zh ? "信息型" : "Informational";
  if (value === "商业型") return zh ? "商业型" : "Commercial";
  if (value === "交易型") return zh ? "交易型" : "Transactional";
  if (value === "导航型") return zh ? "导航型" : "Navigational";
  return zh ? "未知" : "Unknown";
}

export function IntentBadge({ intent }: { intent: KeywordIntent }) {
  const locale = useLocale() as "en" | "zh";
  const zh = locale === "zh";
  // 视觉降噪：意图徽标统一中性描边（意图为估算值，不配高饱和色）
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-sm border border-line bg-card px-1.5 py-0.5 font-sans text-xs text-ink-60">
      {intentText(intent, zh)}
    </span>
  );
}

// ===== 指标格式化（null → 「—」，与 expand 工作台同一口径）=====

export function fmtVolume(v: number | null, locale: "en" | "zh"): string {
  return v === null ? "—" : formatNumber(v, locale);
}

export function fmtCpc(v: number | null, currency: string | null): string {
  if (v === null) return "—";
  const amount = v.toFixed(2);
  if (currency === "USD") return `$${amount}`;
  return currency ? `${amount} ${currency}` : amount;
}

// ===== CSV 导出（前端纯文本生成，BOM 兼容 Excel 中文）=====

export function exportCsv(filename: string, headers: string[], rows: (string | number | null)[]) : void {
  exportCsvRows(filename, headers, [rows]);
}

export function exportCsvRows(
  filename: string,
  headerRow: string[],
  dataRows: (string | number | null)[][]
): void {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headerRow.map(esc).join(","), ...dataRows.map((r) => r.map(esc).join(","))];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

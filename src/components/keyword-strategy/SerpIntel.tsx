"use client";

// ===== SERP Intelligence 面板 + Compare SERP 弹窗 + Strategy Priority 条 =====
//
// 全部基于策略已持久化的 compact SERP 快照与本地算法，零额外 API 成本；
// Compare SERP 缺快照时必须经用户确认才发起必要请求（额度预估前置）。

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "./dialogs";
import { classifySerpPageType, type SerpPageTypeResult } from "@/lib/seo/page-type-serp";
import { detectIntentEvidence } from "@/lib/seo/intent-evidence";
import { computeTopicPriorities, type TopicPriority } from "@/lib/seo/strategy-priority";
import type { StrategyDoc } from "@/lib/seo/strategy-model";
import type { SerpSnapshotMap } from "@/lib/seo/serp-snapshot";

// ---------- 公共小件 ----------

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color = confidence === "high" ? "bg-[#3aa76d]" : confidence === "medium" ? "bg-[#e8a33d]" : "bg-[#9a9c99]";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

const PAGE_TYPE_ZH: Record<string, string> = {
  product: "产品页",
  category: "类目页",
  "blog-article": "博客文章",
  "tutorial-guide": "教程/指南",
  comparison: "比较/评测",
  listicle: "清单推荐",
  "forum-community": "社区/问答",
  video: "视频",
  other: "其他",
  unknown: "Unknown",
};

// ---------- SERP Intelligence 面板 ----------

export function SerpIntelPanel({ doc, onNotify }: { doc: StrategyDoc; onNotify: (m: string, k?: "info" | "error") => void }) {
  const snapshots: SerpSnapshotMap = doc.meta.serpSnapshots ?? {};
  const seeds = Object.keys(snapshots);
  const [seedKey, setSeedKey] = useState(seeds[0] ?? "");

  if (seeds.length === 0) {
    return (
      <div className="rounded-md border border-[#e3e4e3] bg-white p-6 text-[0.8125rem] leading-[20px] text-[#4b4d4a]">
        <p className="font-semibold text-[#1a1e19]">暂无 SERP 快照</p>
        <p className="mt-2">
          该策略创建于快照功能上线之前，历史竞争数据不可用。不会自动重新调用 SerpApi；
          使用「Compare SERP」并确认后，才会按需获取所选关键词的快照（每次 1 调用，额度前置明示）。
        </p>
      </div>
    );
  }

  const snapshot = snapshots[seedKey] ?? snapshots[seeds[0]];
  const domainCounts = new Map<string, number>();
  const typedRows = snapshot.results.map((r) => {
    domainCounts.set(r.domain, (domainCounts.get(r.domain) ?? 0) + 1);
    const pt: SerpPageTypeResult = classifySerpPageType(r);
    return { ...r, pt };
  });
  const domainDist = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  const intent = detectIntentEvidence(snapshot.keyword, snapshot);

  return (
    <div className="space-y-4">
      {/* 种子选择 */}
      <div className="flex flex-wrap items-center gap-2">
        {seeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeedKey(s)}
            aria-pressed={s === seedKey}
            className={`h-8 rounded-sm border px-3 text-[0.8125rem] ${
              s === seedKey ? "border-[#8796ef] bg-[#eaeef6] text-[#245ee2]" : "border-[#d6d8d7] bg-white text-[#4b4d4a] hover:text-[#1a1e19]"
            }`}
          >
            {snapshots[s].keyword}
          </button>
        ))}
      </div>

      {/* Evidence metadata */}
      <div className="rounded-md border border-[#e3e4e3] bg-[#f7f8f7] p-3 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
        证据元数据：抓取时间 {snapshot.fetchedAt} · 市场 {snapshot.market} · 语言 {snapshot.language} · 设备 {snapshot.device} ·
        来源 {snapshot.fromCache ? "缓存" : "实时请求"}（快照保存于策略内，不随缓存过期消失）
      </div>

      {/* 意图摘要 */}
      <div className="rounded-md border border-[#e3e4e3] bg-white p-4">
        <h3 className="text-[0.8125rem] font-semibold text-[#1a1e19]">
          搜索意图（多证据）：<span className="text-[#245ee2]">{intent.primary}</span>
          {intent.secondary ? <span className="text-[#6b6c6b]">（次要 {intent.secondary}）</span> : null}
          <span className="ml-2 inline-flex items-center gap-1 text-[0.75rem] text-[#6b6c6b]">
            <ConfidenceDot confidence={intent.confidence} />
            {intent.confidence} confidence
          </span>
        </h3>
        <ul className="mt-2 space-y-1 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
          {intent.evidence.map((e, i) => (
            <li key={i}>· {e}</li>
          ))}
        </ul>
      </div>

      {/* Who is ranking */}
      <div className="rounded-md border border-[#e3e4e3] bg-white">
        <div className="border-b border-[#e9eae9] px-4 py-2 text-[0.8125rem] font-semibold text-[#1a1e19]">
          Who is ranking（{snapshot.keyword} · Top {snapshot.results.length}）
        </div>
        <div className="divide-y divide-[#eff0ef]">
          {typedRows.map((row) => (
            <div key={row.url} className="grid grid-cols-[36px_minmax(0,1fr)_130px] gap-3 px-4 py-2">
              <span className="pt-0.5 text-right font-mono text-[0.75rem] text-[#8a8c89]">#{row.position}</span>
              <div className="min-w-0">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-1 text-[0.8125rem] text-[#245ee2] hover:underline"
                  title={row.title}
                >
                  {row.title}
                </a>
                <p className="line-clamp-1 font-mono text-[0.6875rem] text-[#8a8c89]">{row.url}</p>
                {row.snippet ? <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-[18px] text-[#4b4d4a]">{row.snippet}</p> : null}
              </div>
              <div className="pt-0.5 text-right">
                <p className="truncate text-[0.6875rem] text-[#6b6c6b]" title={row.domain}>
                  {row.domain}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#f1f2f1] px-2 text-[0.6875rem] text-[#4b4d4a]">
                  {PAGE_TYPE_ZH[row.pt.type] ?? row.pt.type}
                  <ConfidenceDot confidence={row.pt.confidence} />
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Domain Distribution */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#e3e4e3] bg-white p-4">
          <h3 className="text-[0.8125rem] font-semibold text-[#1a1e19]">Domain Distribution</h3>
          <p className="mt-1 text-[0.6875rem] leading-[16px] text-[#8a8c89]">
            SERP 观察指标（域名集中度），不是 Keyword Difficulty。
          </p>
          <div className="mt-3 space-y-2">
            {domainDist.map(([domain, count]) => (
              <div key={domain} className="flex items-center gap-2">
                <span className="w-40 truncate text-[0.75rem] text-[#1a1e19]" title={domain}>
                  {domain}
                </span>
                <div className="h-3 min-w-0 flex-1 rounded-sm bg-[#f1f2f1]">
                  <div
                    className="h-3 rounded-sm bg-[#8796ef]"
                    style={{ width: `${Math.round((count / snapshot.results.length) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[0.75rem] text-[#4b4d4a]">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-[#e3e4e3] bg-white p-4">
          <h3 className="text-[0.8125rem] font-semibold text-[#1a1e19]">SERP Features</h3>
          <p className="mt-1 text-[0.6875rem] leading-[16px] text-[#8a8c89]">
            仅显示供应商真实返回的 feature；未列出 = 该次响应未包含，不做猜测。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.features.length > 0 ? (
              snapshot.features.map((f) => (
                <span key={f} className="rounded-full bg-[#eaeef6] px-2 py-1 text-[0.6875rem] text-[#245ee2]">
                  {f}
                </span>
              ))
            ) : (
              <span className="text-[0.75rem] text-[#8a8c89]">该次响应无 feature 块</span>
            )}
            <span className="rounded-full bg-[#f1f2f1] px-2 py-1 text-[0.6875rem] text-[#4b4d4a]">广告 {snapshot.adsCount} 条</span>
          </div>
          <h4 className="mt-4 text-[0.75rem] font-semibold text-[#1a1e19]">PAA 问题（{snapshot.paa.length}）</h4>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-[0.75rem] leading-[18px] text-[#4b4d4a]">
            {snapshot.paa.slice(0, 8).map((q) => (
              <li key={q}>· {q}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* 竞争环境总结（规则可追溯） */}
      <div className="rounded-md border border-[#e3e4e3] bg-white p-4">
        <h3 className="text-[0.8125rem] font-semibold text-[#1a1e19]">竞争环境总结</h3>
        <ul className="mt-2 space-y-1 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
          {buildSummary(snapshot, domainDist, typedRows).map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onNotify("以上结论全部来自本次快照的 Top 10 真实数据，不构成排名难度判断。", "info")}
          className="mt-2 text-[0.75rem] text-[#245ee2] hover:underline"
        >
          口径说明
        </button>
      </div>
    </div>
  );
}

function buildSummary(
  snapshot: { results: Array<{ title: string; domain: string; snippet: string }>; paa: string[] },
  domainDist: Array<[string, number]>,
  typedRows: Array<{ pt: { type: string } }>,
): string[] {
  const out: string[] = [];
  const top = domainDist[0];
  if (top && top[1] >= 3) out.push(`少数域名主导：${top[0]} 占 ${top[1]} 个席位。`);
  else out.push(`域名分布较分散（${domainDist.length} 个不同域名）。`);
  const typeTally = new Map<string, number>();
  for (const r of typedRows) typeTally.set(r.pt.type, (typeTally.get(r.pt.type) ?? 0) + 1);
  const dominant = [...typeTally.entries()].filter(([t]) => t !== "unknown").sort((a, b) => b[1] - a[1])[0];
  if (dominant) out.push(`结果以「${PAGE_TYPE_ZH[dominant[0]] ?? dominant[0]}」为主（${dominant[1]}/10）。`);
  const tutorialish = typedRows.filter((r) => r.pt.type === "tutorial-guide" || r.pt.type === "blog-article").length;
  if (tutorialish >= 5) out.push("教程/文章主导：新内容应以深度指南形态进入。");
  const compareish = typedRows.filter((r) => r.pt.type === "comparison" || r.pt.type === "listicle").length;
  if (compareish >= 4) out.push("比较/清单页较多：商业决策型搜索，内容需含对比表与推荐理由。");
  if (snapshot.paa.length > 0) out.push(`PAA 反映的高频疑问：${snapshot.paa.slice(0, 3).join("；")}。`);
  return out;
}

// ---------- Compare SERP 弹窗 ----------

interface PairResult {
  a: string;
  b: string;
  sharedUrls: number;
  sharedUrlList: string[];
  unionUrls: number;
  overlapRatio: number | null;
  sharedDomains: string[];
  verdict: "strong-same-page" | "possible-same-page" | "separate-pages" | "insufficient-evidence";
  explanation: string;
  aUrls: number;
  bUrls: number;
}

const VERDICT_ZH: Record<string, string> = {
  "strong-same-page": "Strong same-page candidate（适合合并一页）",
  "possible-same-page": "Possible same-page candidate（可考虑合并，需人工复核）",
  "separate-pages": "Separate pages recommended（建议分开建页）",
  "insufficient-evidence": "Insufficient SERP evidence（证据不足，不给强结论）",
};

const VERDICT_COLOR: Record<string, string> = {
  "strong-same-page": "bg-[#e6f4ea] text-[#1e7b45]",
  "possible-same-page": "bg-[#fdf3e0] text-[#9a6a12]",
  "separate-pages": "bg-[#f1f2f1] text-[#4b4d4a]",
  "insufficient-evidence": "bg-[#f1f2f1] text-[#8a8c89]",
};

export function CompareSerpDialog({
  open,
  onClose,
  strategyId,
  selectedKeywords,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: number;
  selectedKeywords: string[];
}) {
  const [loading, setLoading] = useState(false);
  const [needsFetch, setNeedsFetch] = useState<string[] | null>(null);
  const [neededCalls, setNeededCalls] = useState(0);
  const [preflightMsg, setPreflightMsg] = useState<string | null>(null);
  const [pairs, setPairs] = useState<PairResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (confirm: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/keywords/strategies/${strategyId}/overlap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: selectedKeywords, confirm }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "比较失败");
        return;
      }
      if (json.data.ready) {
        setNeedsFetch(null);
        setPairs(json.data.pairs);
      } else {
        setNeedsFetch(json.data.needsFetch ?? []);
        setNeededCalls(json.data.neededCalls ?? 0);
        setPreflightMsg(json.data.preflight?.message ?? null);
        setPairs(json.data.pairs?.length ? json.data.pairs : null);
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 打开即做一次零成本初始比较（只读已保存快照；缺快照时才进入确认流程）。
  // setTimeout(0) 让首次 setState 落到宏任务，避免 effect 体内同步 setState 的级联渲染。
  useEffect(() => {
    if (open) setTimeout(() => void run(false), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKeywords.join("|")]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Compare SERP"
      description={`比较所选 ${selectedKeywords.length} 个关键词的 Top 10 URL 重合度（Jaccard），判断是否适合同一页面覆盖。证据来自已保存快照；不足时经你确认才发起请求。`}
    >
        <div className="rounded-md bg-[#f7f8f7] p-3 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
          所选关键词：{selectedKeywords.join("、")}
        </div>

        {error ? <p className="mt-3 rounded-md bg-[#fdecea] p-3 text-[0.75rem] text-[#c0392b]">{error}</p> : null}

        {needsFetch && needsFetch.length > 0 && !pairs ? (
          <div className="mt-4 rounded-md border border-[#e8d9b8] bg-[#fdf3e0] p-4">
            <p className="text-[0.8125rem] font-semibold text-[#9a6a12]">以下关键词缺少已保存快照：</p>
            <ul className="mt-1 text-[0.75rem] text-[#4b4d4a]">
              {needsFetch.map((k) => (
                <li key={k}>· {k}</li>
              ))}
            </ul>
            <p className="mt-2 text-[0.75rem] text-[#4b4d4a]">
              需要发起 {neededCalls} 次 SerpApi 请求（每次 1 调用，成功后随策略保存）。{preflightMsg ?? ""}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void run(true)}
                disabled={loading}
                className="h-9 rounded-sm bg-[#245ee2] px-4 text-[0.8125rem] text-white hover:bg-[#1d4fc4] disabled:opacity-60"
              >
                {loading ? "请求中…" : `确认并获取（${neededCalls} 次调用）`}
              </button>
              <button type="button" onClick={onClose} className="h-9 rounded-sm border border-[#d6d8d7] px-4 text-[0.8125rem] text-[#4b4d4a] hover:text-[#1a1e19]">
                取消
              </button>
            </div>
          </div>
        ) : null}

        {loading && pairs === null ? <p className="mt-4 text-[0.8125rem] text-[#6b6c6b]">比较中…</p> : null}

        {pairs && pairs.length > 0 ? (
          <div className="mt-4 space-y-3">
            {pairs.map((p) => (
              <div key={`${p.a}|${p.b}`} className="rounded-md border border-[#e3e4e3] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.8125rem] font-semibold text-[#1a1e19]">
                    {p.a} × {p.b}
                  </p>
                  <span className={`rounded-full px-2 py-1 text-[0.6875rem] ${VERDICT_COLOR[p.verdict]}`}>{VERDICT_ZH[p.verdict]}</span>
                </div>
                <p className="mt-1 font-mono text-[0.8125rem] text-[#245ee2]">
                  {p.sharedUrls} / {p.unionUrls} URLs overlap
                  {p.overlapRatio !== null ? `（${Math.round(p.overlapRatio * 100)}%）` : ""}
                </p>
                <p className="mt-1 text-[0.75rem] leading-[18px] text-[#4b4d4a]">{p.explanation}</p>
                {p.sharedUrlList.length > 0 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.75rem] text-[#245ee2]">共同排名 URL（{p.sharedUrlList.length}）</summary>
                    <ul className="mt-1 space-y-0.5">
                      {p.sharedUrlList.map((u) => (
                        <li key={u} className="line-clamp-1 font-mono text-[0.6875rem] text-[#6b6c6b]">
                          {u}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <p className="mt-1 text-[0.6875rem] text-[#8a8c89]">证据规模：{p.aUrls} vs {p.bUrls} 个可用 URL · 该指标是 SERP 观察，不是 KD。</p>
              </div>
            ))}
          </div>
        ) : null}

        {pairs && pairs.length === 0 && !needsFetch ? (
          <p className="mt-4 text-[0.8125rem] text-[#6b6c6b]">所选关键词之间没有可比对（需 2 个以上含快照的词）。</p>
        ) : null}
    </Dialog>
  );
}

// ---------- Strategy Priority 条 ----------

const PRIORITY_ZH: Record<string, string> = {
  recommended: "Recommended",
  review: "Review",
  low: "Low priority",
};

const PRIORITY_COLOR: Record<string, string> = {
  recommended: "bg-[#e6f4ea] text-[#1e7b45]",
  review: "bg-[#fdf3e0] text-[#9a6a12]",
  low: "bg-[#f1f2f1] text-[#8a8c89]",
};

export function PriorityStrip({
  doc,
  overrides,
  onSaveOverride,
}: {
  doc: StrategyDoc;
  overrides: Record<string, "recommended" | "review" | "low">;
  onSaveOverride: (topicId: string, level: "recommended" | "review" | "low" | null) => void;
}) {
  const priorities = useMemo(
    () => computeTopicPriorities({ doc, snapshots: doc.meta.serpSnapshots ?? null, overrides }),
    [doc, overrides],
  );
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? priorities : priorities.slice(0, 4);

  return (
    <div className="rounded-md border border-[#e3e4e3] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[0.8125rem] font-semibold text-[#1a1e19]">Strategy Priority（基于意图/证据/规模/相关性，不依赖 Volume/KD）</h3>
        {priorities.length > 4 ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[0.75rem] text-[#245ee2] hover:underline">
            {expanded ? "收起" : `展开全部 ${priorities.length} 个主题`}
          </button>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {visible.map((p: TopicPriority) => (
          <div key={p.topicId} className="flex flex-wrap items-center gap-2 rounded-md border border-[#eff0ef] px-3 py-2">
            <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] ${PRIORITY_COLOR[p.override ?? p.level]}`}>
              {PRIORITY_ZH[p.override ?? p.level]}
              {p.override ? "（手动）" : ""}
            </span>
            <span className="text-[0.8125rem] font-medium text-[#1a1e19]">{p.topicName}</span>
            <span className="min-w-0 flex-1 truncate text-[0.75rem] text-[#6b6c6b]" title={p.reasons.join("；")}>
              {p.reasons.join("；")}
            </span>
            <select
              aria-label={`调整 ${p.topicName} 的优先级`}
              value={p.override ?? ""}
              onChange={(e) => onSaveOverride(p.topicId, (e.target.value || null) as "recommended" | "review" | "low" | null)}
              className="h-7 rounded-sm border border-[#d6d8d7] bg-white px-1.5 text-[0.75rem] text-[#1a1e19]"
            >
              <option value="">自动</option>
              <option value="recommended">Recommended</option>
              <option value="review">Review</option>
              <option value="low">Low priority</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

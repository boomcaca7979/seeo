// ===== Website Content Gap 页面（真实扫描 → 覆盖/缺口/内耗 → 加入策略） =====
//
// 流程：选择项目与策略 → 扫描（Sitemap 发现 → SSRF 安全抓取）→ 页面清单 →
// 覆盖/缺口/内耗 → 把缺口主题作为种子加入关键词策略（用户明确确认，复用现有加词 API）。

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/viz/PageHeader";

interface ProjectOption {
  id: string;
  name: string;
  domain: string;
}
interface ScanState {
  id: number;
  status: "running" | "completed" | "failed" | "cancelled";
  domain: string;
  requested: number;
  crawled: number;
  failed: number;
  error: string | null;
}
interface CoverageRow {
  topicId: string;
  topicName: string;
  status: "covered" | "potential-gap" | "needs-review";
  matchedPages: Array<{ url: string; title: string | null; h1: string | null; evidence: string[] }>;
  reason: string;
}
interface CannibalizationRow {
  topicId: string;
  topicName: string;
  pages: Array<{ url: string; title: string | null; evidence: string[] }>;
  reason: string;
  suggestion: string;
}
interface Analysis {
  coverage: CoverageRow[];
  cannibalization: CannibalizationRow[];
  crawledCount: number;
  failedCount: number;
  totalKnown: number;
}

const STATUS_ZH: Record<string, string> = {
  covered: "Covered",
  "potential-gap": "Potential Gap",
  "needs-review": "Needs Review",
};
const STATUS_COLOR: Record<string, string> = {
  covered: "bg-[#e6f4ea] text-[#1e7b45]",
  "potential-gap": "bg-[#fdf3e0] text-[#9a6a12]",
  "needs-review": "bg-[#f1f2f1] text-[#6b6c6b]",
};

export default function ContentGapPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [strategies, setStrategies] = useState<Array<{ id: number; name: string }>>([]);
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [pj, sj] = await Promise.all([
          fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/keywords/strategies", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        const plist = (Array.isArray(pj.data) ? pj.data : []) as ProjectOption[];
        setProjects(plist);
        if (plist[0]) setProjectId(Number(plist[0].id));
        const slist = (Array.isArray(sj.data) ? sj.data : []) as Array<{ id: number; name: string }>;
        setStrategies(slist);
        if (slist[0]) setStrategyId(slist[0].id);
      } catch {
        if (alive) setNotice("读取项目/策略列表失败，请刷新重试");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadScan = useCallback(async (pid: number) => {
    try {
      const r = await fetch(`/api/content-gap/scan?projectId=${pid}`, { cache: "no-store" });
      const j = await r.json();
      setScan(j.data ?? null);
      return (j.data as ScanState | null)?.status ?? null;
    } catch {
      return null;
    }
  }, []);

  const loadAnalysis = useCallback(async (pid: number, sid: number) => {
    try {
      const r = await fetch(`/api/content-gap/analysis?projectId=${pid}&strategyId=${sid}`, { cache: "no-store" });
      const j = await r.json();
      setAnalysis(j.data ?? null);
    } catch {
      setNotice("分析请求失败");
    }
  }, []);

  // 扫描中轮询
  useEffect(() => {
    if (scan?.status !== "running" || projectId == null) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(async () => {
      const status = await loadScan(projectId);
      if (status && status !== "running" && strategyId != null) {
        await loadAnalysis(projectId, strategyId);
      }
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scan?.status, projectId, strategyId, loadScan, loadAnalysis]);

  const startScan = async () => {
    if (projectId == null) return;
    setBusy(true);
    setNotice(null);
    setAnalysis(null);
    try {
      const res = await fetch("/api/content-gap/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json.error ?? "扫描启动失败");
        return;
      }
      await loadScan(projectId);
    } finally {
      setBusy(false);
    }
  };

  const cancelScan = async () => {
    if (!scan) return;
    setBusy(true);
    try {
      await fetch(`/api/content-gap/scan?scanId=${scan.id}`, { method: "DELETE" });
      if (projectId != null) await loadScan(projectId);
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    if (projectId == null || strategyId == null) return;
    setBusy(true);
    try {
      await loadAnalysis(projectId, strategyId);
    } finally {
      setBusy(false);
    }
  };

  const addGapToStrategy = async (topicName: string) => {
    if (strategyId == null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/keywords/strategies/${strategyId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seeds: [topicName] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json.error ?? "加入策略失败");
        return;
      }
      setNotice(`已把「${topicName}」作为种子加入策略（服务端生成中，稍后刷新策略查看）`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-container p-6 lg:p-8">
      <PageHeader title="Website Content Gap" subtitle="扫描网站公开页面清单，与关键词策略匹配，找出覆盖、缺口与内耗。" />

      <div className="mt-5 rounded-md border border-[#e3e4e3] bg-white p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-[0.8125rem] text-[#1a1e19]">
            <span className="mb-1 block font-medium">目标网站（项目）</span>
            <select
              aria-label="选择项目"
              value={projectId ?? ""}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="h-9 w-full rounded-sm border border-[#d6d8d7] bg-white px-2 text-[0.8125rem]"
            >
              {projects.length === 0 ? <option value="">（暂无项目）</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.domain}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[0.8125rem] text-[#1a1e19]">
            <span className="mb-1 block font-medium">对照的关键词策略</span>
            <select
              aria-label="选择策略"
              value={strategyId ?? ""}
              onChange={(e) => setStrategyId(Number(e.target.value))}
              className="h-9 w-full rounded-sm border border-[#d6d8d7] bg-white px-2 text-[0.8125rem]"
            >
              {strategies.length === 0 ? <option value="">（暂无策略）</option> : null}
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void startScan()}
              disabled={busy || projectId == null || scan?.status === "running"}
              className="h-9 rounded-sm bg-[#245ee2] px-4 text-[0.8125rem] text-white hover:bg-[#1d4fc4] disabled:opacity-60"
            >
              {scan?.status === "running" ? "扫描中…" : "扫描 Sitemap"}
            </button>
            {scan?.status === "running" ? (
              <button
                type="button"
                onClick={() => void cancelScan()}
                disabled={busy}
                className="h-9 rounded-sm border border-[#d6d8d7] px-4 text-[0.8125rem] text-[#4b4d4a] hover:text-[#1a1e19]"
              >
                取消
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={busy || projectId == null || strategyId == null || scan?.status !== "completed"}
              className="h-9 rounded-sm border border-[#245ee2] px-4 text-[0.8125rem] text-[#245ee2] hover:bg-[#eaeef6] disabled:opacity-60"
            >
              分析覆盖
            </button>
          </div>
        </div>
        {projects.length === 0 ? (
          <p className="mt-3 text-[0.75rem] text-[#6b6c6b]">
            还没有项目：Content Gap 以项目域名为目标。请先到{" "}
            <Link href="/app/projects" className="text-[#245ee2] hover:underline">
              项目管理
            </Link>{" "}
            添加网站。
          </p>
        ) : null}
        {notice ? <p className="mt-3 rounded-md bg-[#eaeef6] p-2 text-[0.75rem] text-[#245ee2]">{notice}</p> : null}
      </div>

      {scan ? (
        <div className="mt-4 rounded-md border border-[#e3e4e3] bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2 py-1 text-[0.6875rem] ${
                scan.status === "running"
                  ? "bg-[#eaeef6] text-[#245ee2]"
                  : scan.status === "completed"
                    ? "bg-[#e6f4ea] text-[#1e7b45]"
                    : "bg-[#f1f2f1] text-[#6b6c6b]"
              }`}
            >
              {scan.status}
            </span>
            <span className="text-[0.8125rem] text-[#1a1e19]">{scan.domain}</span>
            <span className="text-[0.75rem] text-[#6b6c6b]">
              队列 {scan.requested} · 成功 {scan.crawled} · 失败 {scan.failed}
            </span>
          </div>
          {scan.status === "running" ? (
            <div className="mt-3 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-[#e3e4e3]">
              <div
                className="h-full rounded-full bg-[#8796ef] transition-all"
                style={{ width: `${scan.requested > 0 ? Math.round(((scan.crawled + scan.failed) / scan.requested) * 100) : 5}%` }}
              />
            </div>
          ) : null}
          {scan.error ? <p className="mt-2 text-[0.75rem] text-[#c0392b]">{scan.error}</p> : null}
        </div>
      ) : null}

      {analysis ? (
        <>
          <div className="mt-4 rounded-md border border-[#e3e4e3] bg-[#f7f8f7] p-3 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
            匹配样本：成功抓取 {analysis.crawledCount} 页 · 失败 {analysis.failedCount} 页 · 已知 URL {analysis.totalKnown} 个。
            抓取样本不足时缺口判定为 Needs Review，不会把抓取失败误判为内容缺口。
          </div>

          <div className="mt-4 rounded-md border border-[#e3e4e3] bg-white">
            <div className="border-b border-[#e9eae9] px-4 py-2 text-[0.8125rem] font-semibold text-[#1a1e19]">
              主题覆盖与缺口（{analysis.coverage.length} 个主题）
            </div>
            <div className="divide-y divide-[#eff0ef]">
              {analysis.coverage.map((row) => (
                <div key={row.topicId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] ${STATUS_COLOR[row.status]}`}>{STATUS_ZH[row.status]}</span>
                    <span className="text-[0.8125rem] font-medium text-[#1a1e19]">{row.topicName}</span>
                    <span className="text-[0.75rem] text-[#6b6c6b]">{row.reason}</span>
                    {row.status === "potential-gap" ? (
                      <button
                        type="button"
                        onClick={() => void addGapToStrategy(row.topicName)}
                        disabled={busy || strategyId == null}
                        className="ml-auto rounded-sm border border-[#245ee2] px-2 py-1 text-[0.75rem] text-[#245ee2] hover:bg-[#eaeef6] disabled:opacity-60"
                      >
                        加入策略
                      </button>
                    ) : null}
                  </div>
                  {row.matchedPages.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {row.matchedPages.map((m) => (
                        <li key={m.url} className="text-[0.75rem] leading-[18px] text-[#4b4d4a]">
                          <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-[#245ee2] hover:underline">
                            {m.title ?? m.url}
                          </a>
                          <span className="ml-2 text-[0.6875rem] text-[#8a8c89]">{m.evidence.join("；")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-[#e3e4e3] bg-white">
            <div className="border-b border-[#e9eae9] px-4 py-2 text-[0.8125rem] font-semibold text-[#1a1e19]">
              关键词内耗（{analysis.cannibalization.length} 例）
            </div>
            {analysis.cannibalization.length === 0 ? (
              <p className="px-4 py-3 text-[0.75rem] text-[#6b6c6b]">未发现多页争用同一主题关键词的情况。</p>
            ) : (
              <div className="divide-y divide-[#eff0ef]">
                {analysis.cannibalization.map((c) => (
                  <div key={c.topicId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[0.6875rem] text-[#c0392b]">Cannibalization</span>
                      <span className="text-[0.8125rem] font-medium text-[#1a1e19]">{c.topicName}</span>
                      <span className="text-[0.75rem] text-[#6b6c6b]">{c.reason}</span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {c.pages.map((p) => (
                        <li key={p.url} className="text-[0.75rem] leading-[18px] text-[#4b4d4a]">
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[#245ee2] hover:underline">
                            {p.title ?? p.url}
                          </a>
                          <span className="ml-2 text-[0.6875rem] text-[#8a8c89]">{p.evidence.join("；")}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[0.75rem] text-[#1a1e19]">建议：{c.suggestion}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

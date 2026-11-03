// ===== 策略页弹窗（新增关键词 / 分享 / 筛选 / 内容大纲）=====
// 统一走 useDialogA11y（Esc 关闭 + 焦点陷阱），配色沿用策略页既有色板。
"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useDialogA11y } from "@/lib/useDialogA11y";
import {
  briefToMarkdown,
  type ContentBrief,
  type SavedBrief,
  type StrategyTopic,
} from "@/lib/seo/strategy-model";
import { SolidButton, OutlineButton } from "./ui";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useDialogA11y(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[85vh] w-full flex-col rounded-md border border-[#e3e4e3] bg-white ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#e9eae9] px-5 py-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-[1rem] font-semibold text-[#1a1e19]">
              {title}
            </h3>
            {description && <p className="mt-1 text-[0.8125rem] leading-[18px] text-[#4b4d4a]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-[#6b6c6b] hover:bg-[#f4f5f5] hover:text-[#1a1e19]"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#e9eae9] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Add keywords ----------

export function AddKeywordsDialog({
  open,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (seeds: string[]) => void;
  busy: boolean;
  error: string | null;
}) {
  const [text, setText] = useState("");
  const seeds = text
    .split(/[\n,，]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add keywords"
      description="每行一个种子关键词，最多 5 个。新增的词会真实扩词并与已有结果合并，已有主题会重新计算。"
      footer={
        <>
          <OutlineButton onClick={onClose} disabled={busy}>
            Cancel
          </OutlineButton>
          <SolidButton onClick={() => onSubmit(seeds)} disabled={busy || seeds.length === 0}>
            {busy ? "Adding…" : `Add ${seeds.length || ""}`.trim()}
          </SolidButton>
        </>
      }
    >
      <label className="block text-[0.8125rem] font-medium text-[#1a1e19]" htmlFor="add-keywords-input">
        种子关键词
      </label>
      <textarea
        id="add-keywords-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"bike repair\nmountain bike tires"}
        className="mt-1 w-full resize-y rounded-sm border border-[#d6d8d7] px-3 py-2 text-[0.875rem] leading-[22px] text-[#1a1e19] outline-none focus:border-[#8796ef]"
      />
      <p className="mt-2 text-[0.75rem] leading-[18px] text-[#6b6c6b]">
        每次追加会消耗与新增种子数量相同的 SerpApi 请求（缓存命中不消耗）。
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[0.8125rem] text-[#c0392b]">
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ---------- Share ----------

export function ShareDialog({
  open,
  onClose,
  url,
  onCreate,
  onRevoke,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  url: string | null;
  onCreate: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const absolute = url ? `${typeof window === "undefined" ? "" : window.location.origin}${url}` : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share this strategy"
      description="分享链接为只读：外部访问者只能查看关键词结构，不能修改或删除策略。撤销后旧链接立即失效。"
      footer={
        <>
          <OutlineButton onClick={onClose}>Close</OutlineButton>
          {url ? (
            <OutlineButton onClick={onRevoke} disabled={busy}>
              Revoke link
            </OutlineButton>
          ) : (
            <SolidButton onClick={onCreate} disabled={busy}>
              {busy ? "Creating…" : "Create link"}
            </SolidButton>
          )}
        </>
      }
    >
      {absolute ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-sm border border-[#d6d8d7] bg-[#f7f8f7] px-3 py-2">
            <input
              readOnly
              value={absolute}
              aria-label="Share link"
              className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-[#1a1e19] outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(absolute);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  setCopied(false);
                }
              }}
              className="shrink-0 text-[0.8125rem] text-[#245ee2] hover:underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-[0.75rem] leading-[18px] text-[#6b6c6b]">
            链接里的 token 由服务端随机生成（24 字节），不可枚举；不含账号信息。
          </p>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-[#4b4d4a]">尚未创建分享链接。</p>
      )}
    </Dialog>
  );
}

// ---------- Filters ----------

export interface FiltersValue {
  topics: string[];
  role: string;
  favoritesOnly: boolean;
}

export function FiltersDialog({
  open,
  onClose,
  topics,
  value,
  onApply,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  topics: StrategyTopic[];
  value: FiltersValue;
  onApply: (v: FiltersValue) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<FiltersValue>(value);

  const toggleTopic = (id: string) => {
    setDraft((d) => ({
      ...d,
      topics: d.topics.includes(id) ? d.topics.filter((t) => t !== id) : [...d.topics, id],
    }));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Filters"
      description="筛选只影响当前视图，不会修改策略数据。没有 Volume / KD 时不提供按指标排序的筛选。"
      footer={
        <>
          <OutlineButton
            onClick={() => {
              setDraft({ topics: [], role: "", favoritesOnly: false });
              onReset();
            }}
          >
            Clear all
          </OutlineButton>
          <SolidButton
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </SolidButton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-[0.8125rem] font-medium text-[#1a1e19]">Topic</p>
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-sm border border-[#e9eae9] p-2">
            {topics.length === 0 && <p className="text-[0.8125rem] text-[#6b6c6b]">无主题</p>}
            {topics.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-[#1a1e19]">
                <input
                  type="checkbox"
                  checked={draft.topics.includes(t.id)}
                  onChange={() => toggleTopic(t.id)}
                  className="h-4 w-4 accent-[#191c19]"
                />
                <span className="truncate">{t.name}</span>
                <span className="ml-auto shrink-0 text-[0.75rem] text-[#8a8c89]">{t.keywordCount}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[0.8125rem] font-medium text-[#1a1e19]">Page role</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[0.8125rem] text-[#1a1e19]">
            {[
              { value: "", label: "全部" },
              { value: "pillar", label: "Pillar" },
              { value: "subpage", label: "Subpage" },
              { value: "ungrouped", label: "未分组" },
            ].map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="page-role"
                  checked={draft.role === opt.value}
                  onChange={() => setDraft((d) => ({ ...d, role: opt.value }))}
                  className="h-4 w-4 accent-[#191c19]"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-[#1a1e19]">
          <input
            type="checkbox"
            checked={draft.favoritesOnly}
            onChange={(e) => setDraft((d) => ({ ...d, favoritesOnly: e.target.checked }))}
            className="h-4 w-4 accent-[#191c19]"
          />
          Show favorites only
        </label>
      </div>
    </Dialog>
  );
}

// ---------- Add to tracking ----------

export interface TrackingProject {
  id: number | string;
  name: string;
  domain: string;
}

export type TrackingStatus = "added" | "duplicate" | "limit" | "failed" | "skipped";

export interface TrackingDetail {
  keyword: string;
  status: TrackingStatus;
  /** 失败原因（后端原文） */
  message?: string;
}

export interface TrackingResult {
  added: number;
  duplicated: number;
  failed: number;
  /** 因额度耗尽而未尝试的数量 */
  skipped: number;
  limitReached: boolean;
  message: string | null;
  details: TrackingDetail[];
}

const TRACKING_STATUS_LABEL: Record<TrackingStatus, string> = {
  added: "已添加",
  duplicate: "已存在",
  limit: "额度不足",
  failed: "失败",
  skipped: "未尝试",
};

/**
 * 真实加入追踪：逐词写入 tracked_keywords（/api/tracking）。
 * 逐词收集结果，部分成功时保留已写入记录，并把「已添加 / 已存在 / 额度不足 / 其他失败」分开计数；
 * 任何一项失败都不会把整批显示为成功。
 */
export function TrackingDialog({
  open,
  onClose,
  keywords,
  market,
  device,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** 待加入的关键词（选中项，或当前筛选结果） */
  keywords: string[];
  market: string;
  device: string;
  onDone: (result: TrackingResult) => void;
}) {
  const [projects, setProjects] = useState<TrackingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>(keywords);
  const [result, setResult] = useState<TrackingResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const list = (Array.isArray(j.data) ? j.data : []) as TrackingProject[];
        setProjects(list);
        if (list[0]) setDomain(list[0].domain);
      })
      .catch(() => alive && setProjects([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const run = async (targets: string[]) => {
    if (!domain) {
      setError("请先选择一个项目（关键词追踪按项目域名归属）");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    const details: TrackingDetail[] = [];
    let limitMessage: string | null = null;

    for (let i = 0; i < targets.length; i += 1) {
      const keyword = targets[i];
      if (limitMessage) {
        details.push({ keyword, status: "skipped" });
        continue;
      }
      try {
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, location: market, device, domain }),
        });
        if (res.ok) {
          details.push({ keyword, status: "added" });
          continue;
        }
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          code?: string;
          limit?: number;
          used?: number;
        };
        const text = json.message ?? json.error ?? "";
        if (json.code === "KEYWORD_LIMIT_REACHED" || res.status === 402 || res.status === 403) {
          limitMessage =
            text ||
            `已达追踪关键词上限（${json.limit ?? "?"} 个），请升级套餐或先删除不需要的追踪词`;
          details.push({ keyword, status: "limit", message: limitMessage });
        } else if (res.status === 400 && (text.includes("已在追踪中") || text.includes("重复"))) {
          details.push({ keyword, status: "duplicate", message: text });
        } else {
          details.push({ keyword, status: "failed", message: text || `HTTP ${res.status}` });
        }
      } catch (e) {
        details.push({ keyword, status: "failed", message: (e as Error).message || "网络错误" });
      }
    }

    const next: TrackingResult = {
      added: details.filter((d) => d.status === "added").length,
      duplicated: details.filter((d) => d.status === "duplicate").length,
      failed: details.filter((d) => d.status === "failed").length,
      skipped: details.filter((d) => d.status === "skipped").length,
      limitReached: limitMessage !== null,
      message:
        limitMessage ??
        details.find((d) => d.status === "failed" && d.message)?.message ??
        null,
      details,
    };
    if (limitMessage) setError(limitMessage);
    setBusy(false);
    setResult(next);
    onDone(next);
    // 全部成功（或仅重复）才自动关闭；有任何失败/额度不足都留在弹窗里让用户看清原因
    if (next.failed === 0 && !next.limitReached && next.skipped === 0) onClose();
  };

  const failedKeywords = result
    ? result.details.filter((d) => d.status === "failed" || d.status === "limit" || d.status === "skipped").map((d) => d.keyword)
    : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to keyword tracking"
      description="把选中的关键词写入关键词追踪（tracked_keywords），按项目域名归属；重复词会被后端拦截。"
      footer={
        result ? (
          <>
            <OutlineButton onClick={onClose} disabled={busy}>
              Close
            </OutlineButton>
            {failedKeywords.length > 0 && (
              <SolidButton
                onClick={() => {
                  setQueue(failedKeywords);
                  void run(failedKeywords);
                }}
                disabled={busy || !domain}
              >
                {busy ? "Adding…" : `重试未成功的 ${failedKeywords.length} 个`}
              </SolidButton>
            )}
          </>
        ) : (
          <>
            <OutlineButton onClick={onClose} disabled={busy}>
              Cancel
            </OutlineButton>
            <SolidButton onClick={() => void run(queue)} disabled={busy || queue.length === 0 || !domain}>
              {busy ? "Adding…" : `Track ${queue.length}`}
            </SolidButton>
          </>
        )
      }
    >
      {loading ? (
        <p className="text-[0.8125rem] text-[#6b6c6b]">正在读取项目…</p>
      ) : projects.length === 0 ? (
        <div className="space-y-2 text-[0.8125rem] leading-[20px] text-[#4b4d4a]">
          <p>还没有项目：关键词追踪必须挂在某个网站域名下。</p>
          <Link href="/app/projects" className="text-[#245ee2] hover:underline">
            去创建项目 →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[0.8125rem] font-medium text-[#1a1e19]">目标项目</p>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-label="Target project"
              disabled={busy}
              className="mt-1 h-9 w-full rounded-sm border border-[#d6d8d7] px-2 text-[0.8125rem] text-[#1a1e19]"
            >
              {projects.map((p) => (
                <option key={`${p.id}-${p.domain}`} value={p.domain}>
                  {p.name} · {p.domain}
                </option>
              ))}
            </select>
          </div>

          {result ? (
            <div className="space-y-2">
              <p className="text-[0.8125rem] text-[#1a1e19]">
                本次结果：已添加 <span className="font-semibold tabular-nums">{result.added}</span> · 已存在{" "}
                <span className="font-semibold tabular-nums">{result.duplicated}</span>
                {result.failed > 0 && (
                  <>
                    {" "}
                    · 失败 <span className="font-semibold text-[#c0392b] tabular-nums">{result.failed}</span>
                  </>
                )}
                {result.skipped > 0 && (
                  <>
                    {" "}
                    · 未尝试 <span className="font-semibold tabular-nums">{result.skipped}</span>
                  </>
                )}
              </p>
              <ul
                aria-label="Tracking results"
                className="max-h-[220px] space-y-1 overflow-y-auto rounded-sm border border-[#e3e4e3] bg-[#fafbfa] px-3 py-2 text-[0.75rem] leading-[18px]"
              >
                {result.details.map((d) => (
                  <li key={d.keyword} className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={
                        d.status === "added"
                          ? "text-[#00795a]"
                          : d.status === "duplicate"
                            ? "text-[#6b6c6b]"
                            : "text-[#c0392b]"
                      }
                    >
                      {TRACKING_STATUS_LABEL[d.status]}
                    </span>
                    <span className="min-w-0 break-all text-[#1a1e19]">{d.keyword}</span>
                    {d.message && d.status !== "added" && d.status !== "duplicate" && (
                      <span className="text-[#8a8c89]">— {d.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[0.75rem] leading-[18px] text-[#6b6c6b]">
              将加入 {queue.length} 个关键词（地区 {market} · 设备 {device}）。已有的同名关键词会被跳过，不会重复写入。
            </p>
          )}

          {error && (
            <p role="alert" className="text-[0.8125rem] text-[#c0392b]">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ---------- Content brief ----------

function formatStamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function BriefDialog({
  open,
  onClose,
  brief,
  saved,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  brief: ContentBrief | null;
  /** 上次保存过的版本（有则默认载入它，而不是重新生成） */
  saved?: SavedBrief | null;
  /** 保存到服务端；抛错表示失败（调用方负责提示） */
  onSave: (markdown: string, generatedAt: string) => Promise<void>;
}) {
  const generated = brief ? briefToMarkdown(brief) : "";
  // baseline = 服务端当前保存的内容；text 与它不同即视为「未保存的修改」
  const [baseline, setBaseline] = useState(() => saved?.markdown ?? generated);
  const [text, setText] = useState(() => saved?.markdown ?? generated);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(saved?.savedAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== baseline;

  const download = () => {
    if (!brief) return;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-brief-${(brief.topicName || "topic").replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 40)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!brief) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(text, brief.generatedAt);
      setBaseline(text);
      setSavedAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Content brief"
      description="用当前策略的真实关键词、SERP Related Searches、PAA 与意图结构组织的大纲。这不是 AI 生成的正文，可以自行修改后保存、复制或导出。"
      footer={
        <>
          <OutlineButton onClick={onClose}>Close</OutlineButton>
          <OutlineButton
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </OutlineButton>
          <OutlineButton onClick={download} disabled={!brief}>
            Download .md
          </OutlineButton>
          <SolidButton onClick={save} disabled={!brief || !dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </SolidButton>
        </>
      }
    >
      {brief ? (
        <div className="space-y-3">
          <div className="rounded-sm bg-[#f7f8f7] p-3 text-[0.75rem] leading-[18px] text-[#4b4d4a]">
            {brief.dataSource}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] leading-[18px]">
            {dirty ? (
              <span className="text-[#a4650a]">有未保存的修改</span>
            ) : savedAt ? (
              <span className="text-[#00795a]">已保存 · {formatStamp(savedAt)}</span>
            ) : (
              <span className="text-[#6b6c6b]">未保存（这是本次生成的大纲）</span>
            )}
            {savedAt && (
              <button
                type="button"
                onClick={() => setText(generated)}
                className="text-[#245ee2] hover:underline"
              >
                改用最新 SERP 数据重新生成
              </button>
            )}
            <span className="text-[#8a8c89]">生成时间：{formatStamp(brief.generatedAt)}</span>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            aria-label="Content brief outline"
            className="w-full resize-y rounded-sm border border-[#d6d8d7] px-3 py-2 font-mono text-[0.75rem] leading-[18px] text-[#1a1e19] outline-none focus:border-[#8796ef]"
          />
          {error && (
            <p role="alert" className="text-[0.8125rem] text-[#c0392b]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[0.8125rem] text-[#6b6c6b]">选择一个主题后再生成大纲。</p>
      )}
    </Dialog>
  );
}

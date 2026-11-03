"use client";

// ===== 已保存策略列表 =====
// 数据来自 Turso（/api/keywords/strategies），打开策略不发任何供应商请求。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/keyword-strategy/dialogs";
import { OutlineButton, SolidButton } from "@/components/keyword-strategy/ui";
import { useToast } from "@/components/dashboard/Toast";

interface Row {
  id: number;
  name: string;
  seeds: string[];
  addedSeeds?: string[];
  market: string;
  device: string;
  status: "running" | "ready" | "partial" | "failed";
  progress: number;
  keywordCount: number;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
}

const STATUS_LABEL: Record<Row["status"], string> = {
  running: "生成中",
  ready: "已完成",
  partial: "部分完成",
  failed: "失败",
};

export default function StrategyListPage() {
  const { show, Toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keywords/strategies", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "加载失败");
        return;
      }
      setRows(json.data as Row[]);
      setError(null);
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 延迟一拍，避免 effect 同步体内 setState（react-hooks/set-state-in-effect）
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const remove = async (row: Row) => {
    if (!window.confirm(`删除策略「${row.name}」？此操作不可撤销。`)) return;
    const res = await fetch(`/api/keywords/strategies/${row.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      show(json.error ?? "删除失败", "error");
      return;
    }
    show("策略已删除");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/keywords/strategies/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) {
      show(json.error ?? "重命名失败", "error");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, name } : r)));
    setRenaming(null);
    show("名称已更新");
  };

  const revokeShare = async (row: Row) => {
    const res = await fetch(`/api/keywords/strategies/${row.id}/share`, { method: "DELETE" });
    if (!res.ok) {
      show("撤销失败", "error");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, shareToken: null } : r)));
    show("分享已撤销，旧链接失效");
  };

  return (
    <div className="min-h-full bg-[#f4f5f5] px-6 py-6 text-[#1a1e19]">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[1.375rem] leading-[30px] font-semibold">关键词策略</h1>
            <p className="mt-1 text-[0.8125rem] text-[#4b4d4a]">
              已保存的策略快照。打开不会重新调用供应商，数据保持创建时的状态。
            </p>
          </div>
          <Link
            href="/app/keyword-strategy"
            className="inline-flex h-8 items-center rounded-sm bg-[#191c19] px-3 text-[0.8125rem] font-medium text-white hover:bg-black"
          >
            新建策略
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-md border border-[#e3e4e3] bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_180px_120px_100px_90px_230px] items-center gap-2 border-b border-[#e9eae9] px-4 py-2 text-[0.75rem] text-[#6b6c6b]">
            <span>Name</span>
            <span>Seeds</span>
            <span>Market</span>
            <span>Keywords</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          {loading && <p className="px-4 py-10 text-center text-[0.8125rem] text-[#6b6c6b]">加载中…</p>}
          {!loading && error && <p className="px-4 py-10 text-center text-[0.8125rem] text-[#c0392b]">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="px-4 py-10 text-center text-[0.8125rem] text-[#6b6c6b]">还没有策略，先创建一个。</p>
          )}

          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_180px_120px_100px_90px_230px] items-center gap-2 border-b border-[#eff0ef] px-4 py-3 text-[0.8125rem] last:border-b-0"
            >
              <span className="min-w-0">
                <Link
                  href={`/app/keyword-strategy?id=${row.id}`}
                  className="block truncate text-[#245ee2] hover:underline"
                  title={row.name}
                >
                  {row.name}
                </Link>
                <span className="mt-0.5 block truncate text-[0.6875rem] text-[#8a8c89]">
                  {row.createdAt} · {row.updatedAt !== row.createdAt ? `更新 ${row.updatedAt}` : "未修改"}
                  {(row.addedSeeds?.length ?? 0) > 0 ? ` · 手动追加 ${row.addedSeeds!.length}` : ""}
                  {row.shareToken ? " · 已分享" : ""}
                </span>
              </span>
              <span className="truncate text-[#4b4d4a]" title={row.seeds.join(", ")}>
                {row.seeds.join(", ")}
              </span>
              <span className="text-[#4b4d4a]">
                {row.market} · {row.device}
              </span>
              <span className="tabular-nums text-[#1a1e19]">{row.keywordCount}</span>
              <span
                className={
                  row.status === "failed"
                    ? "text-[#c0392b]"
                    : row.status === "partial"
                      ? "text-[#a9761a]"
                      : "text-[#4b4d4a]"
                }
              >
                {STATUS_LABEL[row.status] ?? row.status}
                {row.status === "running" ? ` ${row.progress}%` : ""}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <Link
                  href={`/app/keyword-strategy?id=${row.id}`}
                  className="text-[0.8125rem] text-[#245ee2] hover:underline"
                >
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(row);
                    setRenameValue(row.name);
                  }}
                  className="text-[0.8125rem] text-[#245ee2] hover:underline"
                >
                  Rename
                </button>
                {row.shareToken && (
                  <button
                    type="button"
                    onClick={() => revokeShare(row)}
                    className="text-[0.8125rem] text-[#245ee2] hover:underline"
                  >
                    Revoke share
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(row)}
                  className="text-[0.8125rem] text-[#c0392b] hover:underline"
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Dialog
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="重命名策略"
        footer={
          <>
            <OutlineButton onClick={() => setRenaming(null)}>取消</OutlineButton>
            <SolidButton onClick={rename} disabled={!renameValue.trim()}>
              保存
            </SolidButton>
          </>
        }
      >
        <label className="block text-[0.8125rem] font-medium text-[#1a1e19]" htmlFor="list-rename">
          策略名称
        </label>
        <input
          id="list-rename"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          className="mt-1 h-9 w-full rounded-sm border border-[#d6d8d7] px-3 text-[0.875rem] outline-none focus:border-[#8796ef]"
        />
      </Dialog>

      <Toast />
    </div>
  );
}

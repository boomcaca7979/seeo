"use client";

// ===== 付款通知手动重试按钮（老板后台）=====
// POST /api/admin/payments/notifications/retry（checkAdmin 鉴权）。
// 已发送的通知重试会返回 already_sent —— 不会重复发邮件。

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NotifyRetryButton({ notificationId }: { notificationId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/notifications/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notificationId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "重试失败");
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-60 hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? "重试中…" : "重试发送"}
      </button>
      {error ? <span className="text-xs text-neg">{error}</span> : null}
    </span>
  );
}

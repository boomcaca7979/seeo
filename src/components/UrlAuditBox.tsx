"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth-config";

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)\.[a-z]{2,63}$/i;

export default function UrlAuditBox() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function normalizeDomain(input: string): string {
    let d = input.trim();
    d = d.replace(/^https?:\/\//i, "");
    d = d.replace(/\/.*$/, "");
    d = d.toLowerCase().trim();
    return d;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const domain = normalizeDomain(url);
    if (!domain) {
      setError("请输入网站域名");
      return;
    }
    if (!DOMAIN_REGEX.test(domain)) {
      setError("域名格式无效，如 example.com");
      return;
    }
    // SSRF 基础校验：禁止 localhost / 私网 IP
    const lower = domain.toLowerCase();
    if (
      lower === "localhost" ||
      lower.endsWith(".local") ||
      lower.endsWith(".internal") ||
      lower.endsWith(".localhost") ||
      /^127\./.test(lower) ||
      /^10\./.test(lower) ||
      /^192\.168\./.test(lower) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(lower) ||
      /^169\.254\./.test(lower)
    ) {
      setError("不支持审计本地或私有网络地址");
      return;
    }

    setLoading(true);
    // 构建审计页完整路径
    const auditPath = `/app/audit?domain=${encodeURIComponent(domain)}`;
    if (isAuthEnabled) {
      // auth 模式：先登录，登录后自动返回审计页
      router.push(`/login?redirect=${encodeURIComponent(auditPath)}`);
    } else {
      // demo 模式：直接进入审计页
      router.push(auditPath);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          placeholder="输入你的网站域名，如 example.com"
          className="flex-1 rounded-lg border border-ink/40 bg-station-deep/60 px-4 py-3 text-sm text-y-text placeholder:text-y-muted/60 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal/40"
          aria-label="网站域名"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-d-text transition-opacity hover:opacity-90 disabled:opacity-50 sm:whitespace-nowrap"
        >
          {loading ? "跳转中…" : "开始 SEO 审计"}
        </button>
      </form>
      {error && (
        <p className="mt-2 text-left font-mono text-xs text-coral">{error}</p>
      )}
      <p className="mt-2 text-left font-mono text-[10px] text-y-muted/60">
        输入域名即可快速审计，无需注册
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isAuthEnabled } from "@/lib/auth-config";

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)\.[a-z]{2,63}$/i;

export default function UrlAuditBox() {
  const t = useTranslations("hero.auditBox");
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
      setError(t("errEmpty"));
      return;
    }
    if (!DOMAIN_REGEX.test(domain)) {
      setError(t("errInvalid"));
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
      setError(t("errPrivate"));
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
          placeholder={t("placeholder")}
          className="h-12 flex-1 rounded-md border border-line bg-card px-4 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          aria-label={t("label")}
        />
        <button
          type="submit"
          disabled={loading}
          className="btn-primary btn-lg flex-none sm:whitespace-nowrap"
        >
          {loading ? t("submitting") : t("submit")}
        </button>
      </form>
      {error && (
        <p className="mt-2 text-left font-mono text-xs text-neg">{error}</p>
      )}
      <p className="mt-2 text-left font-mono text-xs text-ink-40">
        {t("hint")}
      </p>
    </div>
  );
}

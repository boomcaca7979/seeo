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
    <div className="mx-auto mt-8 w-full max-w-2xl px-0">
      {/* 域名审计主 CTA：输入框与提交按钮一体成型（radius 12px 卡片级容器，
          focus 时边框加深为 ink，submit 走黑色主按钮，视觉上不可忽视） */}
      <form onSubmit={handleSubmit}>
        <div className="flex h-14 flex-col overflow-hidden rounded-lg border border-line bg-card transition-colors focus-within:border-ink sm:flex-row sm:items-stretch">
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t("placeholder")}
            className="h-full min-w-0 flex-1 bg-transparent px-4 text-base text-ink placeholder:text-ink-40 focus:outline-none"
            aria-label={t("label")}
          />
          <button
            type="submit"
            disabled={loading}
            className="h-14 w-full flex-none rounded-none border-0 bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50 sm:h-auto sm:w-auto sm:whitespace-nowrap"
          >
            {loading ? t("submitting") : t("submit")}
          </button>
        </div>
      </form>
      {error && (
        <p className="mt-2 text-left font-mono text-xs text-neg">{error}</p>
      )}
    </div>
  );
}

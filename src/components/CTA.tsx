"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isAuthEnabled } from "@/lib/auth-config";

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)\.[a-z]{2,63}$/i;

export default function CTA() {
  const t = useTranslations("ctaBlock");
  const router = useRouter();
  const [domainInput, setDomainInput] = useState("");

  function normalizeDomain(input: string): string {
    let d = input.trim();
    d = d.replace(/^https?:\/\//i, "");
    d = d.replace(/\/.*$/, "");
    d = d.toLowerCase().trim();
    return d;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = normalizeDomain(domainInput);
    // 域名有效时带参跳转审计页，无效时走原默认入口
    const auditPath =
      domain && DOMAIN_REGEX.test(domain)
        ? `/app/audit?domain=${encodeURIComponent(domain)}`
        : isAuthEnabled
          ? "/signup"
          : "/app";

    if (isAuthEnabled) {
      router.push(`/login?redirect=${encodeURIComponent(auditPath)}`);
    } else {
      router.push(auditPath);
    }
  };

  return (
    <section id="cta" className="bg-station px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-2xl bg-ink p-8 sm:p-14">
          {/* 背景极光装饰 */}
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #6c4cff 0%, transparent 70%)",
            }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #2f8cff 0%, transparent 70%)",
            }}
          />

          <div className="relative text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-xs text-gold">
              {t("badge")}
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-d-text sm:text-5xl">
              {t("title")}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-d-secondary sm:text-lg">
              {t("subtitle")}
            </p>

            {/* 域名输入框 */}
            <form
              className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
              onSubmit={handleSubmit}
            >
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder={t("placeholder")}
                className="w-full rounded-lg border border-d-muted/30 bg-ink-elevated px-4 py-3 font-sans text-sm text-d-text placeholder:text-d-muted focus:border-gold focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-gold px-6 py-3 font-sans text-sm font-semibold text-ink transition-opacity hover:opacity-90"
              >
                {t("submit")}
              </button>
            </form>

            {/* 次级按钮 */}
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#features"
                className="font-sans text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
              >
                {t("browseFeatures")}
              </Link>
              <span className="hidden font-mono text-xs text-d-muted sm:inline">
                ·
              </span>
              <Link
                href="/pricing"
                className="font-sans text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
              >
                {t("viewPricing")}
              </Link>
            </div>

            {/* 信任标识 */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-d-muted">
              <span>{t("trust.daily")}</span>
              <span>{t("trust.google")}</span>
              {/* PDF 导出为 Pro 专属功能，文案明确标注（Fake Claim #6 修复） */}
              <span>{t("trust.pdf")}</span>
              <span>{t("trust.free")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

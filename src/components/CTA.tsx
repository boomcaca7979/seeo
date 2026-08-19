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
    <section id="cta" className="bg-paper px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="card-a relative overflow-hidden p-8 sm:p-14">
          <div className="relative text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 font-mono text-xs text-accent">
              {t("badge")}
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
              {t("title")}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-ink-60 sm:text-lg">
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
                className="h-12 w-full rounded-md border border-line bg-card px-4 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
              <button
                type="submit"
                className="btn-primary btn-lg flex-none"
              >
                {t("submit")}
              </button>
            </form>

            {/* 次级按钮 */}
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#features"
                className="font-sans text-sm font-medium text-ink-60 transition-colors hover:text-ink"
              >
                {t("browseFeatures")}
              </Link>
              <span className="hidden font-mono text-xs text-ink-25 sm:inline">
                ·
              </span>
              <Link
                href="/pricing"
                className="font-sans text-sm font-medium text-ink-60 transition-colors hover:text-ink"
              >
                {t("viewPricing")}
              </Link>
            </div>

            {/* 信任标识 */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-ink-40">
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

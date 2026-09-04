"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

// FAQ：参考 Semrush 的紧凑风格
// 左侧标题 + 右侧问题列表（或居中标题 + 紧凑手风琴）
// 不使用 card-a 包裹每条 FAQ，改用简洁 divider 风格。

interface FaqItem {
  q: string;
  a: string;
}

export default function PricingFAQ() {
  const t = useTranslations("pricing");
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const faqs = t.raw("faqs") as FaqItem[];

  return (
    <section className="py-16" aria-labelledby="pricing-faq-title">
      <div className="mx-auto max-w-[800px] px-6">
        <h2 id="pricing-faq-title" className="font-display text-[1.75rem] font-semibold leading-8 text-ink">
          {t("faqTitle")}
        </h2>

        <div className="mt-6">
          {faqs.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={item.q} className="border-b border-line">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`faq-panel-${i}`}
                  onClick={() => setOpenIndex(open ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left"
                >
                  <span className="font-sans text-sm font-medium text-ink">{item.q}</span>
                  <span
                    aria-hidden="true"
                    className={`flex-shrink-0 text-ink-40 transition-transform duration-150 ${
                      open ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                {open && (
                  <div id={`faq-panel-${i}`} className="pb-4">
                    <p className="font-sans text-sm leading-[20px] text-ink-60">{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

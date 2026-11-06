import Link from "next/link";
import { useTranslations } from "next-intl";

// ===== 首页「按任务找工具」区块 =====
// 目的：把五个产品能力翻译成用户手上的具体活儿，给出可抓取的站内链接。
// 纯服务端渲染（无 use client），文案全部走 messages.homeUseCases。

export default function HomeUseCases() {
  const t = useTranslations("homeUseCases");
  const items = t.raw("items") as Array<{
    task: string;
    tool: string;
    href: string;
  }>;

  return (
    <section className="bg-card px-5 py-12 sm:px-8 sm:py-16">
      <div className="site-shell">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {t("sectionTitle")}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-60 sm:text-base">
            {t("sectionSubtitle")}
          </p>
        </div>

        <ul className="mx-auto mt-9 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.task}>
              <Link
                href={item.href}
                className="card-a flex h-full flex-col justify-between gap-3 p-5 transition-colors hover:border-ink-25 sm:flex-row sm:items-center"
              >
                <span className="text-sm leading-relaxed text-ink">
                  {item.task}
                </span>
                <span className="inline-flex flex-none items-center gap-2 font-sans text-sm font-semibold text-accent">
                  {item.tool}
                  <span aria-hidden>→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

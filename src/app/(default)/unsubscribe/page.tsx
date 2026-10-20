import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

// ===== /unsubscribe —— 营销邮件退订确认页 =====
// 从邮件底部 Unsubscribe 链接 302 而来（token 在 /api/email/unsubscribe 处理）。
// noindex：工具页，不进搜索引擎。
// 文案走 messages（unsubscribePage），locale 与 /app、/login 共用 (default) 布局的
// NEXT_LOCALE cookie → Accept-Language → en 解析，不另建语言判断。

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribePage");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const t = await getTranslations("unsubscribePage");

  // 未知 status 与无参数一样落到入口态，退订语义与原有分支保持一致
  const { title, body } =
    status === "done"
      ? { title: t("doneTitle"), body: t("doneBody") }
      : status === "already"
        ? { title: t("alreadyTitle"), body: t("alreadyBody") }
        : status === "invalid"
          ? { title: t("invalidTitle"), body: t("invalidBody") }
          : { title: t("entryTitle"), body: "" };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="card-a p-8 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="font-display text-2xl font-semibold text-ink">See</span>
            <span className="font-display text-2xl font-semibold text-accent">O</span>
          </div>
          <h1 className="mt-6 font-display text-xl font-semibold text-ink">{title}</h1>
          {body && <p className="mt-3 font-sans text-sm leading-relaxed text-ink-60">{body}</p>}
          <Link href="/" className="btn-secondary mt-6 inline-block px-6 py-2 text-sm">
            {t("back")}
          </Link>
        </div>
      </div>
    </div>
  );
}

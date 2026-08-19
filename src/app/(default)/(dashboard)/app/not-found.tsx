import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("dashboard.notFound");
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center p-8 text-center">
      <div className="font-mono text-7xl font-semibold text-ink-25">404</div>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
        {t("title")}
      </h1>
      <p className="mt-2 font-sans text-sm text-ink-60">
        {t("subtitle")}
      </p>
      <Link
        href="/app"
        className="btn-primary mt-6"
      >
        {t("back")}
      </Link>
    </div>
  );
}

// ===== [locale] 404 页 =====
// 承接 [locale] 各页面 notFound()（如无效 locale 段 /foobar）。
// 渲染于 [locale]/layout 之内（params 驱动，无 cookies），可静态生成。

import Link from "next/link";

export default function LocaleNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-paper px-6">
      <div className="text-center">
        <div className="font-mono text-5xl font-bold tracking-widest text-ink">404</div>
        <h1 className="mt-4 font-mono text-lg font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-ink/60">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full border border-ink px-5 py-2 font-mono text-sm text-ink hover:bg-ink hover:text-paper transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

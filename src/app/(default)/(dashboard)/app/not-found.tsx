import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center p-8 text-center">
      <div className="font-mono text-7xl font-bold text-ink-25">404</div>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink">
        项目不存在
      </h1>
      <p className="mt-2 font-sans text-sm text-ink-60">
        可能链接已失效，或该项目已被删除。
      </p>
      <Link
        href="/app"
        className="btn-primary mt-6"
      >
        返回工作台
      </Link>
    </div>
  );
}

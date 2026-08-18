// ===== 全局 404（未匹配路由）=====
// Phase 5：项目使用 multiple root layouts（(default) 与 [locale]），
// Next 默认的 /_not-found 静态壳会在运行时因 (default) layout 读取 cookies
// 抛 "Page changed from static to dynamic" 导致未知路径 500。
// global-not-found（experimental.globalNotFound）在路由层直接返回本页，
// 完全绕过 layout 渲染，因此必须自包含样式、不依赖全局 CSS/字体。
//
// 语言：未知路径无 locale 上下文，按默认语言 en 输出（与 sitemap/robots 一致）。

import Link from "next/link";

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          backgroundColor: "#faf8f3",
          color: "#1a1a1a",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "3rem", fontWeight: 700, letterSpacing: "0.08em" }}>404</div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0.75rem 0 0.5rem" }}>
            Page not found
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
            The page you are looking for does not exist.
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              border: "1px solid #1a1a1a",
              borderRadius: "9999px",
              color: "#1a1a1a",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Back to Home
          </Link>
        </div>
      </body>
    </html>
  );
}

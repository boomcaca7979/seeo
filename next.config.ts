import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl 请求级配置（默认路径 src/i18n/request.ts）
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  // Phase 5：multiple root layouts 下，默认 /_not-found 静态壳会因 (default)
  // layout 读取 cookies 在运行时 500。globalNotFound 在路由层直接返回
  // src/app/global-not-found.tsx（绕过 layout 渲染），未知路径正确 404。
  experimental: {
    globalNotFound: true,
  },
  images: {
    unoptimized: true,
  },
  // SEO 审计 S-13：基础安全响应头（不影响 AdSense / auth / Creem 跳转——
  // 站点自身不被 iframe，Creem checkout 为外部跳转）。
  // CSP 涉及 AdSense + Next 内联脚本白名单，留作后续 OPTIONAL HARDENING。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/app/keywords',
        destination: '/app/keyword-overview',
        permanent: true,
      },
      {
        source: '/app/keywords/:path*',
        destination: '/app/keyword-overview',
        permanent: true,
      },
      {
        source: '/app/rank-tracking',
        destination: '/app/position-tracking',
        permanent: true,
      },
      {
        source: '/app/rank-tracking/:path*',
        destination: '/app/position-tracking',
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

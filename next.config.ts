import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl 请求级配置（默认路径 src/i18n/request.ts）
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  // dev 跨源防护（blockCrossSiteDEV）默认只信任 localhost：用 127.0.0.1 打开 dev 页面时，
  // HMR websocket 的 Origin 会被判为跨站静默销毁，Next 16 dev 的水合依赖该 socket，
  // 结果是整页 React 事件全部失效（按钮/箭头点了没反应）且 console 无报错。
  // 把 127.0.0.1 与本机局域网地址显式加白，只影响 dev，不影响生产构建。
  allowedDevOrigins: ["127.0.0.1"],
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
      // 只读分享页：内容随「撤销分享」立即失效，任何层级都不得缓存。
      {
        source: "/share/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // 策略 API：含用户私有数据与分享 token，禁止任何中间层缓存。
      {
        source: "/api/keywords/strategies/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }],
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

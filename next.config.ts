import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl 请求级配置（默认路径 src/i18n/request.ts）
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
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

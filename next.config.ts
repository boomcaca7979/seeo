import type { NextConfig } from "next";

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

export default nextConfig;

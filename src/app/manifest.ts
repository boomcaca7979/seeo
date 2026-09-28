import type { MetadataRoute } from "next";

// 仅补充 metadata：不引入 service worker / PWA 功能
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SeeO",
    short_name: "SeeO",
    description: "AI-powered SEO platform",
    start_url: "/",
    display: "standalone",
    icons: [
      {
        src: "/brand/seeo-icon-1024.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}

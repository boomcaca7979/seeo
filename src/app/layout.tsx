import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { CookieBanner } from "@/components/cookie-banner";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://seeo-five.vercel.app";

const siteTitle = "SeeO · 看清搜索流量的走向";
const siteDescription =
  "SeeO 是一站式 SEO 数据分析平台，把关键词、排名、外链、技术审计、竞品与内容优化放在同一张工作台上，帮你看清搜索流量的走向。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: siteTitle,
  description: siteDescription,
  applicationName: "SeeO",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: "SeeO",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "SeeO · 看清搜索流量的走向",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-station text-y-text font-sans">
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}

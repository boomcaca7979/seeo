import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import FeatureCards from "@/components/FeatureCards";
import DashboardPreview from "@/components/DashboardPreview";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { softwareApplicationSchema } from "@/lib/seo/schema";

export default function Home() {
  return (
    <>
      {/* 首页产品实体：SoftwareApplication（价格来自 PLAN_PRICING 单一来源） */}
      <JsonLd schema={softwareApplicationSchema()} />
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Ticker />
        <FeatureCards />
        <DashboardPreview />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

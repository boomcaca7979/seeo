import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "服务条款 · SeeO",
  description: "SeeO 服务条款：使用 SeeO 平台的相关条款与条件。",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Terms of Service", url: "/terms" },
        ])}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-bold text-ink mb-8">服务条款</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">01 服务描述</h2>
            <p>
              SeeO 是一站式 SEO 数据分析平台，提供关键词追踪、排名监控、技术审计、竞品分析、内容优化等功能。服务基于 SerpApi 与自建抓取能力。
            </p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">02 用户责任</h2>
            <p>使用本服务时，您承诺：</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>不得滥用 API，包括但不限于脚本批量请求、绕过用量限制</li>
              <li>不得爬取他人网站用于恶意用途（如抄袭、攻击）</li>
              <li>不得将服务用于任何违法或侵权行为</li>
              <li>妥善保管账号凭据，因泄露导致的损失由您自行承担</li>
            </ul>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">03 免责声明</h2>
            <p>
              SEO 数据仅供参考，不保证排名提升或流量增长。搜索结果受搜索引擎算法、地区、设备、时间等多重因素影响，本服务不对数据的绝对准确性作出承诺。
            </p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">04 服务变更与终止</h2>
            <p>
              我们保留随时变更、暂停或终止部分或全部服务的权利。如因违反本条款导致账号被封禁，已支付费用不予退还。
            </p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">05 争议解决</h2>
            <p>
              本条款的解释与争议适用中华人民共和国法律。如有争议，双方应先协商解决；协商不成的，提交服务提供所在地有管辖权的人民法院诉讼解决。
            </p>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">最后更新：2026年8月</p>
        </div>
      </div>
    </div>
  );
}

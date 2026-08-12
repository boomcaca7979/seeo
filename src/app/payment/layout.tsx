import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "支付 · SeeO",
  description: "SeeO 支付结果页：支持支付宝 / 微信支付，一次性购买 30 天会员。",
  robots: { index: false, follow: false },
};

export default function PaymentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

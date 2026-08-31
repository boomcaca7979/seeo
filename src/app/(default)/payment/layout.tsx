import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "支付 · SeeO",
  description: "SeeO 支付结果页：Creem 安全支付，订阅与定制服务订单状态查询。",
  robots: { index: false, follow: false },
};

export default function PaymentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

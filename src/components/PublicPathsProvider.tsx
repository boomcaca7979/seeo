"use client";

import { createContext, useContext, type ReactNode } from "react";

// ===== 「暂缓上线」公开路径的 client 通道 =====
//
// 背景：公开路径的收录开关（BACKLINK_CHECKER_ENABLED → DISABLED_PUBLIC_PATHS，
// 见 src/lib/seo/public-tools.ts）只在服务端可读。Footer 等 client 组件需要
// 按同一开关下线指向暂缓页的内链（GSC「Excluded by noindex」的持续发现源），
// 但 client bundle 里 process.env 非 NEXT_PUBLIC_* 变量会被内联为 undefined——
// 直接 import 会造成 SSR 与 hydration 判定不一致。
//
// 因此由两个 root layout（[locale] 与 (default)，均为 server 组件）在渲染期
// 读取真实开关，经 RSC props 注入本 Provider；client 侧只消费值，不做任何
// env 判定。开关变更需要重新构建（sitemap 同为构建期产物），两侧自然同步。

const PublicPathsContext = createContext<readonly string[]>([]);

export function PublicPathsProvider({
  disabledPaths,
  children,
}: {
  /** 当前「暂缓上线」的公开路径（逻辑路径，不含 locale 前缀） */
  disabledPaths: readonly string[];
  children: ReactNode;
}) {
  return (
    <PublicPathsContext.Provider value={disabledPaths}>
      {children}
    </PublicPathsContext.Provider>
  );
}

/** 当前不应输出内链的公开路径（逻辑路径，不含 locale 前缀）。默认空 = 全部可链。 */
export function useDisabledPublicPaths(): readonly string[] {
  return useContext(PublicPathsContext);
}

"use client";

// ===== 项目详情页的操作入口（唯一需要 client 的部分）=====
//
// 为什么必须在 client：后台里竞品分析 / 优化机会 / 行动中心 三页按「活跃项目 id」
// （localStorage SELECTED_PROJECT_KEY，由 Topbar 切换器写入）取数，而不是按 URL 参数。
// 详情页只由服务端渲染项目本身，若不同步活跃项目，从项目 A 详情页点进这三页会看到项目 B
// 的数据。这里复用 Topbar 已有的写入契约（setActiveProject），不新建第二套状态机制。
//
// 域名维度的页面（技术审计 / 内容优化 / 外链分析）走各自的 ?domain= 深链契约，
// 由调用方在 href 里带上，不依赖这里的同步。

import Link from "next/link";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { setActiveProject } from "@/lib/project-selector";

export interface ProjectActionLink {
  key: string;
  title: string;
  desc: string;
  tag: string;
  href: string;
}

export default function ProjectActionLinks({
  projectId,
  links,
}: {
  /** 详情页当前项目的 id（鉴权模式 UUID / 演示模式整数字符串），原样传递不做数值转换 */
  projectId: string;
  links: ProjectActionLink[];
}) {
  const t = useTranslations("dashboard.shared.projectDetail");

  // 挂载即同步：直接输入 URL、刷新、从项目卡进入都覆盖到
  useEffect(() => {
    setActiveProject(projectId);
  }, [projectId]);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          // 点击时再同步一次：Topbar 可能在挂载后被切换过，此处保证进入的目标页
          // 用的仍是详情页这个项目
          onClick={() => setActiveProject(projectId)}
          className="card-a group flex flex-col p-5 transition-colors hover:border-ink-25"
        >
          <span className="badge-info w-fit">{l.tag}</span>
          <h3 className="mt-3 font-display text-base font-semibold text-ink">
            {l.title}
          </h3>
          <p className="mt-1 font-sans text-xs text-ink-60">{l.desc}</p>
          <span className="mt-3 font-sans text-xs font-medium text-ink-60 opacity-0 transition-opacity group-hover:opacity-100">
            {t("enter")}
          </span>
        </Link>
      ))}
    </div>
  );
}

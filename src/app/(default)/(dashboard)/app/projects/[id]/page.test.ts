// ===== /app/projects/[id] 详情页测试（鉴权模式）=====
// 覆盖四条真实契约：
//   1. 详情页直接接受 Supabase UUID（存在 → 渲染；不存在/越权 → 本地化错误面板）
//   2. 项目数据全部来自共享构建器（指标 / 竞品数 / 工作队列），任一读取失败都不阻塞渲染，
//      也不会把"读不到"降级成"没有问题"
//   3. 快捷入口必须带上当前项目上下文：域名维度走 ?domain=，项目维度传递当前项目 id
//      （这是"从项目 A 点进去看到项目 B"回归的防线）
//   4. 「不存在」与「读不到」是两种结果：只有数据源确认没有这条记录才渲染错误面板，
//      查询报错必须抛出 ProjectDataUnavailableError（把故障渲染成 404 会抹掉真实项目）
//   5. 缺失分支不调 notFound()：那会触发 Next 内部 boundary 的 robots 注入，
//      与 (default) layout 的 noindex, follow 叠成两条（mock 里的 throw 就是这条的绊线）

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";

vi.mock("@/lib/auth-config", () => ({ isAuthEnabled: true }));

// i18n：详情页为 server component，使用 next-intl/server 的 getTranslations/getLocale；
// 单测环境无 Next.js 请求上下文，mock 为返回 key 的最简实现。
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    key + (values ? ` ${JSON.stringify(values)}` : ""),
  getLocale: async () => state.locale,
}));

// 绊线：详情页一旦改用 notFound()，这里就抛错，对应测试立刻失败。
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  Link: () => null,
}));

const state = {
  project: null as Record<string, unknown> | null,
  /** Supabase 读项目行的 error（非 null = 数据源故障，绝不能降级成 404） */
  projectError: null as { code?: string; message?: string } | null,
  metrics: null as Record<string, unknown> | null,
  competitors: null as number | null,
  queue: null as Record<string, unknown> | null,
  failMetrics: false,
  failQueue: false,
  locale: "en" as "en" | "zh",
};

vi.mock("@/lib/db", () => ({
  getProjectById: vi.fn(async () => null),
  getProjectByDomain: vi.fn(async () => ({ id: 42 })),
  getProjectWithMetrics: vi.fn(async () => {
    if (state.failMetrics) throw new Error("db down");
    return state.metrics;
  }),
  countCompetitors: vi.fn(async () => {
    if (state.competitors === null) throw new Error("db down");
    return state.competitors;
  }),
}));

vi.mock("@/lib/seo/work-queue", () => ({
  buildWorkQueue: vi.fn(async () => {
    if (state.failQueue) throw new Error("db down");
    return state.queue;
  }),
}));

const state2 = {
  user: { id: "user-1" } as { id: string } | null,
  /** 详情页实际下发的过滤条件，按调用顺序记录（证明归属条件写进了查询本身） */
  filters: [] as Array<[string, unknown]>,
};

vi.mock("@/lib/supabase/server", () => ({
  createServer: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: state2.user } }),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          state2.filters.push([column, value]);
          return {
            eq: (column2: string, value2: unknown) => {
              state2.filters.push([column2, value2]);
              return {
                // 与 @/lib/project-access 的真实调用链一致：maybeSingle()
                // （0 行 = data null 且无 error；error 一定是真故障）
                maybeSingle: async () => ({ data: state.project, error: state.projectError }),
              };
            },
          };
        },
      }),
    })),
  })),
}));

import ProjectDetailPage from "./page";
import { ProjectDataUnavailableError } from "@/lib/project-access";
import NotFoundPanel from "@/components/dashboard/NotFoundPanel";
import ProjectActionLinks from "@/components/dashboard/ProjectActionLinks";
import MetricCard from "@/components/viz/MetricCard";

const UUID = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";

function props(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** 队列最小可用形态：一次已完成审计 + 两条待处理任务 */
function makeQueue() {
  const task = (id: string, level: "P0" | "P1", status: string) => ({
    id,
    source: "audit",
    type: "missing_title",
    title: { en: `issue ${id}`, zh: `问题 ${id}` },
    fallbackTitle: null,
    target: "https://toolstep.xyz/a",
    severity: "error",
    affectedPages: 3,
    findings: 5,
    status,
    priority: { level, score: 90, reasons: [] },
    verification: { status: "pending", channelKey: "re-audit" },
    verificationChannel: { verifiable: true, channelKey: "re-audit" },
    systemDetected: true,
    provenance: "observed",
    observation: null,
    valueCategory: "technical_health",
    evidence: [],
    recommendation: null,
    recommendationText: null,
    recommendationI18n: null,
    effort: "low",
    execution: {
      kind: "audit_fix",
      available: true,
      primary: {
        href: `/app/audit?domain=toolstep.xyz&view=issues&issue=${id}`,
        labelKey: "act.openIssue",
        module: "audit",
      },
      secondary: [],
      unavailableReason: null,
    },
  });
  return {
    domain: "toolstep.xyz",
    projectId: 42,
    generatedAt: "2026-10-16T00:00:00Z",
    tasks: [task("t1", "P0", "open"), task("t2", "P1", "in_progress")],
    counts: { open: 1, in_progress: 1, fixed_claimed: 0, verified_resolved: 0, dismissed: 0 },
    coverage: {
      audit: {
        available: true,
        auditId: 7,
        depth: "full",
        finishedAt: "2026-10-15 06:21:05",
        pagesCrawled: 41,
        healthScore: 86,
        partial: false,
      },
      tracking: { trackedKeywords: 12 },
      contributingSources: ["audit"],
      opportunitySources: [],
      verifiableTasks: 2,
      observedTasks: 0,
      gaps: ["no_tracked_keywords"],
    },
  };
}

/** 未审计但队列里确有机会项（p14 的真实形态）：机会任务 title 为 null，只有 i18n 建议与英文兜底文本 */
function makeQueueNoAudit() {
  const q = makeQueue();
  return {
    ...q,
    coverage: {
      ...q.coverage,
      audit: { ...q.coverage.audit, available: false, healthScore: null, finishedAt: null, pagesCrawled: null },
    },
    tasks: [
      {
        ...q.tasks[0],
        id: "opp:9",
        source: "opportunity",
        type: "technical",
        title: null,
        recommendationI18n: { en: "fix the redirect chain", zh: "修复重定向链" },
        recommendationText: "fix the redirect chain",
        fallbackTitle: "Fix 2 error-level issue(s) on https://toolstep.xyz/a (see audit #20)",
        affectedPages: null,
        findings: null,
      },
    ],
    counts: { ...q.counts, open: 1, in_progress: 0 },
  };
}

/** 遍历未渲染的元素树（server component 返回的即此形态） */
function walkTree(
  node: unknown,
  visit: (el: { type?: unknown; props: Record<string, unknown> }) => void
): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walkTree(child, visit));
    return;
  }
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const props = el.props;
  if (!props) return;
  visit({ type: el.type, props });
  walkTree(props.children, visit);
}

/** 递归收集元素树上的 href，并按组件身份取出快捷入口组件收到的 props */
function collect(element: ReactElement): { hrefs: string[]; actionLinks: Record<string, unknown>[]; projectId: string[] } {
  const hrefs: string[] = [];
  const actionLinks: Record<string, unknown>[] = [];
  const projectId: string[] = [];
  walkTree(element, (el) => {
    if (typeof el.props.href === "string") hrefs.push(el.props.href);
    if (el.type === ProjectActionLinks) {
      actionLinks.push(el.props);
      projectId.push(el.props.projectId as string);
    }
  });
  return { hrefs, actionLinks, projectId };
}

/** 按 label（i18n key）取出指标卡 props：值与"不可用"文案都在 props 上，不在 children 里 */
function cardByLabel(element: ReactElement, label: string): Record<string, unknown> {
  let found: Record<string, unknown> | undefined;
  walkTree(element, (el) => {
    if (el.type === MetricCard && el.props.label === label) found = el.props;
  });
  if (!found) throw new Error(`MetricCard ${label} not rendered`);
  return found;
}

/** 收集元素树上所有已求值的文本节点（server component 返回的是已构建的元素树） */
function texts(element: ReactElement): string {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string" || typeof node === "number") {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    visit((node as { props?: Record<string, unknown> }).props?.children);
  };
  visit(element);
  return out.join("|");
}

beforeEach(() => {
  state.project = {
    id: UUID,
    user_id: "user-1",
    name: "toolstep",
    domain: "toolstep.xyz",
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
  };
  state.metrics = {
    id: UUID,
    name: "toolstep",
    domain: "toolstep.xyz",
    created_at: "2026-08-10T00:00:00Z",
    trackedKeywordCount: 12,
    healthScore: 86,
    lastAuditTime: "2026-10-15 06:21:05",
    rankUp7d: 2,
    rankDown7d: 1,
    alertCount: 3,
  };
  state.competitors = 3;
  state.queue = makeQueue();
  state.failMetrics = false;
  state.failQueue = false;
  state.locale = "en";
  state.projectError = null;
  state2.user = { id: "user-1" };
  state2.filters = [];
});

describe("项目详情页（鉴权模式，UUID 路由）", () => {
  it("真实 UUID → 正常加载（返回 ReactElement，不抛错）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    expect(el).toBeTruthy();
    expect(typeof (el as ReactElement).type).toBeTruthy();
  });

  it("不存在的 UUID → 渲染本地化错误面板（不经 notFound，避免第二条 robots）", async () => {
    state.project = null;
    const el = await ProjectDetailPage(props("00000000-0000-0000-0000-000000000000"));
    expect((el as ReactElement).type).toBe(NotFoundPanel);
  });

  it("id=0（修复前列表产生的错误链接）→ 同样渲染错误面板，不抛错", async () => {
    state.project = null; // UUID 主键表查不到 "0"
    const el = await ProjectDetailPage(props("0"));
    expect((el as ReactElement).type).toBe(NotFoundPanel);
  });

  it("未登录（supabase 返回 null）→ 渲染错误面板，且不向错误分支传任何项目数据", async () => {
    state2.user = null;
    const el = (await ProjectDetailPage(props(UUID))) as ReactElement;
    expect(el.type).toBe(NotFoundPanel);
    expect(JSON.stringify(el.props ?? {})).toBe("{}");
  });

  it("查询带 user_id 条件（不依赖 RLS 单独兜底，越权项目取不到 → 错误面板）", async () => {
    state.project = null;
    const el = await ProjectDetailPage(props(UUID));
    expect((el as ReactElement).type).toBe(NotFoundPanel);
  });

  it("归属条件真的写进了查询：id + 当前 user_id 两个过滤，原样下发", async () => {
    await ProjectDetailPage(props(UUID));
    expect(state2.filters).toEqual([
      ["id", UUID],
      ["user_id", "user-1"],
    ]);
  });

  it("数据源报错（连接失败 / 查询被拒）→ 抛「不可用」，绝不降级成 404", async () => {
    state.project = null;
    state.projectError = { code: "PGRST000", message: "Failed to fetch" };
    const error = await ProjectDetailPage(props(UUID)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectDataUnavailableError);
    expect(String(error)).not.toContain("NOT_FOUND");
  });

  it("未登录时不发起项目查询（避免用别人的会话读数据）", async () => {
    state2.user = null;
    await ProjectDetailPage(props(UUID));
    expect(state2.filters).toEqual([]);
  });
});

describe("项目详情页数据展示", () => {
  it("指标 / 竞品 / 队列读取全部失败时仍渲染，不抛错（页面不退化成空白）", async () => {
    state.failMetrics = true;
    state.failQueue = true;
    state.competitors = null;
    const el = await ProjectDetailPage(props(UUID));
    expect(el).toBeTruthy();
  });

  it("展示当前项目域名与项目 id（供上下文传递使用）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    const { actionLinks } = collect(el as ReactElement);
    expect(actionLinks.length).toBe(1);
    expect(actionLinks[0].projectId).toBe(UUID);
  });
});

describe("项目上下文传递（本阶段核心回归防线）", () => {
  it("域名维度的入口都带 ?domain=当前域名", async () => {
    const el = await ProjectDetailPage(props(UUID));
    const { actionLinks } = collect(el as ReactElement);
    const links = actionLinks[0].links as Array<{ key: string; href: string }>;
    const byKey = Object.fromEntries(links.map((l) => [l.key, l.href]));
    expect(byKey.audit).toContain("domain=toolstep.xyz");
    expect(byKey.content).toContain("domain=toolstep.xyz");
    expect(byKey.backlinks).toContain("domain=toolstep.xyz");
  });

  it("项目维度的入口由详情页传递当前项目 id（不依赖 Topbar 的旧选中值）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    const { actionLinks, projectId } = collect(el as ReactElement);
    const links = actionLinks[0].links as Array<{ key: string; href: string }>;
    const keys = links.map((l) => l.key);
    // 竞品/机会这类按活跃项目 id 取数的页面必须在同步列表里
    expect(keys).toContain("competitors");
    expect(keys).toContain("opportunities");
    expect(projectId).toEqual([UUID]);
  });

  it("待处理事项的执行链接来自队列本身（已带域名上下文）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    const { hrefs } = collect(el as ReactElement);
    expect(hrefs.some((h) => h.includes("/app/audit?domain=toolstep.xyz&view=issues&issue=t1"))).toBe(
      true
    );
  });

  it("长域名做 URL 编码后传递", async () => {
    state.project = { ...state.project, domain: "sub.example-toolstep.xyz", id: UUID };
    const el = await ProjectDetailPage(props(UUID));
    const { actionLinks } = collect(el as ReactElement);
    const links = actionLinks[0].links as Array<{ key: string; href: string }>;
    expect(links.find((l) => l.key === "audit")?.href).toContain("domain=sub.example-toolstep.xyz");
  });

  it("详情页与快捷入口使用同一个项目 id 类型（string，不做数值转换）", async () => {
    const el = await ProjectDetailPage(props(UUID));
    const { projectId } = collect(el as ReactElement);
    expect(projectId[0]).toBe(UUID);
    expect(projectId[0]).not.toMatch(/^\d+$/); // 鉴权模式为 UUID，绝不能被 Number() 吞成 NaN
  });
});

// ProjectActionLinks 是详情页唯一需要 client 的部分（写入「活跃项目 id」），
// node 环境下无法渲染，按本仓库契约测试惯例改为读取源码断言它复用共享写入路径。
const ACTION_LINKS_SRC = readFileSync(
  fileURLToPath(
    new URL("../../../../../../components/dashboard/ProjectActionLinks.tsx", import.meta.url)
  ),
  "utf-8"
);

describe("待处理事项的可读性与状态一致性", () => {
  it("机会任务取本地化建议文本，不把引擎生成的英文兜底混排进中文界面", async () => {
    state.locale = "zh";
    state.queue = makeQueueNoAudit();
    const all = texts((await ProjectDetailPage(props(UUID))) as ReactElement);
    expect(all).toContain("修复重定向链");
    expect(all).not.toContain("Fix 2 error-level issue(s)");
  });

  it("英文界面下取该任务的 en 建议文本", async () => {
    state.queue = makeQueueNoAudit();
    const all = texts((await ProjectDetailPage(props(UUID))) as ReactElement);
    expect(all).toContain("fix the redirect chain");
    expect(all).not.toContain("Fix 2 error-level issue(s)");
  });

  it("未审计但确有机会项：保留真实待办列表 + 审计提示，不用空状态盖住数据", async () => {
    state.queue = makeQueueNoAudit();
    const el = (await ProjectDetailPage(props(UUID))) as ReactElement;
    const all = texts(el);
    expect(all).toContain("todoAuditNotice");
    expect(all).toContain("fix the redirect chain");
    // 指标卡：真实条数照常显示，同时说明「这些是机会项，技术问题还没测过」
    const open = cardByLabel(el, "metricOpenTasks");
    expect(open.value).toBe(1);
    expect(String(open.caption)).toContain("openTasksNoAuditCaption");
    // 不能同时出现「完全没有数据」的空状态标题
    expect(all).not.toContain("todoNoAuditTitle");
  });

  it("未审计且队列确实为空：显示审计空状态，不把「没测过」写成 0 或没问题", async () => {
    const q = makeQueueNoAudit();
    state.queue = { ...q, tasks: [], counts: { open: 0, in_progress: 0, fixed_claimed: 0, verified_resolved: 0, dismissed: 0 } };
    const el = (await ProjectDetailPage(props(UUID))) as ReactElement;
    const all = texts(el);
    expect(all).toContain("todoNoAuditTitle");
    expect(all).not.toContain("todoAuditNotice");
    expect(cardByLabel(el, "metricOpenTasks").value).toBeNull();
    expect(cardByLabel(el, "metricOpenTasks").unavailableLabel).toBe("notMeasured");
    expect(cardByLabel(el, "metricHealth").value).toBeNull();
    expect(cardByLabel(el, "metricHealth").unavailableLabel).toBe("noAudit");
  });
});

describe("ProjectActionLinks 契约（client 侧）", () => {
  it("复用共享 setActiveProject，不自建第二套项目状态机制", () => {
    expect(ACTION_LINKS_SRC).toContain('import { setActiveProject } from "@/lib/project-selector"');
    expect(ACTION_LINKS_SRC).not.toMatch(/const SELECTED_PROJECT_KEY/);
    expect(ACTION_LINKS_SRC).not.toContain("localStorage.setItem");
    expect(ACTION_LINKS_SRC).not.toContain("CustomEvent");
  });

  it("挂载即同步 + 点击再同步（覆盖直接输入 URL、刷新与切换后进入）", () => {
    expect(ACTION_LINKS_SRC).toMatch(/useEffect\(\(\) => \{\s*setActiveProject\(projectId\);\s*\}, \[projectId\]\);/);
    expect(ACTION_LINKS_SRC).toContain("onClick={() => setActiveProject(projectId)}");
  });

  it("项目 id 原样传递，不做数值转换（鉴权模式 UUID 会变 NaN）", () => {
    expect(ACTION_LINKS_SRC).toContain("projectId: string;");
    expect(ACTION_LINKS_SRC).not.toMatch(/Number\(|parseInt\(/);
  });
});

// ===== RSC 导航的 robots 单一性契约 =====
// 详情页缺失分支改用 NotFoundPanel 的全部理由：Server Component 里调用 notFound()
// 会让 Next 自己插入一条 <meta name="robots" content="noindex">
// （node_modules/next/dist/client/components/not-found.js 的实现注释），与
// (default)/layout.tsx 的 noindex, follow 在**同一份 DOM** 里叠成两条。
// node 环境渲染不了这些 server component，故按仓库惯例锁源码形态；
// 真实 robots 条数与语言由隔离生产构建里的浏览器验收（文档 + RSC 两条路径分别计数）。
const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const PANEL_SRC = readFileSync(
  fileURLToPath(new URL("../../../../../../components/dashboard/NotFoundPanel.tsx", import.meta.url)),
  "utf-8"
);
const BOUNDARY_SRC = readFileSync(fileURLToPath(new URL("../../not-found.tsx", import.meta.url)), "utf-8");
const LAYOUT_SRC = readFileSync(
  fileURLToPath(new URL("../../../../layout.tsx", import.meta.url)),
  "utf-8"
);

// 注释里会点名 notFound()/robots（就是在解释为什么不能用它们），按仓库惯例
// （navbar-locale-switch-contract.test.ts）先剥注释再断言，否则禁用的形态会被
// 说明文字自己触发。
function code(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const PAGE = code(PAGE_SRC);
const PANEL = code(PANEL_SRC);
const BOUNDARY = code(BOUNDARY_SRC);
const LAYOUT = code(LAYOUT_SRC);

function messages(locale: "zh" | "en") {
  const file = fileURLToPath(new URL(`../../../../../../../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, "utf-8")).dashboard.notFound as Record<string, string>;
}

describe("缺失项目分支不经 not-found boundary（robots 只留 layout 那一条）", () => {
  it("详情页不再引用 next/navigation 的 notFound", () => {
    expect(PAGE).not.toContain('from "next/navigation"');
    expect(PAGE).not.toMatch(/\bnotFound\(\)/);
  });

  it("详情页缺失分支直接返回共享面板", () => {
    expect(PAGE).toContain("if (!data) return <NotFoundPanel />;");
  });

  it("面板只输出本地化正文，不自带 robots、不掩盖不一致", () => {
    expect(PANEL).toContain('getTranslations("dashboard.notFound")');
    expect(PANEL).not.toMatch(/\bnotFound\(\)/);
    expect(PANEL).not.toContain("next/navigation");
    expect(PANEL).not.toContain("suppressHydrationWarning");
    expect(PANEL).not.toContain("robots");
    // 返回工作台：与文档级 404 同一语义的出口
    expect(PANEL).toContain('href="/app"');
  });

  it("not-found 边界复用同一个面板（两条路径不会漂出两套文案）", () => {
    expect(BOUNDARY).toContain("<NotFoundPanel />");
    expect(BOUNDARY).toContain('import NotFoundPanel from "@/components/dashboard/NotFoundPanel"');
  });

  it("(default) layout 的 noindex, follow 未被削弱（禁止为去重删除共享 robots）", () => {
    expect(LAYOUT).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*true,\s*\}/);
  });

  it("中英两种界面语言都有完整的 404 文案", () => {
    for (const locale of ["zh", "en"] as const) {
      const t = messages(locale);
      for (const key of ["title", "subtitle", "back"]) {
        expect(t[key]).toBeTruthy();
      }
    }
    expect(messages("zh").title).toBe("项目不存在");
  });
});

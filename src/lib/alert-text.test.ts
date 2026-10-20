// ===== BUG-47：预警文案必须双语可本地化 =====
// 症状（真实浏览器，模式 2 隔离测试数据）：NEXT_LOCALE=en 时 /app 活动列表与铃铛
// 面板显示「example.com 审计错误数增加」「www.toolstep.top 审计完成」等中文。
// 根因：审计/排名预警在后台任务里生成（无请求 locale），旧实现直接把中文标题
// 写进 alerts.title，渲染端原样输出。
// 修复：写入端产出 LText（en+zh），db 层负责序列化/反序列化，读取端统一走
// alertText()；历史中文行按模板映射到 EN，未知文本（用户关键词、demo 自有文案）
// 原样返回，绝不编造。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import { alertLText, alertText, parseAlertText, serializeAlertText } from "@/lib/alert-text";

const captured: Array<{ type: string; level: string; title: unknown; detail: unknown; domain: string | null }> = [];

vi.mock("@/lib/db", () => ({
  getPreviousRankHistory: vi.fn(async () => null),
  createAlert: vi.fn(async (_userId: string, params: { type: string; level: string; title: unknown; detail: unknown; domain: string | null }) => {
    captured.push(params);
  }),
  hasAlertToday: vi.fn(async () => false),
}));

import { getPreviousRankHistory } from "@/lib/db";
import { generateRankAlert } from "@/lib/seo/alerts";

describe("序列化：同日去重依赖 title 列字符串，键序必须确定", () => {
  it("LText 以固定键序入库，纯文本原样", () => {
    expect(serializeAlertText({ en: "B", zh: "乙" })).toBe('{"en":"B","zh":"乙"}');
    // 构造顺序相反也必须得到同一个字符串（否则同一条事实会重复预警）
    expect(serializeAlertText({ zh: "乙", en: "B" })).toBe('{"en":"B","zh":"乙"}');
    expect(serializeAlertText("example.com 审计完成")).toBe("example.com 审计完成");
  });

  it("只认 en/zh 双字符串 JSON，历史文本与用户数据按原文返回", () => {
    expect(parseAlertText('{"en":"A","zh":"甲"}')).toEqual({ en: "A", zh: "甲" });
    expect(parseAlertText("example.com 审计完成")).toBe("example.com 审计完成");
    expect(parseAlertText('{"note":"不是 LText"}')).toBe('{"note":"不是 LText"}');
    expect(parseAlertText("{ 用户写的标题 }")).toBe("{ 用户写的标题 }");
    expect(parseAlertText(null)).toBeNull();
  });
});

describe("读取端：alertText 按 locale 取值", () => {
  it("LText 对象直接按 locale 选", () => {
    const t = alertLText("example.com 审计完成", "Audit finished for example.com");
    expect(alertText(t, "en")).toBe("Audit finished for example.com");
    expect(alertText(t, "zh")).toBe("example.com 审计完成");
  });

  it("历史中文标题与明细在 EN 界面得到英文", () => {
    const cases: Array<[string, string]> = [
      ["example.com 审计完成", "Audit finished for example.com"],
      ["example.com 审计错误数增加", "More audit errors on example.com"],
      ["www.seeo.asia 检测到 404 死链", "404 broken links detected on www.seeo.asia"],
      ['关键词「seo tools」排名下降 7 位', 'Keyword "seo tools" dropped 7 positions'],
      ['关键词「seo tools」排名上升 1 位', 'Keyword "seo tools" climbed 1 position'],
      ['关键词「crm」从排名 12 掉出前 100', 'Keyword "crm" fell from #12 out of the top 100'],
      ["健康分 良好 · 3 个问题", "Health: good · 3 issues"],
      ["健康分 1 个错误 · 9 个问题", "Health: 1 error · 9 issues"],
      ["本次 2 个错误，上次 1 个", "2 errors this run vs 1 last run"],
      ["审计 #12 发现 404 错误页面，建议添加 301 重定向", "Audit #12 found 404 pages; add 301 redirects"],
      ["域名 example.com · 上次排名 8（2026-10-01）", "Domain example.com · previous rank 8 (2026-10-01)"],
      ["域名 example.com · 14 → 6", "Domain example.com · 14 → 6"]
    ];
    for (const [zh, en] of cases) {
      expect(alertText(zh, "en")).toBe(en);
    }
  });

  it("英文侧标题在 ZH 界面得到中文（双向）", () => {
    expect(alertText("Audit finished for example.com", "zh")).toBe("example.com 审计完成");
    expect(alertText('Keyword "seo tools" dropped 7 positions', "zh")).toBe('关键词「seo tools」排名下降 7 位');
    expect(alertText("Health: 1 error · 9 issues", "zh")).toBe("健康分 1 个错误 · 9 个问题");
  });

  it("映射不破坏 zh 侧原样文本，未知文本原样返回（不编造翻译）", () => {
    expect(alertText("example.com 审计完成", "zh")).toBe("example.com 审计完成");
    // demo 自有文案与用户关键词不是模板产物 → 必须原样
    expect(alertText("3 pages missing meta description", "en")).toBe("3 pages missing meta description");
    expect(alertText("my own keyword title", "zh")).toBe("my own keyword title");
    expect(alertText(null, "en")).toBe("");
    expect(alertText(undefined, "zh")).toBe("");
  });

  it("演示种子的英文预警在中文界面显示中文，英文界面保持原样", () => {
    const cases: Array<[string, string]> = [
      ["Keyword dropped out of top 10", "关键词跌出前 10"],
      ["Keyword ranking dropped", "关键词排名下降"],
      ["Daily rank refresh completed", "每日排名刷新完成"],
      ["Broken internal link detected", "检测到站内死链"],
      ["Health score changed", "健康分变化"],
      ["3 pages missing meta description", "3 个页面缺少 meta 描述"],
      ["'SEO audit tool' moved from #7 to #8 for acme-example.com", "「SEO audit tool」在 acme-example.com 的排名从 #7 变为 #8"],
      ["'schema markup validator' fell from #31 to #34", "「schema markup validator」从 #31 跌至 #34"],
      ["Latest full audit found 5 critical issues on acme-example.com", "最新完整审计在 acme-example.com 发现 5 个严重问题"],
      ["20 keywords refreshed for acme-example.com", "已为 acme-example.com 刷新 20 个关键词"],
      ["acme-example.com health score 74 → 78 after latest audit", "acme-example.com 健康分在最新审计后从 74 变为 78"],
      ["/features/pricing-comparison returns HTTP 404", "/features/pricing-comparison 返回 HTTP 404"]
    ];
    for (const [en, zh] of cases) {
      expect(alertText(en, "zh")).toBe(zh);
      expect(alertText(en, "en")).toBe(en);
    }
  });
});

describe("写入端：排名预警产出双语", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("排名下降预警的 title/detail 同时带 en 与 zh", async () => {
    vi.mocked(getPreviousRankHistory).mockResolvedValueOnce({ position: 4, date: "2026-10-18" } as never);
    await generateRankAlert("user-1", { id: 7, keyword: "seo tools", domain: "example.com" }, 12, "2026-10-19");

    expect(captured.length).toBe(1);
    const a = captured[0];
    expect(a.type).toBe("rank_drop");
    expect(a.title).toEqual({
      en: 'Keyword "seo tools" dropped 8 positions',
      zh: "关键词「seo tools」排名下降 8 位"
    });
    expect(a.detail).toEqual({ en: "Domain example.com · 4 → 12", zh: "域名 example.com · 4 → 12" });
    // 渲染端两个 locale 都不可能出现另一种语言的裸文本
    expect(alertText(a.title as never, "en")).not.toMatch(/[一-鿿]/);
    expect(alertText(a.title as never, "zh")).toMatch(/[一-鿿]/);
  });

  it("掉出前 100 同样双语，且用 alertText 读回后两侧可读", async () => {
    vi.mocked(getPreviousRankHistory).mockResolvedValueOnce({ position: 12, date: "2026-10-18" } as never);
    await generateRankAlert("user-1", { id: 8, keyword: "crm", domain: "example.com" }, null, "2026-10-19");
    const a = captured[0];
    expect(a.level).toBe("error");
    expect(alertText(a.title as never, "en")).toBe('Keyword "crm" fell from #12 out of the top 100');
    expect(alertText(a.detail as never, "zh")).toBe("域名 example.com · 上次排名 12（2026-10-18）");
  });

  it("无历史记录时不产生预警（保持既有判定）", async () => {
    vi.mocked(getPreviousRankHistory).mockResolvedValueOnce(null as never);
    await generateRankAlert("user-1", { id: 9, keyword: "crm", domain: "example.com" }, 5, "2026-10-19");
    expect(captured.length).toBe(0);
  });
});

describe("渲染端不再直接输出 a.title", () => {
  const topbar = readFileSync("src/components/dashboard/Topbar.tsx", "utf8");
  const list = readFileSync("src/components/dashboard/ProjectList.tsx", "utf8");
  const audit = readFileSync("src/lib/audit.ts", "utf8");

  it("铃铛与活动列表都经 alertText 取当前 locale 文本", () => {
    expect(topbar).toContain("{alertText(a.title, locale)}");
    expect(list).toContain("{alertText(a.title, locale)}");
    expect(topbar).not.toMatch(/>a\.title</);
  });

  it("审计预警改用语义化类型，不再受 alerts.title 为 string 的旧约束", () => {
    expect(audit).toContain("alertLText");
    expect(audit).not.toContain("const title = `${domain} 审计完成`;");
  });
});

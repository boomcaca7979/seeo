// ===== BUG-05 回归测试：缓存命中结果的「数据来源」必须常驻，不能只靠 3 秒 Toast =====
// 根因：缓存徽标写在 `result.rank !== null` 分支内部，`rank === null`（未进入前 100 名）分支
// 没有任何徽标；页面唯一的缓存线索是 show(t("cacheHit"))，而 Toast 3000ms 后自动卸载
// → 用户看到数小时前的缓存 fetchedAt 却标着「查询时间」，误以为是刚刚实时查的。
// 修复：标识移进两个分支共用的结果元信息区，按响应真实字段 fromCache 二选一渲染，
// 时间标签同源切换（缓存 → cachedAtLabel），年龄只由 fetchedAt 相减派生（不推算不存在的剩余 TTL）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const CSS_SRC = readFileSync(fileURLToPath(new URL("../../../../globals.css", import.meta.url)), "utf-8");
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));

/** 「有排名 / 未进前 100 名」两个分支体（含各自容器），到共用元信息区注释为止 */
const BRANCHES = PAGE_SRC.slice(
  PAGE_SRC.indexOf("{result.rank === null ? ("),
  PAGE_SRC.indexOf("{/* 数据来源 + 数据时间")
);
/** 共用结果元信息区（来源标识 + 数据时间 + 数据年龄） */
const META = PAGE_SRC.slice(PAGE_SRC.indexOf("{/* 数据来源 + 数据时间"));

describe("BUG-05：排名结果缓存标识常驻", () => {
  it("两个结果分支体内不得各自复制徽标——缓存标识只有共用区一处实现", () => {
    expect(BRANCHES).toContain("{result.rank === null ? (");
    expect(BRANCHES).toContain("#{result.rank}");
    expect(BRANCHES).toContain("{t(\"notInTop100\")}");
    expect(BRANCHES).not.toMatch(/cachedData|badge-/);
    // 单一实现：全页 cachedData 只出现在共用区一次
    expect(PAGE_SRC.match(/t\("cachedData"\)/g)?.length).toBe(1);
  });

  it("共用元信息区按响应 fromCache 二选一渲染来源标识，缓存与实时都有常驻状态", () => {
    expect(META).toMatch(/className=\{result\.fromCache \? "badge-warn" : "badge-good"\}/);
    expect(META).toMatch(/\{result\.fromCache \? t\("cachedData"\) : t\("liveData"\)\}/);
    // 两个徽标类都必须真实存在于样式表，不能写了类名没样式
    expect(CSS_SRC).toMatch(/^\.badge-warn \{/m);
    expect(CSS_SRC).toMatch(/^\.badge-good, \.badge-pos \{/m);
  });

  it("时间标签与来源同源切换：缓存数据不得再显示为「查询时间」", () => {
    expect(META).toMatch(/\{result\.fromCache \? t\("cachedAtLabel"\) : t\("queryTime"\)\}：/);
  });

  it("显示的时间只能取响应真实字段 fetchedAt，禁止用点击时刻或当前时刻冒充数据时间", () => {
    expect(META).toContain("new Date(result.fetchedAt).toLocaleString(locale === \"zh\" ? \"zh-CN\" : \"en-US\")");
    // 渲染期不允许出现「当前时刻当数据时间」的写法（Date.now() 只允许用于年龄差值）
    expect(PAGE_SRC).not.toMatch(/new Date\(\)/);
    expect(PAGE_SRC).toMatch(/function minutesSince\(iso: string\): number \{\s*return Math\.max\(0, Math\.floor\(\(Date\.now\(\) - new Date\(iso\)\.getTime\(\)\) \/ 60000\)\);/);
  });

  it("数据年龄只由 fetchedAt 派生、仅在缓存结果下渲染，且不虚构剩余缓存时长", () => {
    expect(PAGE_SRC).toMatch(/const cachedMinutes = result\?\.fromCache \? minutesSince\(result\.fetchedAt\) : null;/);
    expect(META).toMatch(/\{cachedMinutes !== null && \(/);
    expect(META).toMatch(/cachedMinutes < 60\s*\? t\("cachedAgoMinutes", \{ minutes: cachedMinutes \}\)\s*: t\("cachedAgoHours", \{ hours: Math\.floor\(cachedMinutes \/ 60\) \}\)/);
    // 响应没有 expiresAt / 剩余 TTL 字段，界面不得凭空显示倒计时
    expect(PAGE_SRC).not.toMatch(/expiresAt|剩余|countdown/i);
  });

  it("Toast 保留为辅助反馈，但不再是唯一线索；实时结果仍提示消耗额度", () => {
    expect(PAGE_SRC).toMatch(/if \(json\.data\?\.fromCache\) \{\s*show\(t\("cacheHit"\), "info"\);\s*\} else \{\s*show\(t\("queryDone"\), "success"\);\s*\}/);
  });

  it("请求失败不进入结果分支：发起前先清空 result/error，失败只 setError，不会显示成缓存或未进前 100", () => {
    const handler = PAGE_SRC.slice(PAGE_SRC.indexOf("const handleCheck = async"), PAGE_SRC.indexOf("return ("));
    const clearResult = handler.indexOf("setResult(null)");
    expect(clearResult).toBeGreaterThan(-1);
    expect(clearResult).toBeLessThan(handler.indexOf("await fetch"));
    expect(handler).toMatch(/if \(!res\.ok\) \{[\s\S]*?setError\(message\);[\s\S]*?return;/);
    expect(handler).toMatch(/catch \(err\) \{[\s\S]*?setError\(msg\);/);
    // 渲染顺序：loading → error → result，错误优先于结果
    const order = ["loading ?", "error ?", "result ?"].map((s) => PAGE_SRC.indexOf(s));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("来源与年龄文案 en/zh 双语齐备，英文用 ICU 复数", () => {
    for (const key of ["cachedData", "liveData", "cachedAtLabel", "cachedAgoMinutes", "cachedAgoHours", "queryTime", "notInTop100", "cacheHit", "queryDone"]) {
      expect(typeof EN.dashboard.rankCheck[key], `en.${key}`).toBe("string");
      expect(EN.dashboard.rankCheck[key].length, `en.${key} 非空`).toBeGreaterThan(0);
      expect(typeof ZH.dashboard.rankCheck[key], `zh.${key}`).toBe("string");
      expect(ZH.dashboard.rankCheck[key].length, `zh.${key} 非空`).toBeGreaterThan(0);
    }
    expect(EN.dashboard.rankCheck.cachedAgoMinutes).toContain("plural");
    expect(EN.dashboard.rankCheck.cachedAgoHours).toContain("plural");
    expect(EN.dashboard.rankCheck.cachedAgoHours).not.toBe(EN.dashboard.rankCheck.cachedAgoMinutes);
    // 缓存标签与实时标签必须是不同文案，不能共用一个中性词
    expect(EN.dashboard.rankCheck.cachedData).not.toBe(EN.dashboard.rankCheck.liveData);
    expect(ZH.dashboard.rankCheck.cachedData).not.toBe(ZH.dashboard.rankCheck.liveData);
  });
});

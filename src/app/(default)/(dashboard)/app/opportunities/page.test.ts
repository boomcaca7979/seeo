// ===== BUG-41：Opportunities 页语言与错误出口回归 =====
// 实测缺陷：英文界面下 /app/opportunities 的 toast 与执行失败提示直接吐中文
// （硬编码中文串 + 服务端 error 原文 + 页内中文 ERROR_FRIENDLY 表）。
// 约定（与仓库其余 Dashboard 页一致）：用户可见文案只走 messages 命名空间，
// 接口失败只走 code → apiErrors catalog（EN/ZH），未知 code 落本地化兜底。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import EN_MESSAGES from "../../../../../../messages/en.json";
import ZH_MESSAGES from "../../../../../../messages/zh.json";

const PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");
// 该命名空间含嵌套对象（stage / opStatus / opType），只按 string 键读取本页用到的项
const EN_OPP = EN_MESSAGES.dashboard.opportunities as unknown as Record<string, string>;
const ZH_OPP = ZH_MESSAGES.dashboard.opportunities as unknown as Record<string, string>;
const EN_API = EN_MESSAGES.apiErrors as Record<string, string>;
const ZH_API = ZH_MESSAGES.apiErrors as Record<string, string>;

/** 页面里所有 t("key") 引用 */
function usedKeys(): string[] {
  return [...PAGE_SRC.matchAll(/\bt\("([A-Za-z]+)"/g)].map((m) => m[1]);
}

describe("BUG-41：无硬编码用户可见文案", () => {
  it("show(...) 参数不含中文字面量", () => {
    const bad = [...PAGE_SRC.matchAll(/show\(\s*(["'`])([^]*?)\1\s*\)/g)]
      .map((m) => m[2])
      .filter((arg) => /[一-龥]/.test(arg));
    expect(bad).toEqual([]);
  });

  it("页内不再有中文 ERROR_FRIENDLY 表，也不回显 json.error 原文到 toast", () => {
    expect(PAGE_SRC).not.toContain("ERROR_FRIENDLY");
    // load 之外的 throw 站点必须经 friendlyError（按 code 解析），不得 new Error(json.error)
    const rawThrows = [...PAGE_SRC.matchAll(/throw new Error\(([^)]*)\)/g)]
      .map((m) => m[1])
      .filter((arg) => /json\.error|action\.result\?\.error/.test(arg) && !arg.includes("friendlyError"));
    expect(rawThrows).toEqual([]);
  });

  it("失败详情区不再渲染 action.result.error 原文", () => {
    expect(PAGE_SRC).not.toContain("action.result?.error ?? ");
  });
});

describe("BUG-41：文案单一来源与双语完整", () => {
  it("页面引用的每个 key 在 EN/ZH 均存在", () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(20);
    const missing: string[] = [];
    for (const k of keys) {
      if (!EN_OPP[k]) missing.push(`EN ${k}`);
      if (!ZH_OPP[k]) missing.push(`ZH ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("新增 toast key 双语齐备且非空", () => {
    for (const k of [
      "scanDone",
      "scanDoneWithGaps",
      "githubConnected",
      "githubDisconnected",
      "githubStatusFailed",
      "prCreated",
      "stageAwaitingReview",
      "stageMerged",
      "stageClosed",
      "stageNone",
      "actionApproved",
      "manualCompleted",
      "loadFailed",
      "scanFailed",
      "verifyFailed",
      "verifyDone",
      "previewFailed",
      "requestFailed",
      "execFailed",
    ]) {
      expect(EN_OPP[k], `EN ${k}`).toBeTruthy();
      expect(ZH_OPP[k], `ZH ${k}`).toBeTruthy();
    }
  });

  it("扫描结果摘要按缺口分支，且两种模板都插值 generated/refreshed", () => {
    expect(PAGE_SRC).toContain('t("scanDoneWithGaps"');
    expect(PAGE_SRC).toContain('t("scanDone"');
    for (const tpl of [EN_OPP.scanDone, ZH_OPP.scanDone, EN_OPP.scanDoneWithGaps, ZH_OPP.scanDoneWithGaps]) {
      expect(tpl).toContain("{generated}");
      expect(tpl).toContain("{refreshed}");
    }
    expect(EN_OPP.scanDoneWithGaps).toContain("{gaps}");
    expect(ZH_OPP.scanDoneWithGaps).toContain("{gaps}");
    expect(EN_OPP.scanDone).not.toContain("{gaps}");
  });

  it("执行链路 code 在 apiErrors catalog 中双语齐备（friendlyError 的解析来源）", () => {
    for (const code of [
      "EXECUTION_CONFLICT",
      "EXECUTION_NOT_SUPPORTED",
      "EXECUTION_NOT_APPROVED",
      "EXECUTION_INVALID_STATE",
      "EXECUTION_ADAPTER_ERROR",
      "EXECUTION_TARGET_NOT_FOUND",
      "GITHUB_PERMISSION_DENIED",
      "GITHUB_NOT_CONNECTED",
    ]) {
      expect(EN_API[code], `EN ${code}`).toBeTruthy();
      expect(ZH_API[code], `ZH ${code}`).toBeTruthy();
    }
  });
});

describe("BUG-41：错误解析走共享机制", () => {
  it("复用 billing-error-client 的 resolveApiErrorMessage + readUiLocale", () => {
    expect(PAGE_SRC).toContain('import { resolveApiErrorMessage, readUiLocale } from "@/lib/billing-error-client";');
    expect(PAGE_SRC).toMatch(/function friendlyError\(code: string \| undefined, fallback: string\): string/);
    // 只传 code：避免把上游中文原文带进 UI
    expect(PAGE_SRC).toContain("resolveApiErrorMessage(code ? { code } : {}, readUiLocale(), fallback)");
  });

  it("GitHub 连接状态失败改为布尔态 + 本地化渲染", () => {
    expect(PAGE_SRC).toContain("useState(false)");
    expect(PAGE_SRC).toContain("{t(\"githubStatusFailed\")}");
    expect(PAGE_SRC).not.toMatch(/setGithubError\(" /);
  });
});

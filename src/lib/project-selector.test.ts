// ===== 项目选择器共享逻辑测试（client-safe 部分）=====
// P1-3：项目 id 统一 string（鉴权模式 Supabase UUID / 演示模式 SQLite 整数）。
// 覆盖：localStorage 旧值安全 fallback、事件契约常量、消费方无重复定义。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UUID_A = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";
const UUID_B = "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
const UUID_C = "aaaa1111-bbbb-2222-cccc-3333dddd4444";

import { SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT, validStoredProjectId } from "@/lib/project-selector";

const SRC = {
  topbar: readFileSync(fileURLToPath(new URL("../components/dashboard/Topbar.tsx", import.meta.url)), "utf-8"),
  competitors: readFileSync(fileURLToPath(new URL("../app/(default)/(dashboard)/app/competitors/page.tsx", import.meta.url)), "utf-8"),
};

describe("共享常量（Topbar 与 competitors 使用同一契约）", () => {
  it("localStorage key 与事件名稳定", () => {
    expect(SELECTED_PROJECT_KEY).toBe("seeo:selected-project-id");
    expect(PROJECT_CHANGED_EVENT).toBe("seeo:project-changed");
  });

  it("两个消费方文件均从共享模块导入（无重复定义）", () => {
    for (const src of [SRC.topbar, SRC.competitors]) {
      expect(src).toContain("SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT");
      expect(src).not.toMatch(/const SELECTED_PROJECT_KEY/);
      expect(src).not.toMatch(/const PROJECT_CHANGED_EVENT/);
    }
  });
});

describe("Topbar 项目 id 全链路 string（防回归）", () => {
  it("selectedId 状态为 string，无 Number() 转换残留", () => {
    expect(SRC.topbar).toContain("useState<string | null>(null)");
    expect(SRC.topbar).not.toContain("Number(stored)");
    expect(SRC.topbar).not.toContain("handleSelectProject = (id: number)");
  });

  it("localStorage 直接存取 string UUID（setItem 原样写入）", () => {
    expect(SRC.topbar).toContain("localStorage.setItem(SELECTED_PROJECT_KEY, id)");
    expect(SRC.topbar).not.toContain("String(list[0].id)"); // 不再需要 String() 包装
  });

  it("事件 payload 为 string：CustomEvent detail id 与选中态比较均为 string", () => {
    expect(SRC.topbar).toMatch(/CustomEvent\(PROJECT_CHANGED_EVENT, \{ detail: \{ id \} \}\)/);
  });

  it("恢复逻辑使用 validStoredProjectId 校验（旧值 fallback 第一个项目）", () => {
    expect(SRC.topbar).toContain("validStoredProjectId(stored, list.map((p) => p.id))");
  });
});

describe("competitors 页项目 id 全链路 string（防回归）", () => {
  it("projectId state 为 string，无 Number()/parseInt()/isInteger 残留", () => {
    expect(SRC.competitors).toContain("useState<string | null>(null)");
    expect(SRC.competitors).not.toContain("Number(stored)");
    expect(SRC.competitors).not.toContain("Number.isInteger(detail.id)");
    expect(SRC.competitors).not.toMatch(/parseInt\(/);
  });

  it("事件监听按 string 校验 payload（typeof detail.id === 'string'）", () => {
    expect(SRC.competitors).toContain('typeof detail.id === "string"');
  });

  it("domain 匹配使用 string 比较（p.id === projectId）", () => {
    expect(SRC.competitors).toContain('(p: { id: string; domain: string }) => p.id === projectId');
  });
});

describe("audit 页项目 id string 化（防回归）", () => {
  it("ProjectItem.id 为 string（供 position-tracking 链接拼 UUID）", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/(default)/(dashboard)/app/audit/page.tsx", import.meta.url)), "utf-8");
    expect(src).toMatch(/interface ProjectItem \{[\s\S]*?id: string;/);
  });
});

describe("validStoredProjectId（localStorage 恢复 + 旧值安全 fallback）", () => {
  it("合法 UUID 通过", () => {
    expect(validStoredProjectId(UUID_B, [UUID_A, UUID_B, UUID_C])).toBe(UUID_B);
  });

  it("旧版本遗留数字 id（'0'/'123'）在 UUID 体系下不匹配 → null（fallback 第一个项目，无 NaN）", () => {
    expect(validStoredProjectId("0", [UUID_A, UUID_B])).toBeNull();
    expect(validStoredProjectId("123", [UUID_A, UUID_B])).toBeNull();
  });

  it("已删除项目 / 跨账号残留 id → null", () => {
    expect(validStoredProjectId("deadbeef-0000-0000-0000-000000000000", [UUID_A, UUID_B])).toBeNull();
  });

  it("空值与空列表 → null", () => {
    expect(validStoredProjectId(null, [UUID_A])).toBeNull();
    expect(validStoredProjectId("", [UUID_A])).toBeNull();
    expect(validStoredProjectId(UUID_A, [])).toBeNull();
  });

  it("演示模式：SQLite 整数 id（string 形式）在列表内时通过", () => {
    expect(validStoredProjectId("3", ["1", "2", "3"])).toBe("3");
  });
});

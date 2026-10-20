// ===== 项目选择器共享逻辑测试（client-safe 部分）=====
// P1-3：项目 id 统一 string（鉴权模式 Supabase UUID / 演示模式 SQLite 整数）。
// 覆盖：localStorage 旧值安全 fallback、事件契约常量、消费方无重复定义。

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UUID_A = "7f9c24e8-3b21-4c5a-9d0e-6a8b1c2d3e4f";
const UUID_B = "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
const UUID_C = "aaaa1111-bbbb-2222-cccc-3333dddd4444";

import {
  SELECTED_PROJECT_KEY,
  PROJECT_CHANGED_EVENT,
  projectChangedDetail,
  validStoredProjectId,
  setActiveProject,
} from "@/lib/project-selector";

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
      expect(src).toMatch(/import \{[^}]*SELECTED_PROJECT_KEY[^}]*PROJECT_CHANGED_EVENT[^}]*\} from "@\/lib\/project-selector"/);
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

  it("事件 payload 为 string：Topbar 用户切换与挂载广播分别标注 source", () => {
    expect(SRC.topbar).toMatch(/CustomEvent\(PROJECT_CHANGED_EVENT, \{ detail: \{ id, source: "user" as const \} \}\)/);
    expect(SRC.topbar).toMatch(/detail: \{ id: initialId, source: "init" as const \}/);
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

describe("setActiveProject（项目上下文写入的唯一共享路径）", () => {
  const events: Array<{ type: string; detail: unknown }> = [];

  function stubWindow(localStorageAvailable = true) {
    const store = new Map<string, string>();
    const win = {
      localStorage: {
        setItem: (k: string, v: string) => {
          if (!localStorageAvailable) throw new Error("SecurityError");
          store.set(k, v);
        },
        getItem: (k: string) => store.get(k) ?? null,
      },
      dispatchEvent: (e: Event) => {
        events.push({ type: e.type, detail: (e as CustomEvent).detail });
        return true;
      },
    };
    vi.stubGlobal("window", win);
    return { store };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    events.length = 0;
  });

  it("默认按 context 派发：页面写回自身上下文不应被当成用户切换", () => {
    const { store } = stubWindow();
    setActiveProject(UUID_A);
    expect(store.get(SELECTED_PROJECT_KEY)).toBe(UUID_A);
    expect(events).toEqual([{ type: PROJECT_CHANGED_EVENT, detail: { id: UUID_A, source: "context" } }]);
  });

  it("id 保持 string：UUID 不被数值化", () => {
    stubWindow();
    setActiveProject(UUID_A);
    expect(events[0].detail).toEqual({ id: UUID_A, source: "context" });
  });

  it("显式 source 原样带上（Topbar 等入口可标注 user）", () => {
    stubWindow();
    setActiveProject(UUID_B, "user");
    expect(events[0].detail).toEqual({ id: UUID_B, source: "user" });
  });

  it("演示模式整数 id（string）同样原样写入", () => {
    const { store } = stubWindow();
    setActiveProject("17");
    expect(store.get(SELECTED_PROJECT_KEY)).toBe("17");
  });

  it("空 id 不写入也不派发（避免把活跃项目清成无意义值）", () => {
    const { store } = stubWindow();
    setActiveProject("");
    expect(store.size).toBe(0);
    expect(events).toEqual([]);
  });

  it("localStorage 不可用（隐私模式）仍派发事件，同 tab 本次会话保持一致", () => {
    stubWindow(false);
    setActiveProject(UUID_B);
    expect(events).toEqual([{ type: PROJECT_CHANGED_EVENT, detail: { id: UUID_B, source: "context" } }]);
  });

  it("服务端渲染（无 window）静默跳过，不抛错", () => {
    vi.stubGlobal("window", undefined);
    expect(() => setActiveProject(UUID_A)).not.toThrow();
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

describe("位置追踪范围切换守卫（防事件回环 + 防误吞「全部项目」）", () => {
  const PT = readFileSync(
    fileURLToPath(new URL("../app/(default)/(dashboard)/app/position-tracking/page.tsx", import.meta.url)),
    "utf-8",
  );

  it("待应用范围用对象包装：null（全部项目）不当作「无待应用」哨兵", () => {
    expect(PT).toContain("useRef<{ domain: string | null } | null>(null)");
    expect(PT).toContain("pendingScopeRef.current = { domain: next };");
    // 回归：直接比较 null 会让首次「切回全部项目」被误判为重复而静默失效
    expect(PT).not.toMatch(/next === pendingScopeRef\.current\b/);
  });

  it("回环守卫保留：先比 scopeDomain，再比 pending，然后才改写 URL", () => {
    expect(PT).toMatch(
      /if \(next === scopeDomain \|\| pendingScopeRef\.current\?\.domain === next\) return;/,
    );
  });

  it("URL 追上后清空待应用哨兵（防「后退再点同一项目」被静默吞掉）", () => {
    expect(PT).toMatch(
      /if \(pendingScopeRef\.current\?\.domain === scopeDomain\) pendingScopeRef\.current = null;/,
    );
  });

  it("只有 source === \"user\" 的事件才改变页面范围（不再靠首个事件猜基线）", () => {
    expect(PT).toMatch(/if \(detail\.source === "user"\) \{/);
    expect(PT).toMatch(/if \(hit\) applyScope\(hit\.domain\);/);
    expect(PT).not.toMatch(/projectEventSeen/);
  });

  it("URL 域名唯一命中真实项目才写回上下文；手动域名与重复域名都不写", () => {
    expect(PT).toMatch(/const hits = projects\.filter\(\(p\) => p\.domain === scopeDomain\);/);
    expect(PT).toMatch(/return hits\.length === 1 \? hits\[0\] : null;/);
    expect(PT).toMatch(/if \(force \|\| stored !== hit\.id\) setActiveProject\(hit\.id\);/);
  });

  it("Topbar 迟到的 init 与 URL 范围不一致时强制回写（防 chip 停在旧项目）", () => {
    expect(PT).toMatch(/if \(detail\.source === "init"\) \{/);
    expect(PT).toMatch(
      /if \(hit && scopeDomain && hit\.domain !== scopeDomain\) alignContextToUrl\(true\);/,
    );
  });
});

describe("projectChangedDetail（事件 payload 统一校验）", () => {
  const fire = (detail: unknown) =>
    projectChangedDetail(new CustomEvent(PROJECT_CHANGED_EVENT, { detail }));

  it("合法 id + source 原样读出", () => {
    expect(fire({ id: UUID_A, source: "user" })).toEqual({ id: UUID_A, source: "user" });
  });

  it("老 payload（只有 id）仍可用：source 为 undefined", () => {
    expect(fire({ id: UUID_A })).toEqual({ id: UUID_A, source: undefined });
  });

  it("缺失 / 非 string / 空 id → null（绝不 Number() 兜底）", () => {
    expect(fire(undefined)).toBeNull();
    expect(fire({})).toBeNull();
    expect(fire({ id: "" })).toBeNull();
    expect(fire({ id: 17 })).toBeNull();
  });
});

// ===== Navbar 首轮渲染契约（首页 hydration error #418）=====
// Navbar 是 client 组件，服务端 markup 与**首轮**客户端渲染必须逐字节同源。
// 上一轮的失败形态：为绕开 locale 差异，用 useSyncExternalStore 在客户端读
// window.location，服务端快照给 null → 首轮必然改用浏览器路径，两份 markup
// 不可能相同（React #418 args[]=text）；同时 EN 预渲染文档的语言判定为 /en/*
// 时切不出「参与 locale 路由」，SSR HTML 连语言切换链接都没有。
// 契约：路径只从 usePathname() 经 stripLocalePrefix 归一，全程不读浏览器地址。
//
// Navbar 依赖 next-intl / Supabase 浏览器客户端，node 环境无法渲染，
// 因此按本仓库既有做法（见 ProjectActionLinks / Footer 契约测试）断言源码形态，
// 真正的渲染结果由隔离生产构建里的真实浏览器验收。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./Navbar.tsx", import.meta.url)), "utf-8");

// 断言只看代码形态，不看注释：文件里的说明文字会点名被禁的写法（useSyncExternalStore、
// window.location），把它们一起匹配上就等于「因为解释了 bug 所以 bug 测试失败」。
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("路径来源：只用服务端也能确定的逻辑路径", () => {
  it("路径唯一来源是 stripLocalePrefix(usePathname())", () => {
    expect(code).toContain("stripLocalePrefix(usePathname())");
  });

  it("不再用 useSyncExternalStore 读浏览器地址（#418 的直接来源）", () => {
    expect(code).not.toContain("useSyncExternalStore");
    expect(code).not.toMatch(/window\.location\.(pathname|href)/);
    expect(code).not.toContain("document.location");
  });

  it("一切路径判定都走归一后的 appPath，没有残留的浏览器/内部路径变量", () => {
    expect(code).toContain('const isHome = appPath === "/"');
    expect(code).toContain("isLocaleRoutedPath(appPath)");
    expect(code).toContain("localeSwitchHref(otherLocale, appPath)");
    expect(code).toContain("item.routed && appPath === item.href");
    expect(code).not.toMatch(/\beffectivePath\b|\bbrowserPath\b/);
  });

  it("桌面与移动两份导航用同一条 active 判据（不能一份用 appPath 一份用原路径）", () => {
    expect(code.match(/item\.routed && appPath === item\.href/g)?.length).toBe(2);
  });

  it("不用 suppressHydrationWarning 掩盖不一致", () => {
    expect(code).not.toContain("suppressHydrationWarning");
  });
});

describe("语言切换行为保留（上一轮修复的 cookie + 整份文档导航契约）", () => {
  it("先写 NEXT_LOCALE cookie，再整份文档导航（客户端 router 切换会留下重复 head）", () => {
    expect(code).toContain("document.cookie = localeSwitchCookie(otherLocale)");
    expect(code).toContain("window.location.assign(switchHref)");
    expect(code).toContain("e.preventDefault()");
  });

  it("不引入 locale 的客户端 router.push（那会追加第二份 description/canonical/og:locale）", () => {
    expect(code).not.toMatch(/router\.push\(/);
    expect(code).not.toContain("useRouter");
  });

  it("href 保留：右键新标签与 JS 未接管时走同一个服务端渲染地址", () => {
    expect(code).toContain("href={switchHref}");
  });

  it("切换按钮只由 locale 路由白名单决定，不被挂载态/异步状态延迟或隐藏", () => {
    expect(code).toContain("const showLangSwitch = isLocaleRoutedPath(appPath)");
    expect(code.match(/\{showLangSwitch && \(/g)?.length).toBe(2);
    const switchBlocks = code.split("{showLangSwitch && (").slice(1);
    for (const block of switchBlocks) {
      expect(block.split("</Link>")[0]).not.toMatch(/authState|mobileOpen|mounted/);
    }
  });

  it("otherLocale 由 useLocale() 的服务端结果推导，不读 navigator.language", () => {
    expect(code).toContain('const locale = useLocale()');
    expect(code).toContain('const otherLocale = locale === "zh" ? "en" : "zh"');
    expect(code).not.toContain("navigator.language");
  });
});

describe("认证态 CTA（本次修复不得动到的既有行为）", () => {
  it("loading 时不渲染「登录」，避免已登录用户看到误导性入口", () => {
    expect(code).toContain('const showLogin = isAuthEnabled && authState === "anon"');
    expect(code).toContain('const ctaHref = authState === "authed" ? "/app" : primaryHref');
  });

  it("演示模式 CTA 直进 /app，启用模式进 /signup", () => {
    expect(code).toContain('const primaryHref = isAuthEnabled ? "/signup" : "/app"');
  });
});

// ===== 登录转场回归测试（2026-10-21）=====
//
// 用户实测：点 Login 后按钮约 2 秒变回可点击，页面约 10 秒后才进后台。
// 根因（源码可证）：`signInWithPassword` 一返回就 `setLoading(false)`，随后才
// `router.push`；而 Next 在目标 RSC 就绪前不会换掉当前页面，整个 /app 首屏加载期间
// 登录页一直挂在屏幕上 —— 于是按钮在「后台仍在加载」时恢复可点击，用户以为登录失败。
//
// 本文件钉住新的转场契约：阶段互斥、按钮不被提前点亮、防重复是同步闸门、
// 结束条件是卸载或失败（不是计时器）、失败仍可重试、中英文案齐备。
//
// 范围说明：本仓 vitest 是 node 环境且未安装 DOM 测试依赖，因此这里是
// **源码结构契约**（语句顺序 + 互斥分支），不是组件渲染测试。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("./AuthForm.tsx", import.meta.url)), "utf-8");

/** 只保留可执行代码：去掉 JSX 注释与整行注释（注释里也会写到状态名，不能计入断言） */
const CODE = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

/** handleSubmit 的函数体（到下一个顶层 `};` 为止） */
const SUBMIT = SRC.slice(
  SRC.indexOf("const handleSubmit = async"),
  SRC.indexOf("const handleSubmit = async") + SRC.slice(SRC.indexOf("const handleSubmit = async")).indexOf("\n  };\n")
);

const EN = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../messages/en.json", import.meta.url)), "utf-8")
) as { dashboard: { authForm: Record<string, string> } };
const ZH = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8")
) as { dashboard: { authForm: Record<string, string> } };

describe("点击立即反馈", () => {
  it("提交后立刻进入 verifying：setPhase 出现在第一个 await 之前", () => {
    const setIdx = SUBMIT.indexOf('setPhase("verifying")');
    const firstAwait = SUBMIT.indexOf("await ");
    expect(setIdx).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(setIdx).toBeLessThan(firstAwait);
  });

  it("按钮不可点击由 phase 决定，不再由「认证请求是否返回」决定", () => {
    expect(CODE).toContain('disabled={phase !== "idle"}');
    expect(CODE).toContain('aria-busy={phase !== "idle"}');
    // 旧的单一 loading 布尔不能复活：它是「认证结束即恢复」这个 bug 的载体
    expect(CODE).not.toMatch(/setLoading\(/);
    expect(CODE).not.toContain("disabled={loading}");
  });
});

describe("导航阶段连续反馈", () => {
  it("认证成功 → router.push 之间不得把状态退回 idle，也不得解除闸门", () => {
    const okIdx = SUBMIT.indexOf('track("login_completed")');
    const pushIdx = SUBMIT.indexOf("router.push(safeRedirect)", okIdx);
    expect(okIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(okIdx);
    const between = SUBMIT.slice(okIdx, pushIdx);
    expect(between).toContain("enterOpening();");
    expect(between).not.toContain('setPhase("idle")');
    expect(between).not.toContain("inFlight.current = false");
  });

  it("注册路径同源：成功后同样进入 opening 再跳转", () => {
    const signupIdx = SUBMIT.indexOf('track("signup_completed")');
    const pushIdx = SUBMIT.indexOf("router.push(safeRedirect)", signupIdx);
    expect(signupIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(signupIdx);
    const between = SUBMIT.slice(signupIdx, pushIdx);
    expect(between).toContain("enterOpening();");
    expect(between).not.toContain('setPhase("idle")');
  });

  it("结束条件是登录页卸载 + 失败分支，不是固定时长", () => {
    // 卸载清理：计时器不得留在已卸载的组件上（成功跳转正是这条路径）
    expect(SRC).toMatch(
      /useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]{0,300}?clearTimeout\(slowTimer\.current\)[\s\S]{0,200}?clearTimeout\(stallTimer\.current\)/
    );
    // 只有「未进入导航」的失败分支才回 idle
    const finallyIdx = SRC.indexOf("} finally {");
    expect(finallyIdx).toBeGreaterThan(-1);
    const tail = SRC.slice(finallyIdx, SRC.indexOf("\n  };", finallyIdx));
    expect(tail).toContain("if (!navigating)");
    expect(tail).toContain('setPhase("idle")');
    expect(tail).toContain("inFlight.current = false;");
    // 成功路径不发任何「假设加载完成」的计时器
    expect(SUBMIT).not.toMatch(/setTimeout\([^)]*setPhase\("idle"\)/);
  });
});

describe("导航不付第二遍首屏成本", () => {
  const APP_PAGE = readFileSync(
    fileURLToPath(new URL("../../app/(default)/(dashboard)/app/page.tsx", import.meta.url)),
    "utf-8"
  );

  it("成功路径只用 router.push 导航，不再跟 router.refresh()", () => {
    // Next 16 的 action queue 把非导航动作排到正在进行的导航之后执行
    // （app-router-instance.js → dispatchAction），push 后紧跟 refresh 等于在用户
    // 已看到工作台之后再整页重算一次 /app —— 每次登录付两遍 proxy + 会话 + 项目 + 队列。
    // 断言只看可执行代码：注释里会解释「为什么不要 refresh」，不能把注释算成调用
    expect(CODE).not.toContain("router.refresh()");
    // 登录与注册两条成功路径都各自导航一次，没有重复导航
    expect(SUBMIT.match(/router\.push\(safeRedirect\)/g)?.length).toBe(2);
  });

  it("去掉 refresh 的前提仍然成立：/app 必须是动态渲染（可缓存则必须重新评估）", () => {
    expect(APP_PAGE).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("防重复提交", () => {
  it("同步闸门在任何 await 之前 return（disabled 挡不住同一 tick 的重复触发）", () => {
    const guardIdx = SUBMIT.indexOf("if (inFlight.current) return;");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(SUBMIT.indexOf("await "));
    expect(SUBMIT).toContain("inFlight.current = true;");
    // 闸门是 ref 而不是 state：state 更新是异步的，第二次触发会读到旧值
    expect(SRC).toContain("const inFlight = useRef(false);");
  });

  it("失败分支一定解除闸门，不会一次失败就永久锁死", () => {
    expect(SUBMIT).toContain("inFlight.current = false;");
    expect(SUBMIT).toContain("clearWaitTimers();");
  });
});

describe("慢加载与异常久的提示", () => {
  it("慢加载阈值落在 4–5 秒区间，且从点击起算（阶段切换不重新计时）", () => {
    const m = SRC.match(/const SLOW_HINT_MS = (\d+);/);
    expect(m).toBeTruthy();
    const ms = Number(m![1]);
    expect(ms).toBeGreaterThanOrEqual(4000);
    expect(ms).toBeLessThanOrEqual(5000);
    // 计时器只在 startWaiting 里起一次；enterOpening 不得重启它
    const openingBody = SRC.slice(SRC.indexOf("const enterOpening = () => {"));
    const openingFn = openingBody.slice(0, openingBody.indexOf("};"));
    expect(openingFn).not.toContain("SLOW_HINT_MS");
  });

  it("异常久的恢复方式是刷新页面，绝不重新启用 Login", () => {
    const m = SRC.match(/const STALL_RECOVERY_MS = (\d+);/);
    expect(m).toBeTruthy();
    const slowMs = Number(SRC.match(/const SLOW_HINT_MS = (\d+);/)![1]);
    expect(Number(m![1])).toBeGreaterThan(slowMs);
    expect(CODE).toContain("window.location.reload()");
    // 恢复入口是 type="button"，不是 submit：它不经过 handleSubmit，不会重复认证
    const stallIdx = CODE.indexOf("{stalled && (");
    expect(stallIdx).toBeGreaterThan(-1);
    const stallBlock = CODE.slice(stallIdx, CODE.indexOf("</div>", stallIdx));
    expect(stallBlock).toContain('type="button"');
    expect(stallBlock).not.toContain('setPhase("idle")');
  });

  it("提示区常驻且用 role=status；不伪造进度、不新增第二份朗读来源", () => {
    expect(CODE).toContain('id="auth-progress"');
    expect(CODE).toContain("{slow && (");
    expect(CODE).toContain("{stalled && (");
    // 进度条 / 百分比 / 预计完成时间一律不出现
    expect(CODE).not.toMatch(/progressbar|%|estimated/i);
    // 本仓既有约定：可见文本即朗读来源，不写 aria-live、不塞 sr-only 副本
    expect(CODE).not.toContain("aria-live");
    expect(CODE).not.toContain("sr-only");
    // 三个 status 区域：按钮文案、等待说明、上游不可用提示
    expect(CODE.match(/role="status"/g)?.length).toBe(3);
  });
});

describe("失败仍然可恢复", () => {
  it("凭据错误 / 服务级错误仍走既有本地化文案与 role=alert", () => {
    expect(CODE).toContain('role="alert"');
    expect(CODE).toContain('t("errInvalidCredentials")');
    expect(CODE).toContain('t("errServiceUnavailable")');
    expect(CODE).toContain("isServiceLevelAuthFailure(signInError)");
  });

  it("错误分支直接 return，由 finally 统一收尾（不吞错、不停在转圈）", () => {
    const errIdx = SUBMIT.indexOf("if (signInError) {");
    expect(errIdx).toBeGreaterThan(-1);
    const errBlock = SUBMIT.slice(errIdx, SUBMIT.indexOf("// 认证成功 ≠ 已进入后台"));
    expect(errBlock).toContain("setError(");
    expect(errBlock).toContain("return;");
    expect(errBlock).not.toContain("inFlight.current = false");
  });
});

describe("中英文状态文案", () => {
  const keys = ["loginVerifying", "signupVerifying", "opening", "slowHint", "stallNotice", "stallAction"];

  it("六个状态键在两种语言中都存在且非空", () => {
    for (const key of keys) {
      expect(typeof EN.dashboard.authForm[key], `en.${key}`).toBe("string");
      expect(typeof ZH.dashboard.authForm[key], `zh.${key}`).toBe("string");
      expect(EN.dashboard.authForm[key].length, `en.${key}`).toBeGreaterThan(0);
      expect(ZH.dashboard.authForm[key].length, `zh.${key}`).toBeGreaterThan(0);
    }
  });

  it("语义一致：验证阶段 / 进入工作区 / 不要重复点击", () => {
    expect(EN.dashboard.authForm.loginVerifying).toMatch(/signing in/i);
    expect(ZH.dashboard.authForm.loginVerifying).toContain("正在验证");
    expect(EN.dashboard.authForm.opening).toMatch(/opening workspace/i);
    expect(ZH.dashboard.authForm.opening).toContain("正在进入工作区");
    expect(EN.dashboard.authForm.slowHint).toMatch(/don't click again/i);
    expect(ZH.dashboard.authForm.slowHint).toContain("不要重复点击");
    // 异常久的提示必须说明「登录已成功」，否则用户会去重试密码
    expect(EN.dashboard.authForm.stallNotice).toMatch(/already succeeded/i);
    expect(ZH.dashboard.authForm.stallNotice).toContain("登录已经成功");
  });

  it("按钮文案按阶段取键，中英走同一套键（不存在只修一种语言）", () => {
    expect(CODE).toContain('t("loginVerifying")');
    expect(CODE).toContain('t("signupVerifying")');
    expect(CODE).toContain('t("opening")');
    expect(CODE).toContain('t("slowHint")');
    expect(CODE).toContain('t("stallAction")');
    // 旧的单一「处理中…」不再是按钮文案来源，键也随之移除（避免死文案）
    expect(EN.dashboard.authForm.processing).toBeUndefined();
    expect(ZH.dashboard.authForm.processing).toBeUndefined();
  });
});

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { track } from "@/lib/analytics/client";
import { useToast } from "@/components/dashboard/Toast";
import { startGuestAuditClaim } from "@/components/auth/claim-guest-audits";
import { safeRedirectTarget } from "@/lib/auth-redirect";
import {
  fieldErrorFor,
  formLevelError,
  isServiceLevelAuthFailure,
  validateAuthCredentials,
  type AuthField,
  type AuthFormError,
} from "@/lib/auth-form-validation";

interface AuthFormProps {
  mode: "login" | "signup";
}

/**
 * 登录转场的三个阶段（2026-10-21 登录体验修复）。
 *
 * 为什么必须分阶段：`signInWithPassword` 返回成功只说明**认证**完成，用户此刻
 * 还没进入工作台。/app 的首屏要经 proxy 会话校验、layout 身份读取、项目/指标/
 * 队列查询才产出，这段时间里 Next 不会换掉当前页面——登录页仍在屏幕上。
 * 旧实现在 auth 返回后立刻把 loading 置回 false，于是按钮在后台仍加载时恢复成可点击
 * （用户实测约 2 秒后复原），再等约 10 秒才跳转；新用户会以为登录没生效而重复点击。
 *
 * 现在的边界：
 *   - verifying：提交后立刻进入，直到 auth 返回；
 *   - opening：auth 成功、router.push 已发出，只有「登录页卸载」才算真正结束；
 *   - idle：仅由「可处理的失败」回到这里，让用户还能改密码重试。
 * 刻意不用固定时长假装加载完成：成功路径的结束条件是页面卸载，不是计时器。
 */
type AuthPhase = "idle" | "verifying" | "opening";

/** 等待提示阈值：从点击起算，认证阶段与跳转阶段共用同一个计时，不按阶段重新计时 */
const SLOW_HINT_MS = 4500;

/**
 * 异常久阈值：认证已成功、工作区却仍未出现时，提供一个安全恢复入口（刷新页面）。
 * 绝不在此重新启用 Login —— 原跳转可能仍在执行，重新启用只会制造重复请求与状态竞争。
 */
const STALL_RECOVERY_MS = 20000;

export default function AuthForm({ mode }: AuthFormProps) {
  const t = useTranslations("dashboard.authForm");
  const tc = useTranslations("dashboard.common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show, Toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<AuthPhase>("idle");
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<AuthFormError | null>(null);

  // 同步防重复闸门：disabled 只挡得住指针/键盘的「下一次」点击，
  // 挡不住同一 tick 内的重复触发（双击、回车连发、自动化重放）。
  // 用 ref 而不是 state：setState 是异步的，第二次触发时读到的仍是旧值。
  const inFlight = useRef(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载即清理：成功跳转时登录页卸载，不能把计时器留在已卸载的组件上。
  // 空依赖是刻意的——ref 对象本身稳定，清理时读到的一定是当前最新句柄。
  useEffect(() => {
    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      if (stallTimer.current) clearTimeout(stallTimer.current);
    };
  }, []);

  const isSignup = mode === "signup";

  // 读取 redirect 参数（安全：站内白名单前缀，见 @/lib/auth-redirect）
  const redirectTarget = searchParams.get("redirect");
  const safeRedirect = safeRedirectTarget(redirectTarget);
  // proxy 判定「认证上游不可用」时带这个标记跳回登录页。它不是凭据错误：
  // 必须说成「暂时连不上，可重试」，否则用户会以为是密码不对而反复改正确的密码。
  const authUnavailable = searchParams.get("auth") === "unavailable";
  // 切换登录/注册时保留 redirect 参数
  const switchHref = isSignup ? "/login" : "/signup";
  const switchHrefWithRedirect = redirectTarget ? `${switchHref}?redirect=${encodeURIComponent(redirectTarget)}` : switchHref;

  const validate = (): AuthFormError | null =>
    validateAuthCredentials(
      { email, password },
      { invalidEmail: t("errInvalidEmail"), passwordShort: t("errPasswordShort") }
    );

  // 输入即失效：改动出错的字段时移除该字段错误，避免过时的 aria-invalid / aria-describedby
  // 继续指向已经不再存在的错误。表单级错误（凭据、网络）保留到下一次提交。
  const handleChange = (field: AuthField, value: string) => {
    if (field === "email") setEmail(value);
    else setPassword(value);
    if (error?.field === field) setError(null);
  };

  const emailError = fieldErrorFor(error, "email");
  const passwordError = fieldErrorFor(error, "password");
  const formError = error && error.field === null ? error.message : null;

  const clearWaitTimers = () => {
    if (slowTimer.current) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
    if (stallTimer.current) {
      clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  };

  /** 进入等待：重置提示状态，并从**点击时刻**起算慢加载提示（阶段切换不重新计时） */
  const startWaiting = () => {
    clearWaitTimers();
    setSlow(false);
    setStalled(false);
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_HINT_MS);
  };

  /** 认证已成功、跳转已发出：从这里起「异常久」的恢复方式是刷新，而不是重新提交 */
  const enterOpening = () => {
    setPhase("opening");
    stallTimer.current = setTimeout(() => setStalled(true), STALL_RECOVERY_MS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 同步闸门必须在 setError / setPhase 之前：这一行之前不能有任何 await
    if (inFlight.current) return;
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // 演示模式：不调用 Supabase，仅 toast 提示
    if (!isAuthEnabled) {
      show(tc("demoModeNoSave"), "info");
      return;
    }

    inFlight.current = true;
    // 点击即反馈：先切状态，再发请求（不等任何 await）
    setPhase("verifying");
    startWaiting();

    // 成功进入 opening 后必须保持 loading，直到登录页卸载；
    // 只有「可处理的失败」才回 idle 并重新允许提交。
    let navigating = false;

    try {
      const supabase = createBrowser();
      // 漏斗事件：提交注册表单（是否成功由 signup_completed 判定）
      if (isSignup) track("signup_started");

      if (isSignup) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          // 「邮箱已注册」指向邮箱字段；其余服务端原文（限流、网络等）保持表单级；
          // BUG-15：网络失败 / 上游 5xx / 限流不再透出英文原文，改用可重试的本地化文案
          setError(
            signUpError.message === "User already registered"
              ? { field: "email", message: t("errAlreadyRegistered") }
              : formLevelError(
                  isServiceLevelAuthFailure(signUpError)
                    ? t("errServiceUnavailable")
                    : signUpError.message
                )
          );
          return;
        }
        // 注册成功后直接跳转（已关闭邮箱验证）。
        // 认领只做后台触发，绝不进入等待链（此前 await 认领导致按钮长时间停留在「注册中」）。
        track("signup_completed");
        startGuestAuditClaim({ redirectTarget });
        navigating = true;
        enterOpening();
        router.push(safeRedirect);
        return;
      }

      // 登录
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        // 凭据错误可能来自邮箱也可能来自密码：不绑定单个字段，只作表单级提示。
        // BUG-15：但「请求没到认证服务 / 上游 5xx / 限流」不是凭据错误，
        // 说成「邮箱或密码不正确」会让用户反复改正确的密码且不重试。
        setError(
          formLevelError(
            isServiceLevelAuthFailure(signInError)
              ? t("errServiceUnavailable")
              : t("errInvalidCredentials")
          )
        );
        return;
      }
      // 认证成功 ≠ 已进入后台：这里绝不能 setPhase("idle")。
      // 登录页会在整个 /app 首屏加载期间继续挂载，loading 就是用户唯一的反馈面。
      track("login_completed");
      startGuestAuditClaim({ redirectTarget });
      navigating = true;
      enterOpening();
      router.push(safeRedirect);
      // 刻意不在 push 之后跟 router.refresh()（2026-10-21）。
      // Next 16 的 action queue 把「非导航动作」排到正在进行的导航之后执行
      // （app-router-instance.js → dispatchAction：pending 非空且非 NAVIGATE/RESTORE
      // 就入队），所以这行 refresh 会在用户**已经看到工作台之后**再整页重算一次
      // /app（proxy + 会话 + 项目 + Turso 队列），等于每次登录付两遍首屏成本。
      // 而它要解决的问题在这里并不存在：/app 是 force-dynamic（staleTimes.dynamic
      // 默认 0），push 本身就会向服务器取新数据；(default) layout 只读 locale，
      // 没有依赖会话的上层缓存需要刷。若以后 /app 改成可缓存渲染，必须重新评估。
    } finally {
      // 失败分支（含意外抛错）：解除闸门、清计时器、回到可重试的 idle，
      // 绝不停在永久转圈，也绝不把异常伪装成成功。
      if (!navigating) {
        clearWaitTimers();
        inFlight.current = false;
        setPhase("idle");
        setSlow(false);
        setStalled(false);
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm">
        {/* 演示模式横幅 */}
        {!isAuthEnabled && (
          <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-4 py-2 text-center font-sans text-xs font-medium text-warn">
            {t("demoBanner")}
          </div>
        )}

        {/* 卡片 */}
        <div className="card-a p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-1">
            <span className="font-display text-2xl font-semibold text-ink">
              See
            </span>
            <span className="font-display text-2xl font-semibold text-accent">
              O
            </span>
          </div>

          <h1 className="mt-6 text-center font-display text-xl font-semibold text-ink">
            {isSignup ? t("signupTitle") : t("loginTitle")}
          </h1>
          <p className="mt-2 text-center font-sans text-sm text-ink-60">
            {isSignup
              ? t("signupSubtitle")
              : t("loginSubtitle")}
          </p>

          {/* 表单 */}
          {/* noValidate：type="email" 的原生约束校验会在提交前拦下请求，
              导致 onSubmit 不触发、自有的 role="alert" 字段错误永远不出现
              （只剩浏览器原生气泡：不受 next-intl 本地化、也不进 aria-describedby 关联）。
              校验统一交给 validateAuthCredentials，保证中英文两种语种的无障碍表现一致。 */}
          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="auth-email" className="font-sans text-xs font-medium text-ink-60">{t("email")}</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "auth-email-error" : undefined}
                className="mt-2 h-10 w-full rounded-md border border-line bg-card px-3 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-accent focus:outline-none"
              />
              {/* BUG-10：字段级错误紧跟输入框，role="alert" 让屏幕阅读器朗读，
                  并通过 id 与上面的 aria-describedby 关联 */}
              {emailError && (
                <p id="auth-email-error" role="alert" className="mt-2 font-sans text-xs text-neg">
                  {emailError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="auth-password" className="font-sans text-xs font-medium text-ink-60">{t("password")}</label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => handleChange("password", e.target.value)}
                placeholder={isSignup ? t("passwordPlaceholderSignup") : t("passwordPlaceholderLogin")}
                autoComplete={isSignup ? "new-password" : "current-password"}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "auth-password-error" : undefined}
                className="mt-2 h-10 w-full rounded-md border border-line bg-card px-3 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-accent focus:outline-none"
              />
              {passwordError && (
                <p id="auth-password-error" role="alert" className="mt-2 font-sans text-xs text-neg">
                  {passwordError}
                </p>
              )}
            </div>

            {/* 表单级错误（凭据 / 服务端 / 网络）：不绑定任何单个字段 */}
            {formError && (
              <div id="auth-form-error" role="alert" className="rounded-md border border-neg/30 bg-neg/10 px-3 py-2 font-sans text-xs text-neg">
                {formError}
              </div>
            )}

            {/* 上游不可用提示：与本次提交结果并存时以提交结果为准，不叠两条 */}
            {!formError && authUnavailable && (
              <div
                id="auth-unavailable-notice"
                role="status"
                className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 font-sans text-xs font-medium text-warn"
              >
                {t("authUnavailableNotice")}
              </div>
            )}

            {/*
              按钮文案就是转场状态的唯一视觉反馈面：认证阶段与跳转阶段分开说，
              用户才能分辨「正在验证」和「验证已通过、正在进入工作区」。
              语言切换（英语 / 简体中文）走同一套键，不出现只修一种语言的情况。
            */}
            <button
              type="submit"
              disabled={phase !== "idle"}
              aria-busy={phase !== "idle"}
              className="btn-primary w-full"
            >
              {/*
                role="status"（隐含 polite）挂在文案节点上：按钮文案变化不保证被
                屏幕阅读器朗读，而这里的内容变化就是一次状态更新。
                刻意不加显式 polite 属性、不塞 sr-only 第二份文本——本仓既有约定
                （Toast 的重复播报问题）就是「可见文本即朗读来源」。
              */}
              <span role="status">
                {phase === "opening"
                  ? t("opening")
                  : phase === "verifying"
                    ? isSignup
                      ? t("signupVerifying")
                      : t("loginVerifying")
                    : isSignup
                      ? t("signupBtn")
                      : t("loginBtn")}
              </span>
            </button>

            {/*
              等待说明区：只在真的等久了才出现，且不是假进度。
              区域常驻（空内容），这样内容变化才会被朗读；等待结束回到 idle 时自动清空。
            */}
            <div id="auth-progress" role="status" className="space-y-2 font-sans text-xs">
              {slow && (
                <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                  {t("slowHint")}
                </p>
              )}
              {/*
                认证已成功、工作区仍未出现：给的是「刷新页面」这条安全恢复路径，
                不是把 Login 重新点亮。原跳转可能仍在执行，重新提交只会造成重复请求。
              */}
              {stalled && (
                <div className="rounded-md border border-line bg-paper px-3 py-2 text-ink-60">
                  <p>{t("stallNotice")}</p>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-2 font-medium text-accent underline"
                  >
                    {t("stallAction")}
                  </button>
                </div>
              )}
            </div>
          </form>

          {/* 切换链接 */}
          <p className="mt-6 text-center font-sans text-xs text-ink-60">
            {isSignup ? (
              <>
                {t("hasAccount")}{" "}
                <Link href={switchHrefWithRedirect} className="font-medium text-accent hover:underline">
                  {t("loginLink")}
                </Link>
              </>
            ) : (
              <>
                {t("noAccount")}{" "}
                <Link href={switchHrefWithRedirect} className="font-medium text-accent hover:underline">
                  {t("signupLink")}
                </Link>
              </>
            )}
          </p>
        </div>

      </div>

      <Toast />
    </div>
  );
}

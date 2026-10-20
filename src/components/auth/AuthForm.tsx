"use client";

import { useState } from "react";
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

export default function AuthForm({ mode }: AuthFormProps) {
  const t = useTranslations("dashboard.authForm");
  const tc = useTranslations("dashboard.common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show, Toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthFormError | null>(null);

  const isSignup = mode === "signup";

  // 读取 redirect 参数（安全：站内白名单前缀，见 @/lib/auth-redirect）
  const redirectTarget = searchParams.get("redirect");
  const safeRedirect = safeRedirectTarget(redirectTarget);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setLoading(true);
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
        setLoading(false);
        return;
      }
      // 注册成功后直接跳转（已关闭邮箱验证）。
      // 顺序要求：先结束 loading，再导航；认领只做后台触发，绝不进入等待链
      //（此前 await 认领导致按钮长时间停留在「注册中」）。
      track("signup_completed");
      startGuestAuditClaim({ redirectTarget });
      setLoading(false);
      router.push(safeRedirect);
      router.refresh();
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
      setLoading(false);
      return;
    }
    // 与注册路径一致：先结束 loading，再导航；认领仅后台触发
    track("login_completed");
    startGuestAuditClaim({ redirectTarget });
    setLoading(false);
    router.push(safeRedirect);
    router.refresh();
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

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading
                ? t("processing")
                : isSignup
                  ? t("signupBtn")
                  : t("loginBtn")}
            </button>
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

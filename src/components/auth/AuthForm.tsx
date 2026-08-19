"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { useToast } from "@/components/dashboard/Toast";

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
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  // 读取 redirect 参数（安全：仅允许 /app 开头的路径）
  const redirectTarget = searchParams.get("redirect");
  const safeRedirect = redirectTarget && redirectTarget.startsWith("/app") ? redirectTarget : "/app";
  // 切换登录/注册时保留 redirect 参数
  const switchHref = isSignup ? "/login" : "/signup";
  const switchHrefWithRedirect = redirectTarget ? `${switchHref}?redirect=${encodeURIComponent(redirectTarget)}` : switchHref;

  const validate = (): string | null => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return t("errInvalidEmail");
    }
    if (password.length < 8) {
      return t("errPasswordShort");
    }
    return null;
  };

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

    if (isSignup) {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message === "User already registered"
          ? t("errAlreadyRegistered")
          : signUpError.message);
        setLoading(false);
        return;
      }
      // 注册成功后直接跳转（已关闭邮箱验证）
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
      setError(t("errInvalidCredentials"));
      setLoading(false);
      return;
    }
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
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="font-sans text-xs font-medium text-ink-60">{t("email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="mt-2 h-10 w-full rounded-md border border-line bg-card px-3 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="font-sans text-xs font-medium text-ink-60">{t("password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? t("passwordPlaceholderSignup") : t("passwordPlaceholderLogin")}
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="mt-2 h-10 w-full rounded-md border border-line bg-card px-3 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-accent focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-md border border-neg/30 bg-neg/10 px-3 py-2 font-sans text-xs text-neg">
                {error}
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

"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowser } from "@/lib/supabase/browser";
import { isAuthEnabled } from "@/lib/auth-config";
import { useToast } from "@/components/dashboard/Toast";

interface AuthFormProps {
  mode: "login" | "signup";
}

export default function AuthForm({ mode }: AuthFormProps) {
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
      return "邮箱格式不正确";
    }
    if (password.length < 8) {
      return "密码至少 8 位";
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
      show("当前为演示模式，数据不会保存", "info");
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
          ? "这个邮箱已注册，请直接登录"
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
      setError("邮箱或密码不正确");
      setLoading(false);
      return;
    }
    router.push(safeRedirect);
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-station px-5 py-12">
      <div className="w-full max-w-sm">
        {/* 演示模式横幅 */}
        {!isAuthEnabled && (
          <div className="mb-4 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2.5 text-center font-sans text-xs font-medium text-gold">
            演示模式 · 账号系统未启用
          </div>
        )}

        {/* 深色卡片 */}
        <div className="rounded-2xl bg-ink p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-1">
            <span className="font-display text-2xl font-bold text-d-text">
              See
            </span>
            <span className="font-display text-2xl font-bold text-gold">
              O
            </span>
          </div>

          <h1 className="mt-6 text-center font-display text-xl font-bold text-d-text">
            {isSignup ? "创建你的账号" : "欢迎回来"}
          </h1>
          <p className="mt-1.5 text-center font-sans text-sm text-d-secondary">
            {isSignup
              ? "注册后立即开始分析你的网站"
              : "登录继续查看你的搜索数据"}
          </p>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="font-mono text-xs text-d-muted">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="mt-1.5 w-full rounded-lg border border-d-muted/15 bg-ink-elevated px-3 py-2.5 font-sans text-sm text-d-text placeholder:text-d-muted focus:border-gold/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-mono text-xs text-d-muted">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "至少 8 位" : "输入密码"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="mt-1.5 w-full rounded-lg border border-d-muted/15 bg-ink-elevated px-3 py-2.5 font-sans text-sm text-d-text placeholder:text-d-muted focus:border-gold/50 focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 font-sans text-xs text-coral">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gold px-4 py-2.5 font-sans text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading
                ? "处理中…"
                : isSignup
                  ? "注册并开始使用"
                  : "登录"}
            </button>
          </form>

          {/* 切换链接 */}
          <p className="mt-6 text-center font-sans text-xs text-d-secondary">
            {isSignup ? (
              <>
                已有账号？{" "}
                <Link href={switchHrefWithRedirect} className="font-medium text-gold hover:underline">
                  直接登录
                </Link>
              </>
            ) : (
              <>
                还没注册？{" "}
                <Link href={switchHrefWithRedirect} className="font-medium text-gold hover:underline">
                  创建账号
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

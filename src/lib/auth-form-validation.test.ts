// ===== BUG-10 回归测试：认证表单校验的「错误归属」纯逻辑 =====
// 无障碍关联的前提是知道错误属于哪个字段：
//   field=email / password → 绑定到对应输入框（aria-invalid + aria-describedby）
//   field=null             → 表单级（认证失败、服务端/网络/限流），绝不绑单个字段
// 校验规则与文案顺序必须与修复前完全一致（先邮箱格式、再密码长度）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  fieldErrorFor,
  formLevelError,
  isServiceLevelAuthFailure,
  validateAuthCredentials,
} from "./auth-form-validation";

const MSG = { invalidEmail: "Please enter a valid email address", passwordShort: "Password must be at least 8 characters" };
const OK_EMAIL = "user@example.com";

describe("BUG-10：校验规则未变", () => {
  it("邮箱非法 → 归属 email 字段，文案为 invalidEmail", () => {
    for (const bad of ["", "   ", "user", "user@", "@example.com", "a b@c.com", "a@b"]) {
      const err = validateAuthCredentials({ email: bad, password: "longenough" }, MSG);
      expect(err, `「${bad}」`).toEqual({ field: "email", message: MSG.invalidEmail });
    }
  });

  it("密码长度边界：7 位报错、8 位通过（阈值仍为 8）", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(validateAuthCredentials({ email: OK_EMAIL, password: "a".repeat(7) }, MSG)).toEqual({
      field: "password",
      message: MSG.passwordShort,
    });
    expect(validateAuthCredentials({ email: OK_EMAIL, password: "a".repeat(8) }, MSG)).toBeNull();
  });

  it("两个字段都不合法时只报第一个（邮箱优先，与原实现顺序一致）", () => {
    expect(validateAuthCredentials({ email: "nope", password: "123" }, MSG)).toEqual({
      field: "email",
      message: MSG.invalidEmail,
    });
  });

  it("全部合法返回 null", () => {
    expect(validateAuthCredentials({ email: OK_EMAIL, password: "abcdefgh" }, MSG)).toBeNull();
  });

  it("邮箱正则与原实现逐字符一致", () => {
    expect(EMAIL_PATTERN.source).toBe("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  });
});

describe("BUG-10：错误归属与 aria 状态同步", () => {
  it("表单级错误 field=null，且不会投射到任何字段", () => {
    const err = formLevelError("Invalid credentials");
    expect(err).toEqual({ field: null, message: "Invalid credentials" });
    expect(fieldErrorFor(err, "email")).toBeNull();
    expect(fieldErrorFor(err, "password")).toBeNull();
  });

  it("fieldErrorFor 只在该字段确有错误时返回文案（用于撤销过时的 aria-invalid）", () => {
    const emailErr = { field: "email" as const, message: MSG.invalidEmail };
    expect(fieldErrorFor(emailErr, "email")).toBe(MSG.invalidEmail);
    expect(fieldErrorFor(emailErr, "password")).toBeNull();
    expect(fieldErrorFor(null, "email")).toBeNull();
    expect(fieldErrorFor(null, "password")).toBeNull();
  });
});

// ===== BUG-15 回归测试：凭据错误 vs 「请求没到认证服务」 =====
// 修复前：signInWithPassword 的任何失败都被说成「邮箱或密码不正确」，
// 网络断开 / 上游 5xx / 限流时用户会反复修改本来正确的密码。

describe("BUG-15：服务级认证失败不得伪装成凭据错误", () => {
  it("网络层失败（无 HTTP status / FetchError / TypeError）判为服务级", () => {
    for (const e of [
      { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      { name: "AuthUnknownError", message: "Custom error", originalError: {} },
      { name: "TypeError", message: "Failed to fetch" },
      { name: "Error", message: "Network request failed" },
      undefined,
      null,
    ]) {
      expect(isServiceLevelAuthFailure(e), JSON.stringify(e)).toBe(true);
    }
  });

  it("上游 5xx 与 429 限流判为服务级", () => {
    expect(isServiceLevelAuthFailure({ name: "AuthApiError", status: 500 })).toBe(true);
    expect(isServiceLevelAuthFailure({ name: "AuthApiError", status: 503 })).toBe(true);
    expect(isServiceLevelAuthFailure({ name: "AuthApiError", status: "429" })).toBe(true);
  });

  it("4xx 凭据类失败仍判为非服务级（继续显示「邮箱或密码不正确」）", () => {
    for (const status of [400, 401, 403]) {
      expect(isServiceLevelAuthFailure({ name: "AuthApiError", status }), String(status)).toBe(false);
    }
  });

  it("AuthForm 两条分支都按分类选择文案，不再把网络失败说成密码错误", () => {
    const src = readFileSync(fileURLToPath(new URL("../components/auth/AuthForm.tsx", import.meta.url)), "utf-8");
    expect(src).toContain("isServiceLevelAuthFailure");
    const loginBlock = src.slice(src.indexOf("signInWithPassword"), src.indexOf("track(\"login_completed\")"));
    const signupBlock = src.slice(src.indexOf("supabase.auth.signUp"), src.indexOf("track(\"signup_completed\")"));
    for (const block of [loginBlock, signupBlock]) {
      expect(block).toContain("isServiceLevelAuthFailure");
      expect(block).toContain('t("errServiceUnavailable")');
    }
    // 注册分支仍需保留「邮箱已注册 → 邮箱字段」的归属
    expect(signupBlock).toContain('t("errAlreadyRegistered")');
  });

  it("en / zh 都有 errServiceUnavailable 文案", () => {
    for (const lang of ["en", "zh"]) {
      const msg = JSON.parse(readFileSync(fileURLToPath(new URL(`../../messages/${lang}.json`, import.meta.url)), "utf-8"));
      const text = msg.dashboard.authForm.errServiceUnavailable;
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(8);
      expect(text).not.toBe(msg.dashboard.authForm.errInvalidCredentials);
    }
  });
});

// ===== BUG-10 回归测试：AuthForm 的可访问性接线（源码契约）=====
// 要求：错误文本与输入框真实关联（label/htmlFor ↔ id、aria-describedby ↔ 错误元素 id）、
// aria-invalid 只在对应字段有错时为 true、错误消失后关联同步撤销、
// role="alert" 只出现一次朗读来源（不叠加 aria-live 造成重复播报）。
// 认证流程本身（signUp / signInWithPassword / 提交后跳转 / 文案键）必须保持不变——
// 这里同时钉住这些事实，防止「为了加无障碍属性而重写认证流程」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("./AuthForm.tsx", import.meta.url)), "utf-8");

const EMAIL_BLOCK = SRC.slice(SRC.indexOf('<label htmlFor="auth-email"'), SRC.indexOf('<label htmlFor="auth-password"'));
const PASSWORD_BLOCK = SRC.slice(SRC.indexOf('<label htmlFor="auth-password"'), SRC.indexOf("{/* 表单级错误"));

describe("BUG-10：字段错误与输入框的可访问名关联", () => {
  it("邮箱：label 指向 auth-email，错误元素 id 与 aria-describedby 一致", () => {
    expect(EMAIL_BLOCK).toContain('<label htmlFor="auth-email"');
    expect(EMAIL_BLOCK).toContain('id="auth-email"');
    expect(EMAIL_BLOCK).toContain('aria-describedby={emailError ? "auth-email-error" : undefined}');
    expect(EMAIL_BLOCK).toContain('aria-invalid={emailError ? true : undefined}');
    expect(EMAIL_BLOCK).toContain('<p id="auth-email-error" role="alert"');
    expect(EMAIL_BLOCK).toContain("{emailError}");
  });

  it("密码：同一套关联，绑定到 auth-password-error", () => {
    expect(PASSWORD_BLOCK).toContain('<label htmlFor="auth-password"');
    expect(PASSWORD_BLOCK).toContain('id="auth-password"');
    expect(PASSWORD_BLOCK).toContain('aria-describedby={passwordError ? "auth-password-error" : undefined}');
    expect(PASSWORD_BLOCK).toContain('aria-invalid={passwordError ? true : undefined}');
    expect(PASSWORD_BLOCK).toContain('<p id="auth-password-error" role="alert"');
    expect(PASSWORD_BLOCK).toContain("{passwordError}");
  });

  it("aria 状态是条件式：无错误时既不写 aria-invalid 也不留 aria-describedby 悬空引用", () => {
    const describedBys = SRC.match(/aria-describedby=\{[^}]*\}/g) ?? [];
    expect(describedBys.length).toBe(2);
    for (const attr of describedBys) {
      expect(attr).toContain("? ");
      expect(attr).toContain(": undefined");
    }
    expect(SRC).not.toMatch(/aria-invalid="true"/);
    expect(SRC).not.toMatch(/aria-invalid=\{true\}/);
  });

  it("错误消失即卸载元素：role=\"alert\" 节点由条件渲染产生，且只有三处", () => {
    // 注释里也写了 role="alert"，计数只看可执行代码
    const CODE = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(CODE).toContain("{emailError && (");
    expect(CODE).toContain("{passwordError && (");
    expect(CODE).toContain("{formError && (");
    expect(CODE.match(/role="alert"/g)?.length).toBe(3);
  });

  it("不叠加 aria-live（role=alert 已隐含 assertive），避免同一错误被朗读两次", () => {
    expect(SRC).not.toContain("aria-live");
    expect(SRC).not.toMatch(/aria-describedby=\{[^}]*formError/);
  });

  it("表单级错误独立成块，不指向任何输入框 id", () => {
    const formBlock = SRC.slice(SRC.indexOf('{/* 表单级错误'), SRC.indexOf("<button"));
    expect(formBlock).toContain('id="auth-form-error"');
    expect(formBlock).toContain('role="alert"');
    expect(formBlock).not.toContain("auth-email");
    expect(formBlock).not.toContain("auth-password");
  });

  it("表单声明 noValidate：邮箱格式错误必须走自有校验，而不是被浏览器原生气泡拦下提交", () => {
    // 隔离浏览器实测：noValidate=false 时点击提交只会显示浏览器原生气泡，
    // onSubmit 不触发 → role="alert" 错误节点永不渲染（不本地化、无 aria-describedby 关联）。
    const start = SRC.indexOf("<form onSubmit");
    const formTag = SRC.slice(start, SRC.indexOf(">", start) + 1);
    expect(formTag).toContain("noValidate");
    // type=email 仍然保留（自动填充与移动端键盘），只是不再参与提交拦截
    expect(SRC).toContain('type="email"');
  });
});

describe("BUG-10：状态来源与清除时机", () => {
  it("字段错误来自 fieldErrorFor，表单级来自 field===null", () => {
    expect(SRC).toContain('const emailError = fieldErrorFor(error, "email");');
    expect(SRC).toContain('const passwordError = fieldErrorFor(error, "password");');
    expect(SRC).toContain("error.field === null");
  });

  it("编辑出错字段时撤销该字段的错误状态（不留过时 aria-invalid）", () => {
    expect(SRC).toContain("const handleChange = (field: AuthField, value: string) => {");
    expect(SRC).toContain("if (error?.field === field) setError(null);");
    expect(SRC).toContain('onChange={(e) => handleChange("email", e.target.value)}');
    expect(SRC).toContain('onChange={(e) => handleChange("password", e.target.value)}');
  });

  it("凭据错误与服务端原文保持表单级，仅「邮箱已注册」归到邮箱字段", () => {
    // BUG-15 之后，登录/注册两条分支都先分辨「服务级失败」再落到原文/凭据文案；
    // 契约不变：凭据错误与服务端原文都必须走 formLevelError（表单级），不得绑定单个字段。
    expect(SRC).toMatch(
      /setError\(\s*formLevelError\(\s*isServiceLevelAuthFailure\(signInError\)\s*\?\s*t\("errServiceUnavailable"\)\s*:\s*t\("errInvalidCredentials"\)/
    );
    expect(SRC).toMatch(
      /formLevelError\(\s*isServiceLevelAuthFailure\(signUpError\)[\s\S]{0,120}:\s*signUpError\.message\s*\)/
    );
    expect(SRC).toContain('{ field: "email", message: t("errAlreadyRegistered") }');
  });
});

describe("BUG-10：认证流程与文案未被改写", () => {
  it("校验仍走同一条路径：先 validate()，失败即中止提交", () => {
    expect(SRC).toContain("const validationError = validate();");
    expect(SRC).toContain("if (validationError) {");
    expect(SRC).toContain("e.preventDefault();");
    expect(SRC).toContain('validateAuthCredentials(');
    expect(SRC).toContain('invalidEmail: t("errInvalidEmail")');
    expect(SRC).toContain('passwordShort: t("errPasswordShort")');
  });

  it("Supabase 调用、埋点、演示模式与成功后跳转均未变", () => {
    expect(SRC).toContain("supabase.auth.signUp({");
    expect(SRC).toContain("supabase.auth.signInWithPassword({");
    expect(SRC).toContain('track("signup_started")');
    expect(SRC).toContain('track("login_completed")');
    expect(SRC).toContain("if (!isAuthEnabled) {");
    expect(SRC).toContain("router.push(safeRedirect);");
    expect(SRC).toContain("<form onSubmit={handleSubmit}");
    expect(SRC).toContain('type="email"');
    expect(SRC).toContain('type="password"');
    expect(SRC).toContain('autoComplete="email"');
    expect(SRC).toContain('autoComplete={isSignup ? "new-password" : "current-password"}');
  });
});

// ===== 登录/注册表单校验（client-safe，纯函数）=====
// 校验规则与文案完全沿用 AuthForm 既有实现（先邮箱格式、再密码长度），
// 只是把「错误属于哪个字段」显式建模，供无障碍关联使用：
//   field=email|password → 字段级错误，绑定到该输入框；
//   field=null           → 表单级错误（认证失败、服务端/网络错误、限流），
//                          绝不绑定到某一个输入框，避免把凭据错误说成「邮箱格式不对」。

export type AuthField = "email" | "password";

export interface AuthFormError {
  /** null = 表单级错误（不属于任何单个字段） */
  field: AuthField | null;
  message: string;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export interface AuthValidationMessages {
  invalidEmail: string;
  passwordShort: string;
}

/** 返回第一个校验错误（与原实现的顺序一致：邮箱 → 密码）；全部通过返回 null */
export function validateAuthCredentials(
  input: { email: string; password: string },
  messages: AuthValidationMessages
): AuthFormError | null {
  if (!EMAIL_PATTERN.test(input.email)) {
    return { field: "email", message: messages.invalidEmail };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { field: "password", message: messages.passwordShort };
  }
  return null;
}

/** 服务端 / 认证失败：一律作为表单级错误 */
export function formLevelError(message: string): AuthFormError {
  return { field: null, message };
}

/** BUG-15：区分「凭据不对」与「请求没到达认证服务」。
 * AuthRetryableFetchError / AuthUnknownError / 没有 HTTP status（网络层直接失败）/
 * 429 限流 / 5xx 上游故障都属于后者：把它们说成「邮箱或密码不正确」会诱导用户
 * 反复修改本来正确的密码，也不会去重试。 */
export function isServiceLevelAuthFailure(error: unknown): boolean {
  const e = error as { name?: string; status?: string | number } | null | undefined;
  if (!e) return true;
  const name = typeof e.name === "string" ? e.name : "";
  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError" || name === "TypeError") return true;
  const status = Number(e.status ?? 0);
  if (!Number.isFinite(status) || status === 0) return true;
  return status === 429 || status >= 500;
}

/** 该字段的错误文案；字段与错误不匹配（含表单级）时返回 null，用于同步 aria 状态 */
export function fieldErrorFor(error: AuthFormError | null, field: AuthField): string | null {
  return error && error.field === field ? error.message : null;
}

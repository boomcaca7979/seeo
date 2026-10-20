// ===== 登录后回跳地址白名单（client-safe，纯函数）=====
// 三处消费点共用：AuthForm（登录/注册成功后 push）、supabase middleware（已登录访问
// /login|/signup 时回跳）、以及生成 `/login?redirect=` 的页面。
//
// 历史实现是就地写死的 `redirect.startsWith("/app")`，导致支付结果页
// `/payment/result?order=…` 被判定为不安全、用户登录后被丢回 /app。
// 这里改为「显式白名单前缀 + 路径边界」：只多出支付结果页这一条站内路径，
// 绝对 URL、协议相对 URL、反斜杠与控制字符一律拒绝；未通过白名单只回落到 /app。

/** 白名单前缀（站内、无 locale 前缀的工作台与支付结果页） */
export const SAFE_REDIRECT_PREFIXES = ["/app", "/payment/result"] as const;

/** 白名单不通过时的回落目标 */
export const AUTH_FALLBACK_TARGET = "/app";

/**
 * 是否允许作为登录后的回跳目标。
 * 注意：调用方传入的是 `searchParams.get("redirect")` 的**已解码**值，
 * 所以 `%2f%2fevil.com` 这类编码绕过在解码后就是 `//evil.com`，会被下面的
 * 「必须以单个 / 开头」规则拒绝，无需再做二次解码。
 */
export function isSafeRedirectTarget(target: string | null | undefined): boolean {
  if (!target) return false;
  // 必须站内：排除 http(s)://、javascript: 等绝对 URL，以及 //evil.com 协议相对地址
  if (!target.startsWith("/") || target.startsWith("//")) return false;
  // 浏览器把 `\` 当作 `/`，`/\evil.com` 等价于 `//evil.com`
  if (target.includes("\\")) return false;
  // 点号段（`/app/../../x`）会被规范化成另一条站内路径，不接受——白名单要按字面路径判定
  if (target.split("/").includes("..")) return false;
  // 控制字符（换行等）不允许
  if (/[\u0000-\u001f\u007f]/.test(target)) return false;
  return SAFE_REDIRECT_PREFIXES.some(
    (prefix) => target === prefix || target.startsWith(`${prefix}/`) || target.startsWith(`${prefix}?`)
  );
}

/** 返回安全的回跳地址：不在白名单内（含 null）一律回落到 /app */
export function safeRedirectTarget(target: string | null | undefined): string {
  return isSafeRedirectTarget(target) ? (target as string) : AUTH_FALLBACK_TARGET;
}

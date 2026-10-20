// ===== 认证/身份请求的有界等待与故障留痕 =====
//
// 为什么要它（2026-10-20 生产登录约 30s 无响应）：
//   认证上游只有两条调用路：proxy 的 `supabase.auth.getUser()`（请求带会话
//   cookie 时才会真的打网络；/app/projects/<id> 文档还带一次项目归属读取），
//   以及工作台渲染期的「身份 + profiles」读取。上游 TCP 半开或对端迟迟不响应时，
//   这些调用既不返回也不报错，整条文档或 RSC flight 请求一直挂着：浏览器表现为
//   「点了登录之后长时间没反应」，Vercel 侧则在实例回收时留下
//   「请求仍活跃 + 进程退出 128」。
//
// 本模块提供三件事：createBoundedFetch（响应头硬上限）、withRequestDeadline
// （整趟硬上限）、logAuthUpstreamFailure（把故障按类别留痕，供部署后核对）。
//
// 边界：
//   - 只作用于认证/身份请求；共享客户端上的业务数据查询不加限制；
//   - 不改 Supabase 的 URL/密钥/区域配置，也不重试（重试只会把等待翻倍）；
//   - 外部传入的 signal 仍然生效：调用方取消 → 立即取消，两个来源互不覆盖；
//   - 计时器一定清理，避免实例被回收时留下挂着的 timer。

/**
 * 上限取值依据：2026-10-20 本机对认证端点实测 5 趟 250–914ms（中位 310ms），
 * 6s 已是观测最坏单跳的 6 倍以上；同时把最坏等待从用户报的约 30s 压到 1/5，
 * 仍明显小于 Vercel 函数的默认上限。
 */
export const AUTH_UPSTREAM_TIMEOUT_MS = 6000;

export function createBoundedFetch(
  timeoutMs: number = AUTH_UPSTREAM_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort(new DOMException("上游认证请求超时", "TimeoutError"));
    }, timeoutMs);

    const outer = init?.signal ?? null;
    const relayAbort = () => ctrl.abort(outer?.reason);
    if (outer) {
      if (outer.aborted) ctrl.abort(outer.reason);
      else outer.addEventListener("abort", relayAbort, { once: true });
    }

    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", relayAbort);
    }
  };
}

/**
 * 超时之外的第二道保险：Node 侧 fetch **没有**浏览器那样的全局时长上限，
 * undici 只约束「等待响应头」与「响应体相邻分片之间」（默认各约 300s）。
 * 上游一旦在返回响应头之后半停住地继续吐 body，abort 已经解除，那一趟仍会
 * 长时间挂着（见上方 finally：收到响应头即清计时器）。身份请求是单行小读，
 * 用整趟 Promise 的硬上限补上这一段。
 *
 * 只用于认证/身份请求；到期即**丢弃**该响应并返回 sentinel，由调用方按
 * 「上游不可用」处理。超时不会伪造成功，也不会留下未处理的拒绝。
 */
export const AUTH_REQUEST_DEADLINE_MS = 10_000;

/** 整趟超时的标记错误：只带类别信息，不带上游原文（auth-js 的 message 可能含响应体） */
const AUTH_DEADLINE_SENTINEL = Object.assign(new Error("认证请求整趟超时"), {
  name: "TimeoutError",
});

export async function withRequestDeadline<T>(
  work: Promise<T>,
  deadlineMs: number = AUTH_REQUEST_DEADLINE_MS,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ ok: false; error: Error }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: AUTH_DEADLINE_SENTINEL }), deadlineMs);
  });
  // 到期后原始 Promise 的拒绝不再有人接：把它转成 resolved 结果，
  // 既防止未处理拒绝，也保留「先 settle 的那一方决定结果」的语义。
  const guarded = work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    return await Promise.race([guarded, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type AuthFailureCategory =
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "upstream_5xx"
  | "network_error"
  | "unknown";

/**
 * 故障归类：**只**读 error 的 name / status。绝不使用 message —— auth-js 会把
 * 上游响应体、请求 URL 等原文塞进 message，日志里可能顺带带出凭据。
 */
export function classifyAuthFailure(error: unknown): {
  category: AuthFailureCategory;
  status: number | null;
} {
  const e = (error ?? {}) as { name?: unknown; status?: unknown };
  const rawStatus = typeof e.status === "number" && Number.isFinite(e.status) ? e.status : null;
  // 只允许「确实是 HTTP 状态区间」或 auth-js 的 0（无响应）进入日志
  const status = rawStatus !== null && (rawStatus === 0 || (rawStatus >= 100 && rawStatus <= 599))
    ? rawStatus
    : null;
  const name = typeof e.name === "string" ? e.name : "";

  if (name === "TimeoutError") return { category: "timeout", status };
  if (name === "AbortError") return { category: "aborted", status };
  if (status === 429) return { category: "rate_limited", status };
  if (status !== null && status >= 500) return { category: "upstream_5xx", status };
  if (
    name === "AuthRetryableFetchError" ||
    name === "AuthUnknownError" ||
    name === "TypeError" ||
    status === 0
  ) {
    return { category: "network_error", status };
  }
  return { category: "unknown", status };
}

/**
 * 「上游不可用」判据：把「连不上认证服务」与「这个浏览器确实没登录」分开。
 *
 * auth-js 把所有网络级失败都归入 AuthRetryableFetchError（status=0），把无法
 * 解析的响应归入 AuthUnknownError；凭据/令牌本身的问题才带 4xx status
 * （AuthSessionMissingError 是 400，AuthApiError 常见 401/403）。
 * 因此 4xx 按未登录处理，可重试类 / 0 / 429 / 5xx / 超时 / 取消 / 裸抛出算上游不可用。
 *
 * 429 特别归为不可用而不是未登录：按未登录处理会把正在用的用户莫名打回登录页，
 * 并让他们以为是自己凭据的问题。
 */
export function isAuthUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { category } = classifyAuthFailure(error);
  return category !== "unknown";
}

/**
 * 运维可见性：认证上游真故障必须留痕。此前 catch 之后日志完全静默，
 * 只能证明「500 与未处理拒绝没了」，无法证明上游是否还在抖。
 *
 * 字段固定为：阶段 / 路径类别 / 故障类别 / 安全状态码。日志格式与本仓既有
 * 约定一致（`console.warn("[标签] 中文说明:", 结构化字段)`），不引入新依赖。
 */
export function logAuthUpstreamFailure(args: {
  stage: string;
  pathCategory: string;
  error: unknown;
}): void {
  const { category, status } = classifyAuthFailure(args.error);
  console.warn("[AuthUpstream] 认证上游请求失败，已按可重试故障处理:", {
    stage: args.stage,
    path: args.pathCategory,
    category,
    status,
  });
}

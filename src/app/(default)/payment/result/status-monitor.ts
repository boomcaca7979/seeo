// ===== 支付结果页状态机 =====
// 订单状态只由 Creem webhook 写入（/api/payment/creem/webhook → completeOrder），
// 本页只能通过 /api/payment/creem/status 读取订单状态，判定规则：
//   1. HTTP 200 不等于支付成功 —— 必须读取真实的 payment_status 字段；
//   2. 查询服务本身的失败（401 / 403 / 5xx / 网络错误）不等于支付失败；
//   3. 自动轮询有上限，每一种终止情况都停止轮询并给出下一步动作。

export const POLL_INTERVAL_MS = 3000;
export const MAX_POLLS = 20;

export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

/** /api/payment/creem/status 返回的订单快照（data 字段） */
export interface OrderSnapshot {
  outTradeNo: string;
  plan: string;
  amount: number;
  currency: string;
  paymentStatus: OrderStatus;
  paidAt: string | null;
  periodEnd: string | null;
}

/** 单次查询的结果类别：区分「支付业务结果」与「查询服务失败」 */
export type CheckOutcome =
  | { kind: "order"; order: OrderSnapshot }
  | { kind: "authRequired" } // 401 会话失效：立即停止轮询，要求重新登录
  | { kind: "forbidden" } // 403 当前账号无权查看该订单
  | { kind: "invalidOrder" } // 400 参数无效 / 404 订单不存在
  | { kind: "serviceError" } // 其它非 2xx、响应无法解析、网络异常
  | { kind: "aborted" }; // 本轮被主动中止（卸载或新一轮替换）

const ORDER_STATUSES: readonly string[] = ["pending", "paid", "failed", "refunded"];

export function isOrderSnapshot(value: unknown): value is OrderSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.outTradeNo === "string" &&
    typeof v.plan === "string" &&
    typeof v.amount === "number" &&
    typeof v.currency === "string" &&
    typeof v.paymentStatus === "string" &&
    ORDER_STATUSES.includes(v.paymentStatus)
  );
}

/** 真实响应 → 结果类别（唯一判定入口；200 但状态字段不可信时不猜测支付结果） */
export function classifyResponse(status: number, payload: unknown): CheckOutcome {
  if (status === 401) return { kind: "authRequired" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 400 || status === 404) return { kind: "invalidOrder" };
  if (status < 200 || status >= 300) return { kind: "serviceError" };
  const data =
    typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
  if (!isOrderSnapshot(data)) return { kind: "serviceError" };
  return { kind: "order", order: data };
}

export interface StatusFetchResponse {
  status: number;
  json: () => Promise<unknown>;
}

export type StatusFetch = (
  input: string,
  init: { cache: "no-store"; signal?: AbortSignal }
) => Promise<StatusFetchResponse>;

export function statusUrl(orderNo: string): string {
  return `/api/payment/creem/status?order=${encodeURIComponent(orderNo)}`;
}

export async function checkOrderStatus(
  orderNo: string,
  fetchImpl: StatusFetch,
  signal: AbortSignal
): Promise<CheckOutcome> {
  if (signal.aborted) return { kind: "aborted" };
  try {
    const res = await fetchImpl(statusUrl(orderNo), { cache: "no-store", signal });
    const payload = await res.json().catch(() => null);
    if (signal.aborted) return { kind: "aborted" };
    return classifyResponse(res.status, payload);
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "serviceError" };
  }
}

export type MonitorPhase = "idle" | "checking" | "polling";

export interface MonitorState {
  phase: MonitorPhase;
  outcome: CheckOutcome | null;
  /** 本轮已完成的自动查询次数（真实计数，供 UI 展示） */
  polls: number;
  /** 达到轮询上限仍未得到确认 */
  exhausted: boolean;
}

export const INITIAL_MONITOR_STATE: MonitorState = {
  phase: "idle",
  outcome: null,
  polls: 0,
  exhausted: false,
};

export interface MonitorOptions {
  fetch: StatusFetch;
  maxPolls?: number;
  intervalMs?: number;
  onChange: (state: MonitorState) => void;
}

export class PaymentStatusMonitor {
  private state: MonitorState = INITIAL_MONITOR_STATE;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  /** 递增轮次编号：陈旧响应不得覆盖新一轮的状态 */
  private round = 0;
  private inflight = false;
  private disposed = false;

  constructor(
    private readonly orderNo: string,
    private readonly opts: MonitorOptions
  ) {}

  getState(): MonitorState {
    return this.state;
  }

  /** 有界自动轮询：最多 maxPolls 次、间隔 intervalMs，任何终止情况立即停止 */
  startAuto(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.setState({ phase: "polling", outcome: null, polls: 0, exhausted: false });
    this.run(true);
  }

  /** 手动重试：只执行一次有界检查，不重新进入自动循环 */
  checkOnce(): void {
    // 会话失效时重试只会反复请求同一个无效会话，必须重新登录
    if (this.disposed || this.inflight || this.state.outcome?.kind === "authRequired") return;
    this.clearTimer();
    this.setState({ phase: "checking", exhausted: false });
    this.run(false);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.controller?.abort();
    this.controller = null;
  }

  private run(loop: boolean): void {
    // 并发保护：重叠定时器与连点重试都不会产生并行请求
    if (this.inflight) return;
    this.inflight = true;
    const round = ++this.round;
    const controller = new AbortController();
    this.controller = controller;
    void checkOrderStatus(this.orderNo, this.opts.fetch, controller.signal).then(
      (outcome) => {
        this.inflight = false;
        if (this.disposed || round !== this.round || outcome.kind === "aborted") return;
        this.settle(outcome, loop);
      },
      () => {
        this.inflight = false;
        if (this.disposed || round !== this.round) return;
        this.settle({ kind: "serviceError" }, loop);
      }
    );
  }

  private settle(outcome: CheckOutcome, loop: boolean): void {
    const maxPolls = this.opts.maxPolls ?? MAX_POLLS;
    const intervalMs = this.opts.intervalMs ?? POLL_INTERVAL_MS;
    const polls = this.state.polls + (loop ? 1 : 0);
    // 仅「未确认的 pending」与「查询服务抖动」继续轮询，且受上限约束
    const keepGoing =
      loop &&
      polls < maxPolls &&
      (outcome.kind === "serviceError" ||
        (outcome.kind === "order" && outcome.order.paymentStatus === "pending"));
    if (keepGoing) {
      this.setState({ outcome, polls });
      this.timer = setTimeout(() => this.run(true), intervalMs);
      return;
    }
    this.setState({
      phase: "idle",
      outcome,
      polls,
      exhausted: loop && polls >= maxPolls,
    });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(patch: Partial<MonitorState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onChange(this.state);
  }
}

export type ResultView =
  | "checking" // 首轮查询进行中
  | "confirming" // 服务端确认 pending，自动轮询仍在进行
  | "paid" // 服务端确认已支付
  | "failed" // 服务端确认支付未完成
  | "refunded" // 服务端确认已退款
  | "processing" // 单次检查后渠道仍未确认
  | "timeout" // 达到轮询上限仍无法确认
  | "authRequired" // 401 登录状态失效
  | "forbidden" // 403 无权查看订单
  | "serviceError" // 查询服务不可用
  | "invalidOrder"; // 400 / 404 订单无效或不存在

export function deriveResultView(state: MonitorState): ResultView {
  const { outcome, phase, exhausted } = state;
  if (!outcome) return "checking";
  if (outcome.kind !== "order") {
    return outcome.kind === "aborted" ? "checking" : outcome.kind;
  }
  switch (outcome.order.paymentStatus) {
    case "paid":
      return "paid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      return phase === "polling" ? "confirming" : exhausted ? "timeout" : "processing";
  }
}

/**
 * 可手动重试的状态。
 * 401 不在此列：会话失效时重试只会反复请求同一个无效会话。
 */
export function canRetry(view: ResultView): boolean {
  return (
    view === "timeout" || view === "processing" || view === "serviceError" || view === "forbidden"
  );
}

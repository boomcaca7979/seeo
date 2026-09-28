"use client";

// ===== Marketing Analytics：客户端追踪 =====
// 遵循现有 Cookie Consent（localStorage "cookie-consent" === "accepted" 才追踪）。
// anonymous_id 存 localStorage；session_id 存 sessionStorage（关闭标签页即新会话）。
// 事件通过 POST /api/analytics/events 上报（fire-and-forget，不阻塞业务）。

const CONSENT_KEY = "cookie-consent";
const CONSENT_EVENT = "seeo:cookie-consent-change";
const AID_KEY = "seeo:aid";
const SID_KEY = "seeo:sid";

export function hasAnalyticsConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function getAnonymousId(): string | null {
  try {
    let aid = window.localStorage.getItem(AID_KEY);
    if (!aid) {
      aid = crypto.randomUUID();
      window.localStorage.setItem(AID_KEY, aid);
    }
    return aid;
  } catch {
    return null;
  }
}

export function getSessionId(): string | null {
  try {
    let sid = window.sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      window.sessionStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return null;
  }
}

/** 当前 URL 上的 UTM 参数（仅着陆请求携带） */
export function readUtmParams(): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
} {
  if (typeof window === "undefined") {
    return { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null };
  }
  const sp = new URLSearchParams(window.location.search);
  return {
    utmSource: sp.get("utm_source"),
    utmMedium: sp.get("utm_medium"),
    utmCampaign: sp.get("utm_campaign"),
    utmContent: sp.get("utm_content"),
    utmTerm: sp.get("utm_term"),
  };
}

export interface TrackProps {
  /** 关联业务对象：audit id / 订单号（用于漏斗去重） */
  refId?: string | number;
  /** 附加白名单短字段（domain、plan 等），服务端二次清洗 */
  [key: string]: unknown;
}

/** 站外 referrer：同域 referrer（站内导航）不算来源，返回 null */
function externalReferrer(): string | null {
  const ref = document.referrer;
  if (!ref) return null;
  try {
    if (new URL(ref).host === window.location.host) return null;
    return ref;
  } catch {
    return null;
  }
}

/** 上报事件；未同意 / 非浏览器环境时静默跳过。返回在途 promise（可 await，也可忽略） */
export function track(event: string, props?: TrackProps): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!hasAnalyticsConsent()) return Promise.resolve();
  const anonymousId = getAnonymousId();
  if (!anonymousId) return Promise.resolve();

  const utm = readUtmParams();
  const { refId, ...rest } = props ?? {};
  const payload = {
    event,
    anonymousId,
    sessionId: getSessionId(),
    path: window.location.pathname,
    referrer: externalReferrer(),
    ...utm,
    ...(refId !== undefined ? { refId: String(refId) } : {}),
    props: Object.keys(rest).length > 0 ? rest : null,
  };

  try {
    return fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => {
        // 分析失败不影响业务
      });
  } catch {
    return Promise.resolve();
  }
}

/** 订阅 consent 变化（同意后无需刷新即可开始追踪） */
export function onConsentGranted(cb: () => void): () => void {
  const handler = () => {
    if (hasAnalyticsConsent()) cb();
  };
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}

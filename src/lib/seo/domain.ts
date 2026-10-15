// ===== 域名规范化（与 /api/audit/*、/api/projects 口径一致） =====
// 单一来源，避免各路由各写一份正则导致口径漂移。

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

/** 去协议、去路径、小写；不合法返回 null */
export function normalizeDomain(raw: string): string | null {
  let d = (raw ?? "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//i, "");
  d = d.replace(/\/.*$/, "");
  if (!d || !DOMAIN_REGEX.test(d)) return null;
  return d;
}

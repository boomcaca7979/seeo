// ===== Owner Console：生产 Analytics 只读读取通道 =====
//
// 解决的问题：本地开发时 TURSO_DATABASE_URL 指向 file:// 隔离库，
// 本地事件不能代表生产网站真实访问数据。
//
// 设计：
//   1. 配置了 TURSO_READONLY_DATABASE_URL + TURSO_READONLY_AUTH_TOKEN 时，
//      老板后台的**读路径**（访客/激活/趋势/客户行为聚合）走生产库只读凭据；
//   2. 绝不把生产可写凭据注入本地进程：只读客户端**不跑 migrate()**、
//      不暴露 run/exec，结构上只能执行 SELECT；
//   3. 只读凭据缺失时回退 getAdapter()（本地隔离库），并如实标记数据来源；
//   4. 写路径不受影响：埋点/导入仍走 getAdapter()（本地写本地，生产写生产），
//      测试事件绝不进生产。
//
// 安全边界（纵深防御）：
//   - 第一层：Turso 侧凭据本身应为只读 token（部署时配置，本模块无法伪造写权限）；
//   - 第二层：本包装器只暴露 get/query，且拒绝非 SELECT 开头或含块注释的语句；
//   - 第三层：所有 SQL 均为代码内常量，任何请求参数只能作为绑定参数传入。

import { getAdapter } from "@/lib/db/migrations";
import type { DBParam } from "@/lib/db/adapter";

export type AnalyticsReadSource = "production-readonly" | "local";

export interface ReadonlyDBAdapter {
  get(sql: string, params?: DBParam[]): Promise<unknown | undefined>;
  query(sql: string, params?: DBParam[]): Promise<unknown[]>;
}

export const ANALYTICS_READ_SOURCE_LABELS: Record<AnalyticsReadSource, string> = {
  "production-readonly": "生产库（只读通道）",
  local: "本地隔离库（非生产数据）",
};

export const ANALYTICS_READ_SOURCE_NOTES: Record<AnalyticsReadSource, string> = {
  "production-readonly":
    "访客/激活/趋势数据来自生产 Turso（TURSO_READONLY_* 只读凭据），与生产网站一致。",
  local:
    "当前读取本地隔离库（file://），数据不代表生产网站；配置 TURSO_READONLY_DATABASE_URL + TURSO_READONLY_AUTH_TOKEN 后切换为生产只读。",
};

/** 只读生产凭据是否已配置（libsql/https 远程地址 + token；file:// 不算） */
export function isProductionReadonlyConfigured(): boolean {
  const url = (process.env.TURSO_READONLY_DATABASE_URL ?? "").trim();
  const token = (process.env.TURSO_READONLY_AUTH_TOKEN ?? "").trim();
  return /^(libsql|https):\/\//i.test(url) && token.length > 0;
}

/** 当前读路径的数据来源（同步判断，仅供 UI 标注） */
export function getAnalyticsReadSource(): AnalyticsReadSource {
  return isProductionReadonlyConfigured() ? "production-readonly" : "local";
}

/**
 * SELECT 守卫：只放行 SELECT / WITH 开头、不含块注释、不含多语句的请求。
 * 代码内常量 SQL 中的行内 `--` 注释不受影响；`/*…*／` 块注释可能伪装语句头，一律拒绝。
 * 字符串字面量内的 `;` 不算语句分隔符（简单引号扫描）。
 */
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trimStart();
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("[readonly-adapter] 拒绝非只读语句：仅允许 SELECT 查询");
  }
  if (trimmed.includes("/*")) {
    throw new Error("[readonly-adapter] 拒绝包含块注释的语句");
  }
  // 多语句守卫：`;` 后仍有非空白内容 → 拒绝（字符串字面量内的 `;` 除外）
  let inString = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'") {
      // '' 是 SQL 字符串内的转义引号
      if (inString && trimmed[i + 1] === "'") i++;
      else inString = !inString;
      continue;
    }
    if (ch === ";" && !inString) {
      if (trimmed.slice(i + 1).trim().length > 0) {
        throw new Error("[readonly-adapter] 拒绝多语句：一次只允许一条查询");
      }
    }
  }
}

/** 将任意 DBAdapter 包装为只读视图（供测试注入内存适配器） */
export function wrapReadonlyAdapter(db: {
  get: (sql: string, params?: DBParam[]) => Promise<unknown | undefined>;
  query: (sql: string, params?: DBParam[]) => Promise<unknown[]>;
}): ReadonlyDBAdapter {
  return {
    async get(sql, params) {
      assertReadOnlySql(sql);
      return db.get(sql, params);
    },
    async query(sql, params) {
      assertReadOnlySql(sql);
      return db.query(sql, params);
    },
  };
}

let productionClient: Promise<ReadonlyDBAdapter> | null = null;

/**
 * 老板后台读路径统一入口：
 *   - 只读凭据已配置 → 生产 Turso 只读客户端（不 migrate、不可写，进程内缓存）；
 *   - 未配置 → 回退 getAdapter()（本地隔离库），来源由 getAnalyticsReadSource() 标注。
 */
export async function getAnalyticsReadAdapter(): Promise<ReadonlyDBAdapter> {
  if (!isProductionReadonlyConfigured()) {
    return wrapReadonlyAdapter(await getAdapter());
  }
  if (!productionClient) {
    productionClient = (async () => {
      const { TursoAdapter } = await import("@/lib/db/turso-adapter");
      const url = (process.env.TURSO_READONLY_DATABASE_URL ?? "").trim();
      const token = (process.env.TURSO_READONLY_AUTH_TOKEN ?? "").trim();
      // 注意：故意不调用 migrate() —— 只读通道绝不执行 DDL
      return wrapReadonlyAdapter(new TursoAdapter(url, token));
    })();
    productionClient.catch(() => {
      // 连接失败时清空缓存，下次调用重试（避免永久缓存失败态）
      productionClient = null;
    });
  }
  return productionClient;
}

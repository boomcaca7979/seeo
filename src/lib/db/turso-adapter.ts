// ===== Turso (libsql) 适配器 =====
// 生产环境使用 Turso 云数据库，接口与 SQLiteAdapter 一致（均为 async）
// 部署时由 getAdapter() 根据 env 自动切换

import {
  createClient,
  type Client,
  type InValue,
  type Transaction,
} from "@libsql/client";
import {
  busyTimeoutPragma,
  DB_BUSY_TIMEOUT_MS,
  userVersionSetSql,
  type DBAdapter,
  type DBParam,
  type MigrationControl,
  type MigrationLock,
} from "./adapter";

/** libsql 的连接形态：普通 Client 或 Transaction（Transaction extends Client），语句 API 相同 */
type LibsqlConnection = Client | Transaction;

/**
 * 绑定到单条 libsql 连接的适配器。
 * 迁移锁用它包住事务对象，保证 DDL 真正跑在持有写锁的连接上。
 */
class LibsqlConnectionAdapter implements DBAdapter {
  constructor(
    protected readonly conn: LibsqlConnection,
    private readonly ownsConnection: boolean
  ) {}

  /**
   * 参数转换（与 SQLiteAdapter 的 spread 语义对齐）：
   * - 命名参数约定：db.run(sql, [{ name: val, ... }])（数组里单个对象）
   *   转为 libsql 的 named args 对象，对应 SQL 里的 @name / :name
   * - 位置参数：db.run(sql, [v1, v2, ...]) 转为数组，对应 SQL 里的 ?
   */
  private toArgs(params?: DBParam[]): InValue[] | Record<string, InValue> {
    if (!params || params.length === 0) return [];
    const first = params[0];
    if (
      params.length === 1 &&
      typeof first === "object" &&
      first !== null &&
      !Array.isArray(first)
    ) {
      return first as Record<string, InValue>;
    }
    return params as InValue[];
  }

  async query(sql: string, params?: DBParam[]): Promise<unknown[]> {
    const result = await this.conn.execute({ sql, args: this.toArgs(params) });
    return result.rows as unknown[];
  }

  async run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const result = await this.conn.execute({ sql, args: this.toArgs(params) });
    return {
      changes: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid ?? 0,
    };
  }

  async get(sql: string, params?: DBParam[]): Promise<unknown | undefined> {
    const result = await this.conn.execute({ sql, args: this.toArgs(params) });
    return result.rows[0] as unknown | undefined;
  }

  async exec(sql: string): Promise<void> {
    await this.conn.executeMultiple(sql);
  }

  close(): void {
    // 事务连接的生死由 MigrationLock.commit/rollback 负责，这里不能提前关掉共享连接
    if (this.ownsConnection) this.conn.close();
  }
}

export class TursoAdapter extends LibsqlConnectionAdapter {
  private readonly url: string;
  private readonly authToken: string;

  constructor(url: string, authToken: string) {
    const client = createClient({ url, authToken });
    super(client, true);
    this.url = url;
    this.authToken = authToken;
    // 启用外键约束（Turso 默认不启用，与本地 SQLite 行为对齐）。
    // 连接级设置：失败（如只读令牌会话拒绝 PRAGMA）不影响查询，显式吞掉避免未处理拒绝。
    client.execute("PRAGMA foreign_keys = ON").catch(() => {});
    // 本地文件库（file://，预览与构建副本走这条路径）默认 busy_timeout=0：
    // 多条连接并发即 SQLITE_BUSY。远端库由服务端串行化写，不预打下这条 PRAGMA
    //（只读令牌会话会被拒），改为在迁移锁的连接上按需设置。
    if (this.isLocalFile) {
      client.execute(busyTimeoutPragma(DB_BUSY_TIMEOUT_MS)).catch(() => {});
    }
  }

  /** `file:` 走本地 SQLite 驱动，独占写锁语义与 better-sqlite3 一致 */
  private get isLocalFile(): boolean {
    return isLocalFileUrl(this.url);
  }

  /**
   * 仅本地文件库提供迁移闸门。远端 Turso 返回 null：调用方回退为直接跑幂等迁移，
   * 不把“多实例共享 PRAGMA 语义不可靠”当成同步手段。
   */
  migrationControl(): MigrationControl | null {
    if (!this.isLocalFile) return null;
    const mainClient = this.conn as Client;
    return {
      readVersion: async () =>
        readUserVersion(await mainClient.execute("PRAGMA user_version")),
      acquireLock: async (): Promise<MigrationLock> => {
        // 迁移跑在**专用连接**上：client.transaction() 会把主 client 的底层连接
        // 置空（下次语句另开一条连接），那样主连接上 constructor 打开的
        // PRAGMA foreign_keys / busy_timeout 就全丢了。所以新建一条只管锁的连接。
        const lockClient = createClient({ url: this.url, authToken: this.authToken });
        // busy_timeout 必须打在“将要 BEGIN 的那条连接”上：
        // 先执行一次 PRAGMA 让该 client 建好连接，transaction() 复用同一条连接发 BEGIN IMMEDIATE。
        await lockClient.execute(busyTimeoutPragma(DB_BUSY_TIMEOUT_MS));
        const tx = await lockClient.transaction("write"); // BEGIN IMMEDIATE
        const closeLockClient = () => {
          try {
            lockClient.close();
          } catch {
            /* 已关闭 */
          }
        };
        return {
          adapter: new LibsqlConnectionAdapter(tx, false),
          getVersion: async () => readUserVersion(await tx.execute("PRAGMA user_version")),
          setVersion: async (version: number) => {
            await tx.execute(userVersionSetSql(version));
          },
          commit: async () => {
            await tx.commit();
            closeLockClient();
          },
          rollback: async () => {
            try {
              await tx.rollback();
            } catch {
              /* SQLite 可能已因语句失败自动回滚 */
            } finally {
              tx.close();
              closeLockClient();
            }
          },
        };
      },
    };
  }
}

function isLocalFileUrl(url: string): boolean {
  return /^file:/i.test(url.trim());
}

function readUserVersion(result: { rows: Record<string, unknown>[] }): number {
  const raw = result.rows[0]?.user_version;
  const num = Number(raw ?? 0);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
}

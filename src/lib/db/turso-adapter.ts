// ===== Turso (libsql) 适配器 =====
// 生产环境使用 Turso 云数据库，接口与 SQLiteAdapter 一致（均为 async）
// 部署时由 getAdapter() 根据 env 自动切换

import { createClient, type Client, type InValue } from "@libsql/client";
import type { DBAdapter, DBParam } from "./adapter";

export class TursoAdapter implements DBAdapter {
  private client: Client;

  constructor(url: string, authToken: string) {
    this.client = createClient({ url, authToken });
    // 启用外键约束（Turso 默认不启用，与本地 SQLite 行为对齐）
    void this.client.execute("PRAGMA foreign_keys = ON");
  }

  /**
   * 参数转换（与 SQLiteAdapter 的 spread 语义对齐）：
   * - 命名参数约定：db.run(sql, [{ name: val, ... }])（数组里单个对象）
   *   转为 libsql 的 named args 对象，对应 SQL 里的 @name / :name
   * - 位置参数：db.run(sql, [v1, v2, ...]) 转为数组，对应 SQL 里的 ?
   */
  private toArgs(
    params?: DBParam[]
  ): InValue[] | Record<string, InValue> {
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
    const result = await this.client.execute({
      sql,
      args: this.toArgs(params),
    });
    return result.rows as unknown[];
  }

  async run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const result = await this.client.execute({
      sql,
      args: this.toArgs(params),
    });
    return {
      changes: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid ?? 0,
    };
  }

  async get(sql: string, params?: DBParam[]): Promise<unknown | undefined> {
    const result = await this.client.execute({
      sql,
      args: this.toArgs(params),
    });
    return result.rows[0] as unknown | undefined;
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  close(): void {
    this.client.close();
  }
}

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

  async query(sql: string, params?: DBParam[]): Promise<unknown[]> {
    const result = await this.client.execute({
      sql,
      args: (params ?? []) as InValue[],
    });
    return result.rows as unknown[];
  }

  async run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const result = await this.client.execute({
      sql,
      args: (params ?? []) as InValue[],
    });
    return {
      changes: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid ?? 0,
    };
  }

  async get(sql: string, params?: DBParam[]): Promise<unknown | undefined> {
    const result = await this.client.execute({
      sql,
      args: (params ?? []) as InValue[],
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

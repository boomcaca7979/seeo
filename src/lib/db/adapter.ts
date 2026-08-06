// ===== 数据库连接抽象层 =====
// 接口统一为 async，适配 Turso（async）和 SQLite（sync 包 async）
// 部署时由 getAdapter() 根据 env 自动切换，业务代码零改动

import type Database from "better-sqlite3";

/** 数据库参数：支持位置参数（数组）或命名参数（对象） */
export type DBParam = string | number | bigint | boolean | null | Record<string, unknown>;

export interface DBAdapter {
  query(sql: string, params?: DBParam[]): Promise<unknown[]>;
  run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  get(sql: string, params?: DBParam[]): Promise<unknown | undefined>;
  exec(sql: string): Promise<void>;
  close(): void;
}

// SQLite 实现（本地开发，sync 包 async）
export class SQLiteAdapter implements DBAdapter {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async query(sql: string, params?: DBParam[]): Promise<unknown[]> {
    return params && params.length > 0
      ? (this.db.prepare(sql).all(...params) as unknown[])
      : (this.db.prepare(sql).all() as unknown[]);
  }

  async run(
    sql: string,
    params?: DBParam[]
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    return params && params.length > 0
      ? this.db.prepare(sql).run(...params)
      : this.db.prepare(sql).run();
  }

  async get(sql: string, params?: DBParam[]): Promise<unknown | undefined> {
    return params && params.length > 0
      ? this.db.prepare(sql).get(...params)
      : this.db.prepare(sql).get();
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

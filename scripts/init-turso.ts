// ===== Turso 数据库初始化脚本 =====
// 用法：npx tsx scripts/init-turso.ts
// 需要环境变量：TURSO_DATABASE_URL, TURSO_AUTH_TOKEN

import { createClient } from "@libsql/client";
import * as fs from "node:fs";
import * as path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("错误：TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN 必须设置");
  process.exit(1);
}

const client = createClient({ url, authToken });
const sqlPath = path.join(__dirname, "migration.sql");
const sql = fs.readFileSync(sqlPath, "utf-8");

async function init() {
  console.log("开始初始化 Turso 数据库...");
  console.log(`连接：${url}`);

  // 按分号拆分 SQL 逐条执行（Turso executeMultiple 不支持所有语句）
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  let success = 0;
  let failed = 0;

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      success++;
    } catch (err) {
      // 忽略 "already exists" 错误（幂等迁移）
      const msg = (err as Error).message;
      if (msg.includes("already exists")) {
        success++;
      } else {
        console.error(`SQL 执行失败：${msg}`);
        console.error(`语句：${stmt.substring(0, 100)}...`);
        failed++;
      }
    }
  }

  console.log(`\n初始化完成：${success} 成功，${failed} 失败`);

  // 验证表数量
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log(`\n数据库表（${tables.rows.length} 个）：`);
  for (const row of tables.rows) {
    console.log(`  - ${row.name}`);
  }

  client.close();
}

init().catch((err) => {
  console.error("初始化失败：", err);
  process.exit(1);
});

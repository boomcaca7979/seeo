// ===== vitest globalSetup：仓库数据库的运行时隔离闸门 =====
// 每条用例都该跑在自己的临时库里（见 src/lib/db/test-db.ts 与
// src/lib/db/migrations.ts 的 refuseImplicitRepoDbInTests）。这里再兜一层：
// 整套测试跑完，仓库内 demo 库 data/seeo.db* 的字节必须与开跑前完全一致。
// 不一致就让整场测试失败——事后只看「当前 hash」永远分不清是测试写的还是
// 用户自己改的，这正是上一轮验收里说不清归属的那个问题。
//
// 预览库（seeo-ui-preview.db*）由运行中的 :3300 预览服务合法持有，可能因页面
// 请求而变，所以这里只记录、不判失败；测试是否碰它由 migrations.ts 的拒绝逻辑
// 与 test-isolation.test.ts 的路径断言保证。

import { hashFile, protectedRepoDbFiles } from "../src/lib/db/test-db";
import path from "node:path";

function fingerprint(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of protectedRepoDbFiles()) map.set(file, hashFile(file));
  return map;
}

const DEMO_DB_PREFIX = path.join("data", "seeo.db");

export default async function dbGuardSetup() {
  const before = fingerprint();

  return async () => {
    const after = fingerprint();
    const changed: string[] = [];
    const noted: string[] = [];

    for (const [file, hash] of after) {
      const prev = before.get(file);
      if (prev === hash) continue;
      const rel = path.relative(process.cwd(), file);
      if (rel.startsWith(DEMO_DB_PREFIX)) changed.push(`${file}: ${prev ?? "ABSENT"} → ${hash}`);
      else noted.push(`${rel}: ${prev ?? "ABSENT"} → ${hash}`);
    }
    for (const file of before.keys()) {
      if (!after.has(file)) {
        const rel = path.relative(process.cwd(), file);
        if (rel.startsWith(DEMO_DB_PREFIX)) changed.push(`${file}: 被删除`);
        else noted.push(`${rel}: 消失`);
      }
    }

    if (noted.length) {
      console.warn(
        "[db-guard] 预览库在本次测试期间发生变化（预览服务合法写入，需人工归因）：\n" +
          noted.join("\n")
      );
    }
    if (changed.length) {
      throw new Error(
        "[db-guard] 测试改动了仓库内的 demo 数据库，隔离失效：\n" +
          changed.join("\n") +
          "\n每条用例必须显式声明临时库路径（SEO_SQLITE_DB_PATH 或 TURSO_DATABASE_URL=file://<tmpdir>/…）。"
      );
    }
  };
}

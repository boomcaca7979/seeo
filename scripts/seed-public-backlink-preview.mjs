// 本地运行时验证用：向隔离数据库注入合成外链快照
// 作用域固定为 public:backlink-checker（与生产一致），仅用于验证缓存命中链路。
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const SCOPE = "public:backlink-checker";

if (!url || !url.startsWith("file:")) {
  throw new Error(`refusing to seed: TURSO_DATABASE_URL must be a local file URL, got ${url}`);
}

const db = createClient({ url, authToken });
const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");

async function seedSummary(domain, s) {
  await db.execute({
    sql: `INSERT INTO backlink_summaries (domain, total_backlinks, referring_domains, domain_rank, dofollow_pct, raw_json, fetched_at, user_id)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(user_id, domain) DO UPDATE SET
            total_backlinks = excluded.total_backlinks,
            referring_domains = excluded.referring_domains,
            domain_rank = excluded.domain_rank,
            dofollow_pct = excluded.dofollow_pct,
            fetched_at = excluded.fetched_at`,
    args: [domain, s.total, s.refDomains, s.rank, s.dofollowPct, nowUtc, SCOPE],
  });
}

async function seedRows(domain, rows) {
  await db.execute({ sql: `DELETE FROM backlinks WHERE domain = ? AND user_id = ?`, args: [domain, SCOPE] });
  for (const r of rows) {
    await db.execute({
      sql: `INSERT INTO backlinks (domain, source_url, anchor, target_url, dofollow, source_rank, first_seen, fetched_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [domain, r.source_url, r.anchor, r.target_url, r.dofollow, r.source_rank, r.first_seen, nowUtc, SCOPE],
    });
  }
}

// A) 正常域名：12 条外链（预览应只给 5 条）
await seedSummary("example.com", { total: 12840, refDomains: 312, rank: 54, dofollowPct: 71.3 });
await seedRows(
  "example.com",
  Array.from({ length: 12 }, (_, i) => ({
    source_url: `https://authority-${i}.example.org/article-${i}`,
    anchor: i % 3 === 0 ? "example resources" : `anchor text ${i}`,
    target_url: `https://example.com/page-${i % 4}`,
    dofollow: i % 3 === 0 ? 0 : 1,
    source_rank: 980 - i * 15,
    first_seen: `2026-0${(i % 8) + 1}-1${i % 9}`,
  }))
);

// B) 有汇总但无外链条目：验证 sampleEmpty 分支
await seedSummary("empty-links.com", { total: 42, refDomains: 9, rank: 18, dofollowPct: 40 });

// C) 未缓存域名（nocache-example.com）：不写入任何数据，用于验证 NOT_CONFIGURED / 未命中路径

const counts = await db.execute({
  sql: `SELECT (SELECT COUNT(*) FROM backlink_summaries WHERE user_id = ?) AS summaries,
               (SELECT COUNT(*) FROM backlinks WHERE user_id = ?) AS rows`,
  args: [SCOPE, SCOPE],
});
console.log("seeded scope:", SCOPE);
console.log("summaries:", counts.rows[0].summaries, "rows:", counts.rows[0].rows);
console.log("fetched_at:", nowUtc);

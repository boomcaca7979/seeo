// ===== G｜社区基地 存储层 =====
// 两个文件，各司其职，都不允许出现平行副本：
//   seo-growth/community-master.csv —— 5 个平台的账号与定位（唯一 Community Master）
//   seo-growth/community-posts.csv  —— 发布记录（唯一发布库）

import fs from "node:fs";
import path from "node:path";
import {
  MASTER_FIELDS,
  POST_FIELDS,
  emptyAccount,
  emptyPost,
  type CommunityAccount,
  type CommunityPost,
} from "./schema.ts";
import { parseCsv, serializeCsv } from "./csv.ts";
import { findDuplicatePostIds, findDuplicatePlatforms, validateAccount, validatePost } from "./validate.ts";
import { readTopics } from "../content/store.ts";

export const COMMUNITY_MASTER_RELATIVE_PATH = "seo-growth/community-master.csv";
export const COMMUNITY_POSTS_RELATIVE_PATH = "seo-growth/community-posts.csv";

export function masterPath(cwd: string = process.cwd()): string {
  return path.join(cwd, COMMUNITY_MASTER_RELATIVE_PATH);
}

export function postsPath(cwd: string = process.cwd()): string {
  return path.join(cwd, COMMUNITY_POSTS_RELATIVE_PATH);
}

function readRecords<T extends Record<string, string>>(
  file: string,
  fields: readonly string[],
  makeEmpty: () => T
): T[] {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  return rows.slice(1).map((cells) => {
    const rec = makeEmpty();
    for (const f of fields) {
      const i = idx.get(f);
      rec[f as keyof T] = (i === undefined ? "" : (cells[i] ?? "")) as T[keyof T];
    }
    return rec;
  });
}

function writeRecords<T extends Record<string, string>>(
  file: string,
  fields: readonly string[],
  records: readonly T[]
): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rows = records.map((r) => fields.map((f) => r[f as keyof T] ?? ""));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeCsv(fields, rows), "utf-8");
  fs.renameSync(tmp, file);
}

export function readAccounts(cwd: string = process.cwd()): CommunityAccount[] {
  return readRecords(masterPath(cwd), MASTER_FIELDS, emptyAccount);
}

export function writeAccounts(accounts: readonly CommunityAccount[], cwd: string = process.cwd()): void {
  writeRecords(masterPath(cwd), MASTER_FIELDS, accounts);
}

export function readPosts(cwd: string = process.cwd()): CommunityPost[] {
  return readRecords(postsPath(cwd), POST_FIELDS, emptyPost);
}

export function writePosts(posts: readonly CommunityPost[], cwd: string = process.cwd()): void {
  writeRecords(postsPath(cwd), POST_FIELDS, posts);
}

/** 该平台的主记录 */
export function accountFor(platform: string, cwd: string = process.cwd()): CommunityAccount | undefined {
  return readAccounts(cwd).find((a) => a.platform === platform);
}

/** 新增发布记录：post_id 不得重复，content_id 必须存在于 F 的主库 */
export function addPost(
  post: CommunityPost,
  opts: { cwd?: string; now?: Date } = {}
): { ok: boolean; reasons?: string[] } {
  const cwd = opts.cwd ?? process.cwd();
  const posts = readPosts(cwd);
  if (posts.some((p) => p.post_id.trim() === post.post_id.trim())) {
    return { ok: false, reasons: [`post_id 已存在：${post.post_id}`] };
  }
  const knownIds = readTopics(cwd).map((t) => t.content_id.trim());
  if (knownIds.length === 0) {
    return { ok: false, reasons: ["F 的 Content Master 为空或不存在，无法校验 content_id"] };
  }
  const issues = validatePost(post, knownIds);
  if (issues.length > 0) return { ok: false, reasons: issues.map((i) => `${i.field}: ${i.message}`) };
  writePosts([...posts, post], cwd);
  return { ok: true };
}

/** 标记发布：补 url 与日期 */
export function markPublished(
  postId: string,
  url: string,
  opts: { cwd?: string; now?: Date; cta?: string } = {}
): { ok: boolean; post?: CommunityPost; reasons?: string[] } {
  const cwd = opts.cwd ?? process.cwd();
  const posts = readPosts(cwd);
  const i = posts.findIndex((p) => p.post_id.trim() === postId.trim());
  if (i < 0) return { ok: false, reasons: [`未找到 post_id=${postId}`] };

  const next: CommunityPost = { ...posts[i] };
  next.status = "Published";
  next.url = url;
  next.published_at = (opts.now ?? new Date()).toISOString().slice(0, 10);
  if (opts.cta) next.cta = opts.cta;

  const knownIds = readTopics(cwd).map((t) => t.content_id.trim());
  const issues = validatePost(next, knownIds);
  if (issues.length > 0) return { ok: false, reasons: issues.map((x) => `${x.field}: ${x.message}`) };

  const list = [...posts];
  list[i] = next;
  writePosts(list, cwd);
  return { ok: true, post: next };
}

/** 追溯：某个 F 主题在各平台发过什么（§17/§21） */
export function postsForContent(contentId: string, cwd: string = process.cwd()): CommunityPost[] {
  return readPosts(cwd).filter((p) => p.content_id.trim() === contentId.trim());
}

/** 某个平台发过哪些主题 */
export function postsForPlatform(platform: string, cwd: string = process.cwd()): CommunityPost[] {
  return readPosts(cwd).filter((p) => p.platform === platform);
}

/** 全量体检（供测试与 CLI doctor） */
export function auditCommunity(cwd: string = process.cwd()): {
  accounts: number;
  posts: number;
  duplicatePlatforms: string[];
  duplicatePostIds: string[];
  accountIssues: Array<{ platform: string; field: string; message: string }>;
  postIssues: Array<{ post_id: string; field: string; message: string }>;
} {
  const accounts = readAccounts(cwd);
  const posts = readPosts(cwd);
  const knownIds = readTopics(cwd).map((t) => t.content_id.trim());
  return {
    accounts: accounts.length,
    posts: posts.length,
    duplicatePlatforms: findDuplicatePlatforms(accounts),
    duplicatePostIds: findDuplicatePostIds(posts),
    accountIssues: accounts.flatMap((a) =>
      validateAccount(a).map((i) => ({ platform: a.platform, field: i.field, message: i.message }))
    ),
    postIssues: posts.flatMap((p) =>
      validatePost(p, knownIds).map((i) => ({ post_id: p.post_id, field: i.field, message: i.message }))
    ),
  };
}

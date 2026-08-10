// ===== 内容检查领域：content_checks =====

import { getAdapter } from "./migrations";

export interface ContentCheckRow {
  id: number;
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  checks_json: string;
  created_at: string;
}

export interface ContentCheckFull extends ContentCheckRow {
  title_suggestions: string | null;
  keyword_density: string | null;
  readability_score: number | null;
  readability_level: string | null;
  word_count_full: number | null;
  heading_structure: string | null;
  internal_links_count: number;
  external_links_count: number;
  images_count: number;
  images_without_alt: number;
  meta_title_length: number | null;
  meta_description_length: number | null;
  first_100_words: string | null;
  top_keywords: string | null;
  content_score: number | null;
  comparison: string | null;
}

function rowToContentCheckFull(row: Record<string, unknown>): ContentCheckFull {
  return {
    id: Number(row.id),
    url: String(row.url),
    keyword: String(row.keyword),
    score: Number(row.score),
    word_count: Number(row.word_count),
    density: Number(row.density),
    checks_json: String(row.checks_json),
    created_at: String(row.created_at),
    title_suggestions: row.title_suggestions ? String(row.title_suggestions) : null,
    keyword_density: row.keyword_density ? String(row.keyword_density) : null,
    readability_score: row.readability_score !== null && row.readability_score !== undefined ? Number(row.readability_score) : null,
    readability_level: row.readability_level ? String(row.readability_level) : null,
    word_count_full: row.word_count_full !== null && row.word_count_full !== undefined ? Number(row.word_count_full) : null,
    heading_structure: row.heading_structure ? String(row.heading_structure) : null,
    internal_links_count: row.internal_links_count !== null && row.internal_links_count !== undefined ? Number(row.internal_links_count) : 0,
    external_links_count: row.external_links_count !== null && row.external_links_count !== undefined ? Number(row.external_links_count) : 0,
    images_count: row.images_count !== null && row.images_count !== undefined ? Number(row.images_count) : 0,
    images_without_alt: row.images_without_alt !== null && row.images_without_alt !== undefined ? Number(row.images_without_alt) : 0,
    meta_title_length: row.meta_title_length !== null && row.meta_title_length !== undefined ? Number(row.meta_title_length) : null,
    meta_description_length: row.meta_description_length !== null && row.meta_description_length !== undefined ? Number(row.meta_description_length) : null,
    first_100_words: row.first_100_words ? String(row.first_100_words) : null,
    top_keywords: row.top_keywords ? String(row.top_keywords) : null,
    content_score: row.content_score !== null && row.content_score !== undefined ? Number(row.content_score) : null,
    comparison: row.comparison ? String(row.comparison) : null,
  };
}

export async function addContentCheck(userId: string, params: {
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  checks_json: string;
  title_suggestions?: string | null;
  keyword_density?: string | null;
  readability_score?: number | null;
  readability_level?: string | null;
  word_count_full?: number | null;
  heading_structure?: string | null;
  internal_links_count?: number;
  external_links_count?: number;
  images_count?: number;
  images_without_alt?: number;
  meta_title_length?: number | null;
  meta_description_length?: number | null;
  first_100_words?: string | null;
  top_keywords?: string | null;
  content_score?: number | null;
  comparison?: string | null;
}): Promise<ContentCheckFull> {
  const db = await getAdapter();
  const info = await db.run(`
    INSERT INTO content_checks (
      url, keyword, score, word_count, density, checks_json,
      title_suggestions, keyword_density, readability_score, readability_level,
      word_count_full, heading_structure, internal_links_count, external_links_count,
      images_count, images_without_alt, meta_title_length, meta_description_length,
      first_100_words, top_keywords, content_score, comparison, user_id
    ) VALUES (
      @url, @keyword, @score, @word_count, @density, @checks_json,
      @title_suggestions, @keyword_density, @readability_score, @readability_level,
      @word_count_full, @heading_structure, @internal_links_count, @external_links_count,
      @images_count, @images_without_alt, @meta_title_length, @meta_description_length,
      @first_100_words, @top_keywords, @content_score, @comparison, @user_id
    )
  `, [{
    url: params.url,
    keyword: params.keyword,
    score: params.score,
    word_count: params.word_count,
    density: params.density,
    checks_json: params.checks_json,
    title_suggestions: params.title_suggestions ?? null,
    keyword_density: params.keyword_density ?? null,
    readability_score: params.readability_score ?? null,
    readability_level: params.readability_level ?? null,
    word_count_full: params.word_count_full ?? null,
    heading_structure: params.heading_structure ?? null,
    internal_links_count: params.internal_links_count ?? 0,
    external_links_count: params.external_links_count ?? 0,
    images_count: params.images_count ?? 0,
    images_without_alt: params.images_without_alt ?? 0,
    meta_title_length: params.meta_title_length ?? null,
    meta_description_length: params.meta_description_length ?? null,
    first_100_words: params.first_100_words ?? null,
    top_keywords: params.top_keywords ?? null,
    content_score: params.content_score ?? null,
    comparison: params.comparison ?? null,
    user_id: userId,
  }]);
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ?`, [info.lastInsertRowid]) as Record<string, unknown>;
  return rowToContentCheckFull(row);
}

export async function listContentChecks(userId: string, limit = 10): Promise<ContentCheckRow[]> {
  const db = await getAdapter();
  const rows = await db.query(`
    SELECT * FROM content_checks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `, [userId, limit]) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    url: String(r.url),
    keyword: String(r.keyword),
    score: Number(r.score),
    word_count: Number(r.word_count),
    density: Number(r.density),
    checks_json: String(r.checks_json),
    created_at: String(r.created_at),
  }));
}

export async function getContentCheckById(userId: string, id: number): Promise<ContentCheckRow | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? {
    id: Number(row.id),
    url: String(row.url),
    keyword: String(row.keyword),
    score: Number(row.score),
    word_count: Number(row.word_count),
    density: Number(row.density),
    checks_json: String(row.checks_json),
    created_at: String(row.created_at),
  } : null;
}

export async function getContentCheckFull(userId: string, id: number): Promise<ContentCheckFull | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM content_checks WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
  return row ? rowToContentCheckFull(row) : null;
}

export async function listContentChecksFull(userId: string, limit = 10, urlFilter?: string): Promise<ContentCheckFull[]> {
  const db = await getAdapter();
  const rows = urlFilter
    ? await db.query(`SELECT * FROM content_checks WHERE user_id = ? AND url = ? ORDER BY created_at DESC LIMIT ?`, [userId, urlFilter, limit]) as Record<string, unknown>[]
    : await db.query(`SELECT * FROM content_checks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]) as Record<string, unknown>[];
  return rows.map(rowToContentCheckFull);
}

export async function getPreviousContentCheck(userId: string, url: string, excludeId: number): Promise<ContentCheckFull | null> {
  const db = await getAdapter();
  const row = await db.get(`
    SELECT * FROM content_checks
    WHERE url = ? AND id < ? AND user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `, [url, excludeId, userId]) as Record<string, unknown> | undefined;
  return row ? rowToContentCheckFull(row) : null;
}

export async function updateContentCheckComparison(userId: string, id: number, comparison: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`UPDATE content_checks SET comparison = ? WHERE id = ? AND user_id = ?`, [comparison, id, userId]);
}

/** 累计检测次数（content_checks 总数） */
export async function countContentChecks(userId: string): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(`SELECT COUNT(*) AS c FROM content_checks WHERE user_id = ?`, [userId]) as { c: number };
  return row.c;
}

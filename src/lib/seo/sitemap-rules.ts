// ===== sitemap 判定规则（产品层与运营层共享的唯一来源）=====
//
// 为什么有这个文件：
//   2026-10-02 事故（Filebase）—— 只请求 `https://<site>/sitemap.xml` 拿到 404，就判定
//   「站点没有 sitemap」并发信；而对方 `robots.txt` 明确声明了 `Sitemap: .../sitemap-index.xml`。
//   根因是**同一条规则在几处各写了一份**，且实现只探了一个路径。
//   现在：判定规则与判定函数**只有这一份**，
//     - 产品审计引擎：`src/lib/seo/site-reports.ts`（发现）与 `src/lib/seo/audit-checks.ts`（出结论）
//     - 运营层：`src/lib/operations/index.ts`（`nlpm run ops -- doctor/today` 的提示与自检项）
//   都从这里 import / re-export，不得各自再写一份。
//
// 依赖约束（重要）：本文件**不得 import 任何东西**。
//   运营层是用 Node 直跑 TS（`node --no-warnings scripts/ops.mts`），
//   带 `@/` 别名的依赖会让它无法执行；同时这样也保证它是纯函数、可在任意环境复用。

/** robots.txt 未声明 sitemap 时，按顺序探测的常见入口（相对 origin 的路径） */
export const SITEMAP_FALLBACK_PATHS: readonly string[] = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/wp-sitemap.xml",
  "/sitemap/",
];

/**
 * 判定「站点没有 sitemap」必须依次走完的步骤。
 * 任何一步发现可访问的 sitemap 即停止，且**不得**判定为 NO SITEMAP。
 */
export const SITEMAP_VERIFICATION_STEPS: readonly string[] = [
  "1. 请求 /robots.txt（跟随跳转，取最终响应体）",
  "2. 提取其中所有 `Sitemap:` 行（大小写不敏感，可有多条）",
  "3. 逐个请求声明出来的 sitemap URL，记录 HTTP 状态",
  "4. 若响应是 sitemapindex，继续抓取至少一个子 sitemap，确认可解析出 URL",
  `5. robots.txt 未声明时，才走兜底：依次检查常见入口（${SITEMAP_FALLBACK_PATHS.join("、")}）与站点 HTML 的 \`<link rel="sitemap">\``,
  "6. 只有以上全部确认不存在可发现的 sitemap，才能标记 NO SITEMAP",
];

/**
 * 由上述步骤导出的判定红线。
 * `/sitemap.xml` 返回 404 只说明「这个路径没有文件」，**不能**推出「站点没有 sitemap」。
 */
export const SITEMAP_VERDICT_RULES: readonly string[] = [
  "/sitemap.xml 返回 404 只说明该路径没有文件，**不能**推出「站点没有 sitemap」——先读 robots.txt",
  "robots.txt 声明了 Sitemap: 但该 URL 不可达（4xx/5xx 或无响应）→ 记 sitemap-invalid，不是 no-sitemap",
  "robots.txt 未声明、兜底入口与 HTML <link rel=sitemap> 也查不到 → 才能记 no-sitemap，并写下实际证据",
  "核验必须发生在写 specific_issue 之前；写不出 robots.txt 的实际内容，就不算核验过",
];

/** 与 SITEMAP_VERDICT_RULES 同一层的硬约束：核验不通过就不发信 */
export const PROSPECTING_VERIFICATION_RULE =
  "任何 outreach 指出的问题都必须先实测核验；sitemap 类必须走完 SITEMAP_VERIFICATION_STEPS。核验不通过就不发信。";

// ---------- 判定结果 ----------

export type SitemapVerdict = "found" | "sitemap-invalid" | "no-sitemap";

export interface SitemapClassification {
  verdict: SitemapVerdict;
  /** 判定依据（人类可读，用于展示与测试断言，不要用它做逻辑分支） */
  reason: string;
}

// ---------- 纯函数：解析与判定 ----------

/**
 * 从 robots.txt 文本里提取所有 `Sitemap:` 声明。
 * 大小写不敏感；`#` 之后视为注释；同一份 robots.txt 可以有多条。
 */
export function extractSitemapDeclarations(robotsText: string | null | undefined): string[] {
  if (!robotsText) return [];
  const urls: string[] = [];
  for (const raw of robotsText.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (m) urls.push(m[1]);
  }
  return urls;
}

/** robots.txt 未声明时，按顺序探测的候选 URL（绝对地址） */
export function buildFallbackCandidates(origin: string): string[] {
  const base = origin.replace(/\/+$/, "");
  return SITEMAP_FALLBACK_PATHS.map((p) => `${base}${p}`);
}

/**
 * 从 HTML 里找 `<link rel="sitemap" href="...">`。
 * rel 可能是多值（如 `rel="sitemap alternate"`），属性顺序不限，引号可单可双。
 * 返回原始 href（可能是相对路径，由调用方解析），找不到返回 null。
 */
export function detectSitemapLinkTag(html: string | null | undefined): string | null {
  if (!html) return null;
  // 只扫 <head> 之前的部分（没有 </head> 就扫前 100KB），避免把正文里的 <link> 误当声明
  const headEnd = html.search(/<\/head>/i);
  const scope = headEnd >= 0 ? html.slice(0, headEnd + 7) : html.slice(0, 100_000);
  for (const tag of scope.matchAll(/<link\b[^>]*>/gi)) {
    const raw = tag[0];
    const rel = attrOf(raw, "rel");
    if (!rel) continue;
    const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.includes("sitemap")) continue;
    const href = attrOf(raw, "href");
    if (href) return href;
  }
  return null;
}

/** 读取标签里的属性值（容忍单引号 / 双引号 / 无引号） */
function attrOf(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim() || null;
}

export interface SitemapClassificationInput {
  /** 是否已找到可访问且结构有效的 sitemap（urlset 或 sitemapindex） */
  found: boolean;
  /** robots.txt 声明的 sitemap URL（判定 sitemap-invalid 的依据） */
  declaredUrls: readonly string[];
  /** 首个有响应的候选 sitemap 的 HTTP 状态（无响应为 null） */
  firstResponseStatus?: number | null;
  /** 有响应但 XML 结构无效 */
  xmlInvalid?: boolean;
}

/**
 * 唯一的 sitemap 判定函数。
 * 产品审计规则与运营层提示都必须走这里，不得在各处重写 if/else。
 */
export function classifySitemap(input: SitemapClassificationInput): SitemapClassification {
  const declared = input.declaredUrls.length > 0;

  if (input.found) {
    return {
      verdict: "found",
      reason: declared
        ? "robots.txt 声明的 sitemap 可访问且结构有效"
        : "robots.txt 未声明，但常见入口或 HTML <link rel=sitemap> 发现了可访问的 sitemap",
    };
  }

  if (declared) {
    const status = input.firstResponseStatus ?? null;
    if (status !== null && status >= 400) {
      return {
        verdict: "sitemap-invalid",
        reason: `robots.txt 声明的 sitemap 返回 HTTP ${status}（已声明但不可达）`,
      };
    }
    if (status === null) {
      return {
        verdict: "sitemap-invalid",
        reason: "robots.txt 声明的 sitemap 无法获取（网络错误或超时）",
      };
    }
    return {
      verdict: "sitemap-invalid",
      reason: "sitemap 有响应但不包含有效的 urlset / sitemapindex 结构",
    };
  }

  return {
    verdict: "no-sitemap",
    reason:
      "robots.txt 未声明 sitemap，且常见入口与 HTML <link rel=sitemap> 均未发现可访问的 sitemap",
  };
}

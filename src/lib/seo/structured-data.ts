// ===== JSON-LD 结构化数据解析与校验（Audit Engine V2） =====
// 区分五种状态：Valid / Potential Issue / Invalid / Malformed / No Structured Data
// 注意：@graph 节点继承根节点 @context（JSON-LD 规范），不再机械地把
// graph 节点缺 @context 当作问题 —— 修复 V1 的误报。

import type { LText } from "./audit-ltext";

export type StructuredDataStatus =
  | "none"
  | "valid"
  | "potential-issue"
  | "invalid"
  | "malformed";

export type StructuredDataFindingKind =
  | "malformed" // JSON 语法错误，无法解析
  | "invalid-node" // 节点不是对象
  | "graph-not-array" // @graph 不是数组
  | "missing-type" // 节点缺少 @type
  | "missing-context" // 根节点缺少 @context
  | "missing-id" // @graph 节点缺少 @id（建议级）
  | "missing-fields" // 常见 Schema 基础字段缺失
  | "duplicate-type"; // 重复 Schema 类型

export interface StructuredDataFinding {
  kind: StructuredDataFindingKind;
  message: LText;
  /** 第几个 JSON-LD 块（0 起） */
  blockIndex: number;
  nodeType?: string;
}

export interface StructuredDataReport {
  status: StructuredDataStatus;
  blockCount: number;
  /** 全部节点 @type（含 @graph 内节点） */
  nodeTypes: string[];
  findings: StructuredDataFinding[];
}

/** 常见 Schema 类型 → 基础必填字段（缺失视为潜在问题） */
const COMMON_SCHEMA_FIELDS: Record<string, string[]> = {
  Organization: ["name", "url"],
  WebSite: ["name", "url"],
  WebPage: ["name"],
  Article: ["headline", "datePublished", "author"],
  BlogPosting: ["headline", "datePublished", "author"],
  NewsArticle: ["headline", "datePublished", "author"],
  Product: ["name"],
  Review: ["itemReviewed", "author", "reviewRating"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Event: ["name", "startDate", "location"],
};

function nodeTypesOf(obj: Record<string, unknown>): string[] {
  const t = obj["@type"];
  if (Array.isArray(t)) return t.map(String);
  return t ? [String(t)] : [];
}

function finding(
  kind: StructuredDataFindingKind,
  blockIndex: number,
  message: LText,
  nodeType?: string
): StructuredDataFinding {
  return { kind, message, blockIndex, nodeType };
}

function checkNode(
  node: unknown,
  blockIndex: number,
  findings: StructuredDataFinding[],
  nodeTypes: string[],
  inGraph: boolean
): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    if (node !== null && typeof node !== "object") {
      findings.push(
        finding("invalid-node", blockIndex, {
          en: "A JSON-LD node is not a valid object",
          zh: "JSON-LD 节点不是有效对象",
        })
      );
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  const types = nodeTypesOf(obj);
  nodeTypes.push(...types);

  // @graph 处理：数组内逐节点校验（@context 由根节点继承，不要求每个 graph 节点携带）
  if ("@graph" in obj) {
    const graph = obj["@graph"];
    if (!Array.isArray(graph)) {
      findings.push(
        finding("graph-not-array", blockIndex, {
          en: "JSON-LD @graph is present but not an array",
          zh: "JSON-LD @graph 存在但不是数组",
        })
      );
    } else {
      for (const g of graph) checkNode(g, blockIndex, findings, nodeTypes, true);
    }
  }

  if (types.length === 0 && !("@graph" in obj)) {
    findings.push(
      finding("missing-type", blockIndex, {
        en: "A JSON-LD node is missing @type",
        zh: "JSON-LD 节点缺少 @type",
      })
    );
    return;
  }

  // 根节点（非 @graph 子节点）需要 @context
  if (!inGraph && !obj["@context"]) {
    findings.push(
      finding("missing-context", blockIndex, {
        en: "Top-level JSON-LD node is missing @context",
        zh: "顶层 JSON-LD 节点缺少 @context",
      })
    );
  }

  // @graph 节点建议携带 @id（唯一标识，利于实体关联）
  if (inGraph && !obj["@id"]) {
    findings.push(
      finding("missing-id", blockIndex, {
        en: `@graph node of type ${types[0] ?? "unknown"} has no @id`,
        zh: `@graph 节点（类型 ${types[0] ?? "未知"}）缺少 @id`,
      }, types[0])
    );
  }

  // 常见 Schema 基础字段
  for (const t of types) {
    const required = COMMON_SCHEMA_FIELDS[t];
    if (!required) continue;
    const missing = required.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === "");
    if (missing.length > 0) {
      findings.push(
        finding("missing-fields", blockIndex, {
          en: `Schema type "${t}" is missing common fields: ${missing.join(", ")}`,
          zh: `Schema 类型 "${t}" 缺少常见基础字段：${missing.join("、")}`,
        }, t)
      );
    }
  }
}

/** 解析并校验一个页面的全部 JSON-LD 块 */
export function analyzeStructuredData(blocks: string[]): StructuredDataReport {
  if (blocks.length === 0) {
    return { status: "none", blockCount: 0, nodeTypes: [], findings: [] };
  }

  const findings: StructuredDataFinding[] = [];
  const nodeTypes: string[] = [];
  // @type → 出现次数（跨块，用于重复 Schema 检测）
  const typeBlocks = new Map<string, Set<number>>();

  for (let i = 0; i < blocks.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blocks[i]);
    } catch {
      findings.push(
        finding("malformed", i, {
          en: "A JSON-LD block contains malformed JSON and cannot be parsed",
          zh: "一个 JSON-LD 块的 JSON 格式错误，无法解析",
        })
      );
      continue;
    }
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const n of nodes) {
      checkNode(n, i, findings, nodeTypes, false);
      if (n && typeof n === "object" && !Array.isArray(n)) {
        const types = nodeTypesOf(n as Record<string, unknown>);
        const graph = (n as Record<string, unknown>)["@graph"];
        const graphTypes = Array.isArray(graph)
          ? graph
              .filter((g) => g && typeof g === "object" && !Array.isArray(g))
              .flatMap((g) => nodeTypesOf(g as Record<string, unknown>))
          : [];
        for (const t of [...types, ...graphTypes]) {
          const set = typeBlocks.get(t) ?? new Set<number>();
          set.add(i);
          typeBlocks.set(t, set);
        }
      }
    }
  }

  // 重复 Schema：同一 @type 出现在多个 JSON-LD 块
  for (const [t, blocksSet] of typeBlocks.entries()) {
    if (blocksSet.size > 1) {
      findings.push(
        finding("duplicate-type", -1, {
          en: `Schema type "${t}" is declared in ${blocksSet.size} separate JSON-LD blocks (possible duplicate)`,
          zh: `Schema 类型 "${t}" 在 ${blocksSet.size} 个 JSON-LD 块中重复声明（疑似重复标记）`,
        }, t)
      );
    }
  }

  const status: StructuredDataStatus = findings.some((f) => f.kind === "malformed")
    ? "malformed"
    : findings.some((f) => f.kind === "invalid-node" || f.kind === "graph-not-array" || f.kind === "missing-type")
      ? "invalid"
      : findings.length > 0
        ? "potential-issue"
        : "valid";

  return { status, blockCount: blocks.length, nodeTypes, findings };
}

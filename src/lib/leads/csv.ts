// ===== 最小 CSV 解析 / 序列化（RFC 4180 兼容）=====
// 只依赖标准库。字段可含逗号、引号与换行（notes 经常有），故不能简单 split(",")。

/** 解析 CSV 文本 → 行数组（每行是字段数组）。支持引号包裹与 "" 转义 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // \r\n 或裸 \r
      if (text[i + 1] === "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // 收尾：未闭合的行也要落盘（field 非空或 row 非空）
  if (field.length > 0 || row.length > 0 || text.endsWith(",")) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** 需要引号的条件：含分隔符、引号、换行，或首尾有空格 */
function needsQuotes(v: string): boolean {
  return /[",\r\n]/.test(v) || v !== v.trim();
}

export function escapeCsvField(v: string): string {
  const value = v ?? "";
  if (!needsQuotes(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** 序列化：始终输出表头 + 数据行，行尾用 \n */
export function serializeCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines: string[] = [header.map(escapeCsvField).join(",")];
  for (const row of rows) {
    const cells = header.map((_, idx) => escapeCsvField(row[idx] ?? ""));
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

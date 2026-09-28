// ===== F｜Content Master 的 CSV 读写（RFC 4180 兼容）=====
// 说明：这是 content 模块自带的极小实现。刻意不复用 E（src/lib/leads/csv.ts），
// 因为本轮明确要求不改动 E；两个模块各自独立，互不耦合。
// 字段可含逗号 / 引号 / 换行（example 与 notes 经常有）。

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

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
  if (field.length > 0 || row.length > 0 || text.endsWith(",")) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function needsQuotes(v: string): boolean {
  return /[",\r\n]/.test(v) || v !== v.trim();
}

export function escapeCsvField(v: string): string {
  const value = v ?? "";
  if (!needsQuotes(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines: string[] = [header.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(header.map((_, idx) => escapeCsvField(row[idx] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

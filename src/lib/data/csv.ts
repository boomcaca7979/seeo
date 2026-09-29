// ===== 共享 CSV 工具（RFC 4180 兼容）=====
// 背景：E/F/G 各自带了一份同实现的极小副本（当时被要求不改动已完成阶段）。
// 本模块是**新的**共享出口：此后新增模块一律用这里，不再增加第 4 份副本。
// 待允许改动 E/F/G 时，可把它们的副本替换为 re-export 本模块，即可收敛为一份。

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

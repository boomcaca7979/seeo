// ===== G｜CSV 读写（RFC 4180 兼容）=====
// 说明：content（F）与 leads（E）各自带了一份极小实现；本轮被要求不改动 E/F，
// 因此 G 同样自带一份。**这是已知重复**，等允许改 E/F 时应统一抽到共享模块。

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

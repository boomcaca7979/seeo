// ===== 关键词 CSV 口径契约测试（DEF-03）=====
import { describe, expect, it } from "vitest";
import { KEYWORD_CSV_HEADERS, buildKeywordCsv, buildKeywordCsvContext } from "./keyword-csv";

const ctx = buildKeywordCsvContext({
  location: "中国",
  device: "desktop", // expand 对外口径，必须归一化成 PC
  language: "zh-cn",
  fetchedAt: "2026-10-30T05:01:53.039Z",
  metricsSource: "dataforseo",
});

describe("KEYWORD_CSV_HEADERS", () => {
  it("既有字段在前，五项口径追加在后且顺序固定", () => {
    expect([...KEYWORD_CSV_HEADERS]).toEqual([
      "keyword",
      "origins",
      "intent",
      "searchVolume",
      "cpc",
      "market",
      "device",
      "language",
      "collected_at",
      "metrics_source",
    ]);
  });
});

describe("buildKeywordCsvContext", () => {
  it("device 归一化为页面口径", () => {
    expect(ctx.device).toBe("PC");
    expect(buildKeywordCsvContext({ location: "美国", device: "mobile" }).device).toBe("移动端");
  });

  it("未知项保持 null（导出时为空字符串，不编造）", () => {
    const c = buildKeywordCsvContext({ location: "美国", device: "PC" });
    expect(c.language).toBeNull();
    expect(c.collectedAt).toBeNull();
    expect(c.metricsSource).toBeNull();
  });
});

describe("buildKeywordCsv", () => {
  it("缺失指标导出为 null（空单元格），不用 0 冒充", () => {
    const { dataRows } = buildKeywordCsv(
      [{ keyword: "seo", origins: ["seed", "related"], intentLabel: "信息型", searchVolume: null, cpc: null }],
      ctx
    );
    const row = dataRows[0];
    expect(row[0]).toBe("seo");
    expect(row[1]).toBe("seed|related");
    expect(row[2]).toBe("信息型");
    expect(row[3]).toBeNull();
    expect(row[4]).toBeNull();
  });

  it("真实数值与 CPC 保留两位小数", () => {
    const { dataRows } = buildKeywordCsv(
      [{ keyword: "seo", origins: ["seed"], intentLabel: "商业型", searchVolume: 12100, cpc: 1.5 }],
      ctx
    );
    expect(dataRows[0][3]).toBe(12100);
    expect(dataRows[0][4]).toBe("1.50");
  });

  it("五个口径列写入真实上下文，未知项为空字符串", () => {
    const ready = buildKeywordCsv(
      [{ keyword: "seo", origins: ["seed"], intentLabel: "信息型", searchVolume: null, cpc: null }],
      ctx
    );
    expect(ready.dataRows[0].slice(5)).toEqual(["中国", "PC", "zh-cn", "2026-10-30T05:01:53.039Z", "dataforseo"]);

    const unknown = buildKeywordCsv(
      [{ keyword: "seo", origins: ["seed"], intentLabel: "信息型", searchVolume: null, cpc: null }],
      buildKeywordCsvContext({ location: "", device: "PC" })
    );
    expect(unknown.dataRows[0].slice(5)).toEqual(["", "PC", "", "", ""]);
  });

  it("collected_at 只用传入的真实采集时间，不取当前时间", () => {
    const before = new Date().toISOString();
    const { dataRows } = buildKeywordCsv(
      [{ keyword: "seo", origins: ["seed"], intentLabel: "信息型", searchVolume: null, cpc: null }],
      buildKeywordCsvContext({ location: "中国", device: "PC" })
    );
    expect(dataRows[0][8]).toBe("");
    expect(String(dataRows[0][8])).not.toBe(before);
  });

  it("行数与输入一致，表头与数据列数一致", () => {
    const rows = [
      { keyword: "a", origins: ["seed"], intentLabel: "信息型", searchVolume: 1, cpc: 1 },
      { keyword: "b", origins: ["related"], intentLabel: "商业型", searchVolume: null, cpc: null },
    ];
    const { headers, dataRows } = buildKeywordCsv(rows, ctx);
    expect(dataRows).toHaveLength(2);
    for (const r of dataRows) expect(r).toHaveLength(headers.length);
  });
});

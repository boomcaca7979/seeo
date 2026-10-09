// ===== 广告收入 CSV / 手工导入解析测试 =====
// 设计约束（任务第五条）：广告平台**没有**可用 API 时的唯一合法录入途径，
// 不允许为了拿到数据硬做脆弱 scraping。因此解析必须严格：
//   - 非法行**逐行拒绝并给出原因**（不能静默丢弃，也不能整批失败）；
//   - 金额按主单位 → 分（Math.round(v * 100)），与库内 revenue_cents 一致；
//   - 日期必须是**真实日历日**（2026-02-31 这种要拒绝）。

import { describe, it, expect } from "vitest";
import { isRealDate, parseAdRevenueCsv } from "./manual";

describe("isRealDate：真实日历日校验", () => {
  it("合法日期", () => {
    expect(isRealDate("2026-10-01")).toBe(true);
    expect(isRealDate("2024-02-29")).toBe(true); // 闰年
    expect(isRealDate("2026-12-31")).toBe(true);
  });

  it("格式不符或日历不存在 → false", () => {
    expect(isRealDate("2026-2-1")).toBe(false); // 必须补零
    expect(isRealDate("2026/10/01")).toBe(false);
    expect(isRealDate("2026-02-31")).toBe(false); // 2 月没有 31 日
    expect(isRealDate("2026-02-29")).toBe(false); // 非闰年
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });
});

describe("parseAdRevenueCsv：正常解析", () => {
  it("标准 5 列 → 金额转分，展示/点击取整", () => {
    const { rows, errors } = parseAdRevenueCsv(
      ["date,revenue,impressions,clicks,currency", "2026-10-01,12.34,12000,45,USD"].join("\n")
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        date: "2026-10-01",
        revenueCents: 1234,
        impressions: 12000,
        clicks: 45,
        currency: "USD",
      },
    ]);
  });

  it("多行 + 空行跳过 + 表头大小写不敏感", () => {
    const { rows, errors } = parseAdRevenueCsv(
      [
        "Date,Revenue,Impressions,Clicks,Currency",
        "2026-10-01,10,1000,10,USD",
        "",
        "2026-10-02,20,2000,20,usd",
      ].join("\n")
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(rows.map((r) => r.revenueCents)).toEqual([1000, 2000]);
    expect(rows[1].currency).toBe("USD");
  });

  it("兼容 AdSense 导出的 estimated_earnings / 中文表头 / ¥ 前缀 / 千分位", () => {
    const withEarnings = parseAdRevenueCsv(
      ["date,estimated_earnings,impressions,clicks", "2026-10-01,1,500,5"].join("\n")
    );
    expect(withEarnings.errors).toEqual([]);
    expect(withEarnings.rows[0].revenueCents).toBe(100);
    expect(withEarnings.rows[0].currency).toBe("USD"); // 缺 currency 列 → 默认 USD

    const chinese = parseAdRevenueCsv(
      ["日期,收入,展示,点击,币种", '2026-10-01,"¥1,234.56",10000,3,CNY'].join("\n")
    );
    expect(chinese.errors).toEqual([]);
    expect(chinese.rows[0]).toEqual({
      date: "2026-10-01",
      revenueCents: 123456,
      impressions: 10000,
      clicks: 3,
      currency: "CNY",
    });
  });

  it("制表符分隔也可（从表格软件复制粘贴）", () => {
    const { rows, errors } = parseAdRevenueCsv("date\trevenue\timpressions\tclicks\n2026-10-01\t5\t100\t2");
    expect(errors).toEqual([]);
    expect(rows[0].revenueCents).toBe(500);
  });

  it("带引号的字段（RFC 4180）", () => {
    const { rows, errors } = parseAdRevenueCsv(
      ['date,revenue,clicks,currency', '"2026-10-01","12.34","45","USD"'].join("\n")
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      date: "2026-10-01",
      revenueCents: 1234,
      impressions: 0,
      clicks: 45,
      currency: "USD",
    });
  });
});

describe("parseAdRevenueCsv：逐行拒绝（不静默丢数据）", () => {
  it("日期非法 → 报行号 + 原因，且不写入该行", () => {
    const { rows, errors } = parseAdRevenueCsv(
      ["date,revenue", "2026-10-01,1", "2026-02-31,2", "2026-10-03,3"].join("\n")
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].reason).toContain("2026-02-31");
    expect(errors[0].reason).toContain("真实日期");
  });

  it("revenue 负数 / 非数字 → 拒绝", () => {
    const { rows, errors } = parseAdRevenueCsv(
      ["date,revenue", "2026-10-01,-1", "2026-10-02,abc", "2026-10-03,0"].join("\n")
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-10-03");
    expect(errors.map((e) => e.line)).toEqual([1, 2]);
    expect(errors[0].reason).toContain("revenue 非法");
  });

  it("impressions / clicks 为负或非整数文本 → 拒绝", () => {
    const { errors } = parseAdRevenueCsv(
      ["date,revenue,impressions,clicks", "2026-10-01,1,-5,10", "2026-10-02,1,100,abc"].join("\n")
    );
    expect(errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("impressions 非法"),
      expect.stringContaining("clicks 非法"),
    ]);
  });

  it("currency 不是 3 位字母 → 拒绝（不猜测币种）", () => {
    const { rows, errors } = parseAdRevenueCsv(
      ["date,revenue,currency", "2026-10-01,1,US", "2026-10-02,1,USDD"].join("\n")
    );
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0].reason).toContain("currency 非法");
  });
});

describe("parseAdRevenueCsv：整表错误", () => {
  it("空文件 → line 0 错误", () => {
    const { rows, errors } = parseAdRevenueCsv("");
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 0, reason: "文件为空" }]);
  });

  it("缺必需表头（date / revenue）→ line 0 错误并给出示例", () => {
    const { errors } = parseAdRevenueCsv(["impressions,clicks", "1,2"].join("\n"));
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(0);
    expect(errors[0].reason).toContain("date");
    expect(errors[0].reason).toContain("revenue");
  });

  it("只有表头没有数据行 → 0 行 0 错误（合法的空导入）", () => {
    const { rows, errors } = parseAdRevenueCsv("date,revenue,impressions,clicks\n");
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });
});

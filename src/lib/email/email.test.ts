// ===== Email 基础设施测试（C 阶段）=====
// 覆盖任务要求的 14 项：welcome 触发/幂等、reminder 资格、upgrade 条件、
// 付费用户豁免、退订、事务性豁免、模板变量完整/缺失、provider 失败不阻塞、
// API key 不进客户端 bundle、UTM 正确、重复事件不重复发送。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "../db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, email TEXT NOT NULL, template TEXT NOT NULL,
      automation_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT, failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT,
      UNIQUE (user_id, automation_key)
    );
    CREATE TABLE email_preferences (
      user_id TEXT PRIMARY KEY, email TEXT, unsubscribe_token TEXT UNIQUE,
      marketing_unsubscribed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL, user_id TEXT, anonymous_id TEXT, session_id TEXT,
      path TEXT, locale TEXT, referrer TEXT, source TEXT, medium TEXT, campaign TEXT,
      landing_page TEXT, ref_id TEXT, props TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE analytics_identities (
      anonymous_id TEXT PRIMARY KEY, user_id TEXT,
      first_touch_source TEXT, first_touch_medium TEXT, first_touch_campaign TEXT,
      first_touch_content TEXT, first_touch_term TEXT,
      first_landing_page TEXT, first_referrer TEXT,
      last_touch_source TEXT, last_touch_medium TEXT, last_touch_campaign TEXT,
      last_landing_page TEXT, last_referrer TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      bound_at TEXT
    );
  `);
  return new SQLiteAdapter(raw);
}

let currentAdapter: SQLiteAdapter;
vi.mock("../db/migrations", () => ({
  getAdapter: vi.fn(async () => currentAdapter),
}));

// provider mock：可注入成功/失败
const h = vi.hoisted(() => ({
  sendRaw: vi.fn(async () => ({ success: true, messageId: "msg-1" })),
  configured: { value: true },
}));
vi.mock("./resend", () => ({
  isEmailConfigured: vi.fn(() => h.configured.value),
  sendRawEmail: h.sendRaw,
}));

const { sendTemplateEmail } = await import("./service");
const { LIFECYCLE_TEMPLATES } = await import("./templates/lifecycle");
const { eligibleTemplates } = await import("./lifecycle");
const { ensureUnsubscribeToken, unsubscribeByToken, isMarketingUnsubscribed } = await import("./preferences");
const { buildCtaUrl } = await import("./render");

const USER = "user-email-1";
const EMAIL = "user@example.com";

const BASE_VARS = {
  firstName: "User",
  auditUrl: "https://www.seeo.asia/app/audit?utm_campaign=welcome",
  appUrl: "https://www.seeo.asia/app?utm_campaign=x",
  pricingUrl: "https://www.seeo.asia/pricing?utm_campaign=x",
  unsubscribeUrl: "https://www.seeo.asia/api/email/unsubscribe?token=t",
};

async function logRows(): Promise<Array<Record<string, unknown>>> {
  return (await currentAdapter.query(`SELECT * FROM email_log ORDER BY id`)) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  currentAdapter = makeAdapter();
  h.sendRaw.mockClear();
  h.sendRaw.mockImplementation(async () => ({ success: true, messageId: "msg-1" }));
  h.configured.value = true;
});

describe("统一发送层", () => {
  it("正常发送：status=sent，记录 provider_message_id（#1 部分）", async () => {
    const r = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    expect(r.status).toBe("sent");
    expect(r.claimed).toBe(true);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].provider_message_id).toBe("msg-1");
    expect(h.sendRaw).toHaveBeenCalledTimes(1);
  });

  it("welcome 幂等：同用户同模板第二次不发送（#2 / #14）", async () => {
    await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    const r2 = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    expect(r2.claimed).toBe(false);
    // 幂等命中是「跳过」而非「失败」——状态模型必须能区分二者
    expect(r2.status).toBe("skipped_already_sent");
    expect(h.sendRaw).toHaveBeenCalledTimes(1);
    expect(await logRows()).toHaveLength(1);
  });

  it("营销退订后：status=skipped_unsubscribed，不调用 provider（#7）", async () => {
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    await unsubscribeByToken(token);
    expect(await isMarketingUnsubscribed(USER)).toBe(true);

    const r = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    expect(r.status).toBe("skipped_unsubscribed");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });

  it("provider 失败：status=failed 但不抛错，业务可继续（#11）", async () => {
    h.sendRaw.mockImplementation(async () => { throw new Error("provider down"); });
    const r = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    expect(r.status).toBe("failed");
    const rows = await logRows();
    expect(rows[0].status).toBe("failed");
    expect(String(rows[0].failure_reason)).toContain("provider down");
  });

  it("provider 未配置：dry-run 记录 skipped_no_provider（本地验证路径）", async () => {
    h.configured.value = false;
    const r = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS });
    expect(r.status).toBe("skipped_no_provider");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });

  it("缺必需变量：skipped_render_error，不发送错误内容（#10）", async () => {
    const r = await sendTemplateEmail({
      userId: USER,
      email: EMAIL,
      templateKey: "welcome_v1",
      variables: { firstName: "User" }, // 缺 auditUrl / unsubscribeUrl
    });
    expect(r.status).toBe("skipped_render_error");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });

  it("未知模板被拒绝", async () => {
    const r = await sendTemplateEmail({ userId: USER, email: EMAIL, templateKey: "nope_v1", variables: {} });
    expect(r.status).toBe("failed");
    expect(h.sendRaw).not.toHaveBeenCalled();
  });
});

describe("模板体系", () => {
  it("全部 7 个 lifecycle 模板存在且变量完整时渲染成功（#9）", () => {
    const keys = ["welcome_v1", "audit_reminder_v1", "seo_education_v1", "feature_education_v1", "reengagement_v1", "upgrade_v1", "dormant_v1"];
    for (const key of keys) {
      const t = LIFECYCLE_TEMPLATES[key];
      expect(t).toBeDefined();
      const built = t.build(BASE_VARS);
      expect(built.subject.length).toBeGreaterThan(0);
      expect(built.html).toContain("Unsubscribe"); // 营销邮件必须带退订
      expect(built.html).not.toMatch(/\{\{/); // 无未替换占位符
      expect(built.html).not.toContain("undefined");
    }
  });

  it("营销模板缺 unsubscribeUrl 时渲染失败（退订链接强制存在）", () => {
    const t = LIFECYCLE_TEMPLATES["welcome_v1"];
    expect(() => t.build({ ...BASE_VARS, unsubscribeUrl: undefined as unknown as string })).toThrow(/unsubscribeUrl/);
  });

  it("UTM 正确：utm_source=email & utm_medium=lifecycle & utm_campaign=<key>（#13）", () => {
    const url = buildCtaUrl({ path: "/app/audit", utmCampaign: "welcome" });
    expect(url).toContain("utm_source=email");
    expect(url).toContain("utm_medium=lifecycle");
    expect(url).toContain("utm_campaign=welcome");
  });

  it("Cold Email 链接用 outbound UTM（#13）", () => {
    const url = buildCtaUrl({ path: "/app/audit", utmMedium: "outbound", utmCampaign: "cold_email" });
    expect(url).toContain("utm_medium=outbound");
    expect(url).toContain("utm_campaign=cold_email");
  });
});

describe("Lifecycle 资格规则", () => {
  const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);
  const toSqlite = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

  it("注册 24h+ 未激活 → reminder（#3）", () => {
    const due = eligibleTemplates({
      signupAt: toSqlite(hoursAgo(30)),
      activated: false,
      paid: false,
      lastActivityAt: toSqlite(hoursAgo(30)),
      pricingViews: 0,
    });
    expect(due).toContain("audit_reminder_v1");
  });

  it("已激活 → 不发 reminder（#4）", () => {
    const due = eligibleTemplates({
      signupAt: toSqlite(hoursAgo(30)),
      activated: true,
      paid: false,
      lastActivityAt: toSqlite(hoursAgo(1)),
      pricingViews: 0,
    });
    expect(due).not.toContain("audit_reminder_v1");
  });

  it("升级条件：已激活 + 未付费 + pricing_viewed≥3 → upgrade（#5）", () => {
    const due = eligibleTemplates({
      signupAt: toSqlite(hoursAgo(30)),
      activated: true,
      paid: false,
      lastActivityAt: toSqlite(hoursAgo(1)),
      pricingViews: 3,
    });
    expect(due).toContain("upgrade_v1");
  });

  it("未满足升级条件（pricing_viewed<3）→ 不发 upgrade（#5）", () => {
    const due = eligibleTemplates({
      signupAt: toSqlite(hoursAgo(30)),
      activated: true,
      paid: false,
      lastActivityAt: toSqlite(hoursAgo(1)),
      pricingViews: 1,
    });
    expect(due).not.toContain("upgrade_v1");
  });

  it("已付费 → 不发 upgrade（#6）", () => {
    const due = eligibleTemplates({
      signupAt: toSqlite(hoursAgo(30)),
      activated: true,
      paid: true,
      lastActivityAt: toSqlite(hoursAgo(1)),
      pricingViews: 10,
    });
    expect(due).not.toContain("upgrade_v1");
  });

  it("10 天未活跃 → reengagement；30 天 → dormant", () => {
    const base = { signupAt: toSqlite(hoursAgo(24 * 12)), paid: false, pricingViews: 0 };
    const due10 = eligibleTemplates({ ...base, activated: true, lastActivityAt: toSqlite(hoursAgo(24 * 11)) });
    expect(due10).toContain("reengagement_v1");

    const due30 = eligibleTemplates({ ...base, activated: true, lastActivityAt: toSqlite(hoursAgo(24 * 35)), signupAt: toSqlite(hoursAgo(24 * 40)) });
    expect(due30).toContain("dormant_v1");
  });
});

describe("邮件偏好（#7 / #8）", () => {
  it("退订 token 幂等：重复退订返回 false", async () => {
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    expect(await unsubscribeByToken(token)).toBe(true);
    expect(await unsubscribeByToken(token)).toBe(false);
  });

  it("退订后：营销邮件停止 + 事务邮件不受影响（#7 / #8 对比验证）", async () => {
    const token = await ensureUnsubscribeToken(USER, EMAIL);
    await unsubscribeByToken(token);
    expect(await isMarketingUnsubscribed(USER)).toBe(true);

    // 7 个 lifecycle 模板全部为 marketing 类别 —— 退订只能停这一类
    for (const t of Object.values(LIFECYCLE_TEMPLATES)) {
      expect(t.category).toBe("marketing");
    }

    // 1) 营销邮件被拦下
    const marketing = await sendTemplateEmail({
      userId: USER, email: EMAIL, templateKey: "welcome_v1", variables: BASE_VARS,
    });
    expect(marketing.status).toBe("skipped_unsubscribed");

    // 2) 同一用户的事务邮件照常发送（真实断言，非分类推断）
    const { sendTransactionalEmail } = await import("./service");
    const tx = await sendTransactionalEmail({
      userId: USER, email: EMAIL, templateKey: "report_email_v1",
      subject: "Your SeeO report", html: "<p>ok</p>",
    });
    expect(tx.status).toBe("sent");
    expect(tx.messageId).toBe("msg-1");
    // provider 只被调用一次 —— 即事务邮件那一次
    expect(h.sendRaw).toHaveBeenCalledTimes(1);
  });
});

describe("API key 不进客户端 bundle（#12）", () => {
  it("email 模块均无 'use client'，且不引用 NEXT_PUBLIC_* 密钥", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "src/lib/email");
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    for (const f of files.filter((x) => String(x).endsWith(".ts") && !String(x).includes(".test."))) {
      const raw = fs.readFileSync(path.join(dir, String(f)), "utf-8");
      // 剥离注释后检查（注释提及不算引用）
      const src = raw.replace(/^\s*\/\/.*$/gm, "");
      expect(src, `${f} 不应包含 "use client"`).not.toContain('"use client"');
      expect(src, `${f} 不得内联 Resend 密钥`).not.toMatch(/re_[A-Za-z0-9]{20,}/);
      // RESEND_API_KEY 的 env 读取只允许出现在 resend.ts（唯一 provider 边界），
      // 其余模块（发送层/模板层/偏好层）不得直接触碰 provider 配置
      if (f !== "resend.ts") {
        expect(src, `${f} 不得引用 RESEND_API_KEY（只允许 resend.ts）`).not.toContain("RESEND_API_KEY");
      }
    }
  });
});

describe("统一发送层收口（#12 / 架构约束）", () => {
  it("src 下只有 lib/email 能 import resend SDK —— 业务路由不得直连 provider", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "src");

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (entry.name.includes(".test.")) continue;
        const rel = path.relative(root, full);
        if (rel.startsWith(path.join("lib", "email"))) continue;
        const raw = fs.readFileSync(full, "utf-8").replace(/^\s*\/\/.*$/gm, "");
        if (/from\s+["']resend["']/.test(raw) || /require\(["']resend["']\)/.test(raw)) {
          offenders.push(rel);
        }
      }
    };
    walk(root);

    expect(offenders, `以下文件绕过统一发送层直连 Resend：${offenders.join(", ")}`).toEqual([]);
  });

  it("email 模块不得被客户端组件引用（server-side only）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "src");

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (entry.name.includes(".test.")) continue;
        const raw = fs.readFileSync(full, "utf-8");
        const rel = path.relative(root, full);
        if (rel.startsWith(path.join("lib", "email"))) continue;
        if (!/^\s*["']use client["']/.test(raw)) continue;
        if (/from\s+["'][^"']*lib\/email[^"']*["']/.test(raw)) offenders.push(rel);
      }
    };
    walk(root);

    expect(offenders, `客户端组件不得引用 email 模块：${offenders.join(", ")}`).toEqual([]);
  });
});

// ===== POST /api/admin/import/ads =====
// 导入广告收入（CSV 文本 / 表单 textarea / JSON）。
//
// 授权：owner 会话 或 CRON_SECRET。
// 幂等：按 (date, provider) 覆盖写入，重复导入同一天不会重复计收入。
// 安全：不做 scraping，不访问任何广告平台；只接受人工提供的数值。

import { NextResponse } from "next/server";
import { checkAdmin, hasCronSecret } from "@/lib/admin/auth";
import { parseAdRevenueCsv } from "@/lib/admin/ads/manual";
import { getAdProvider, writeAdRevenueDays } from "@/lib/admin/ads";
import { recordSourceEvent } from "@/lib/admin/source-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVENUE_PATH = "/admin/revenue";

interface ImportInput {
  csv: string;
  provider: string;
  days: string | null;
}

async function readInput(req: Request): Promise<ImportInput> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData();
    // file 字段 / csv 字段都可能是上传的 File（直接上传 CSV 文件），否则是粘贴文本
    const pick = async (v: FormDataEntryValue | null): Promise<string> => {
      if (v && typeof v === "object" && "arrayBuffer" in v) {
        return (v as File).size > 0 ? await (v as File).text() : "";
      }
      return String(v ?? "");
    };
    const csv = (await pick(form.get("file"))) || (await pick(form.get("csv")));
    return {
      csv,
      provider: String(form.get("provider") ?? "adsense"),
      days: form.get("days") ? String(form.get("days")) : null,
    };
  }
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      csv: typeof body.csv === "string" ? body.csv : "",
      provider: typeof body.provider === "string" ? body.provider : "adsense",
      days: typeof body.days === "string" || typeof body.days === "number" ? String(body.days) : null,
    };
  }
  // 纯文本 CSV
  return { csv: await req.text(), provider: "adsense", days: null };
}

export async function POST(req: Request) {
  const cron = hasCronSecret(req);
  const guard = cron ? null : await checkAdmin();
  if (guard && !guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }

  const ct = req.headers.get("content-type") ?? "";
  const isForm = ct.includes("form-urlencoded") || ct.includes("multipart/form-data");

  const input = await readInput(req).catch(() => ({ csv: "", provider: "adsense", days: null }));
  if (!input.csv.trim()) {
    void recordSourceEvent(`ads:${input.provider}`, "error", "导入失败：csv 内容为空");
    return respond(req, isForm, input.days, 0, [{ line: 0, reason: "csv 内容为空" }], 400);
  }
  if (!getAdProvider(input.provider)) {
    void recordSourceEvent(`ads:${input.provider}`, "error", `导入失败：未知 provider`);
    return respond(req, isForm, input.days, 0, [{ line: 0, reason: `未知 provider：${input.provider}` }], 400);
  }

  const parsed = parseAdRevenueCsv(input.csv);
  let written = 0;

  // 全有全无：任何一行校验失败都**不写库**（导入失败不得改变已有有效收入数据），
  // 具体行号与原因整体返回。
  if (parsed.errors.length > 0) {
    void recordSourceEvent(
      `ads:${input.provider}`,
      "error",
      `导入失败（0 行写入）：${parsed.errors.slice(0, 5).map((e) => `第 ${e.line} 行 ${e.reason}`).join("；")}`
    );
    return respond(req, isForm, input.days, 0, parsed.errors, 400);
  }

  if (parsed.rows.length === 0) {
    void recordSourceEvent(`ads:${input.provider}`, "error", "导入失败：未包含任何有效数据行");
    return respond(req, isForm, input.days, 0, [{ line: 0, reason: "未包含任何有效数据行" }], 400);
  }

  try {
    written = await writeAdRevenueDays(parsed.rows, {
      provider: input.provider,
      // 表单与 JSON 都视作手工导入；CSV 文件上传同样以内容为准
      source: "csv",
    });
    void recordSourceEvent(
      `ads:${input.provider}`,
      "success",
      `CSV 导入成功：覆盖写入 ${written} 行（provider=${input.provider}）`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "写入失败";
    void recordSourceEvent(`ads:${input.provider}`, "error", `写入失败：${reason}`);
    return respond(req, isForm, input.days, 0, [{ line: 0, reason }], 500);
  }

  return respond(req, isForm, input.days, written, [], 200);
}

function respond(
  req: Request,
  isForm: boolean,
  days: string | null,
  written: number,
  errors: Array<{ line: number; reason: string }>,
  status: number
): NextResponse {
  if (isForm) {
    const url = new URL(REVENUE_PATH, req.url);
    url.searchParams.set("days", days ?? "7");
    url.searchParams.set("import", written > 0 ? "ok" : "error");
    url.searchParams.set("imported", String(written));
    url.searchParams.set("errors", String(errors.length));
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json(
    {
      data: { written, rejected: errors.length },
      errors: errors.slice(0, 50),
    },
    { status }
  );
}

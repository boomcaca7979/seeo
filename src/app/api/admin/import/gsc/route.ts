// ===== POST /api/admin/import/gsc =====
// 导入 Google Search Console 导出的 CSV（效果报告 → 导出 → 下载 CSV / ZIP 内各维度文件）。
//
// 背景：在真实 OAuth 凭据可用之前，这是 GSC 数据的可用接入方式；OAuth 自动同步代码保留，
// 两者写同一批表（gsc_daily_metrics / gsc_query_metrics / gsc_page_metrics），同主键覆盖式
// upsert —— 重复导入同一份报表不会重复累计。
//
// 授权：owner 会话 或 CRON_SECRET（与 /api/admin/import/ads 相同）。
// 输入：form / JSON / 纯文本 { csv, kind: queries|pages|dates, windowDays?, propertyUrl? }
// 失败：逐行错误（行号 + 原因），只拒绝非法行，不写入。

import { NextResponse } from "next/server";
import { checkAdmin, hasCronSecret } from "@/lib/admin/auth";
import {
  GSC_IMPORT_KINDS,
  importGscZip,
  parseGscExportCsv,
  writeGscImportRows,
  type GscImportKind,
} from "@/lib/admin/gsc-import";
import { recordSourceEvent } from "@/lib/admin/source-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROWTH_PATH = "/admin/growth";
const DEFAULT_PROPERTY = "sc-domain:seeo.asia";

interface GscImportInput {
  csv: string;
  kind: string;
  windowDays: string | null;
  propertyUrl: string;
}

async function readInput(req: Request): Promise<GscImportInput> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData();
    return {
      csv: String(form.get("csv") ?? ""),
      kind: String(form.get("kind") ?? ""),
      windowDays: form.get("windowDays") ? String(form.get("windowDays")) : null,
      propertyUrl: String(form.get("propertyUrl") ?? "") || DEFAULT_PROPERTY,
    };
  }
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      csv: typeof body.csv === "string" ? body.csv : "",
      kind: typeof body.kind === "string" ? body.kind : "",
      windowDays:
        typeof body.windowDays === "string" || typeof body.windowDays === "number"
          ? String(body.windowDays)
          : null,
      propertyUrl:
        typeof body.propertyUrl === "string" && body.propertyUrl.trim()
          ? body.propertyUrl.trim()
          : DEFAULT_PROPERTY,
    };
  }
  // 纯文本：默认按搜索词报告处理
  return { csv: await req.text(), kind: "queries", windowDays: null, propertyUrl: DEFAULT_PROPERTY };
}

function respond(
  req: Request,
  isForm: boolean,
  kind: string,
  windowDays: string | null,
  written: number,
  errors: Array<{ line: number; reason: string }>,
  status: number
): NextResponse {
  if (isForm) {
    const url = new URL(GROWTH_PATH, req.url);
    url.searchParams.set("days", windowDays ?? "28");
    url.searchParams.set("gsc_import", written > 0 ? "ok" : "error");
    url.searchParams.set("gsc_kind", kind);
    url.searchParams.set("gsc_written", String(written));
    url.searchParams.set("gsc_errors", String(errors.length));
    // 表单跳转带不了逐行错误；至少把整文件级失败原因（line 0）带给页面
    const fileLevel = errors.find((e) => e.line === 0);
    if (fileLevel) url.searchParams.set("gsc_reason", fileLevel.reason.slice(0, 200));
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json(
    { data: { written, rejected: errors.length, kind }, errors: errors.slice(0, 50) },
    { status }
  );
}

export async function POST(req: Request) {
  const cron = hasCronSecret(req);
  const guard = cron ? null : await checkAdmin();
  if (guard && !guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }

  const ct = req.headers.get("content-type") ?? "";
  const isForm = ct.includes("form-urlencoded") || ct.includes("multipart/form-data");

  const input = await readInput(req).catch(() => ({
    csv: "",
    kind: "queries",
    windowDays: null,
    propertyUrl: DEFAULT_PROPERTY,
  }));

  // ---- 直接上传 ZIP / CSV 文件（multipart 的 file 字段优先于粘贴文本） ----
  let uploadedFile: File | null = null;
  if (isForm) {
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (f && typeof f === "object" && "arrayBuffer" in f && (f as File).size > 0) {
      uploadedFile = f as File;
    }
  }

  if (uploadedFile) {
    const windowDays = Number(input.windowDays ?? 28);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
      return respond(req, isForm, input.kind, input.windowDays, 0, [
        { line: 0, reason: "windowDays 需为 1–365 的整数（报表对应的统计窗口天数）" },
      ], 400);
    }
    const buf = new Uint8Array(await uploadedFile.arrayBuffer());
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" 魔数
    if (isZip) {
      const result = await importGscZip(buf, {
        propertyUrl: input.propertyUrl,
        windowDays,
      });
      if (result.fatal) {
        void recordSourceEvent("gsc", "error", `ZIP 导入失败：${result.fatal}`);
        return respond(req, isForm, "zip", input.windowDays, 0, [
          { line: 0, reason: result.fatal },
        ], 400);
      }
      const line0 = result.files.flatMap((f) => f.errors).find((e) => e.line === 0);
      const ok = result.written > 0;
      void recordSourceEvent(
        "gsc",
        ok ? "success" : "error",
        ok
          ? `ZIP 导入成功：写入 ${result.written} 行（property=${input.propertyUrl}，window=${windowDays}d）`
          : `ZIP 导入失败（0 行写入）：${line0?.reason ?? "无可识别数据"}`
      );
      if (isForm) {
        const url = new URL(GROWTH_PATH, req.url);
        url.searchParams.set("days", input.windowDays ?? "28");
        url.searchParams.set("gsc_import", ok ? "ok" : "error");
        url.searchParams.set("gsc_kind", "zip");
        url.searchParams.set("gsc_written", String(result.written));
        url.searchParams.set("gsc_errors", String(result.files.reduce((s, f) => s + f.errors.length, 0)));
        if (line0) url.searchParams.set("gsc_reason", line0.reason.slice(0, 200));
        return NextResponse.redirect(url, { status: 303 });
      }
      return NextResponse.json(
        {
          data: { written: result.written, kind: "zip", files: result.files },
        },
        { status: ok ? 200 : 400 }
      );
    }
    // 单个 CSV 文件
    const text = new TextDecoder().decode(buf);
    const kind = (input.kind || "queries") as GscImportKind;
    if (!GSC_IMPORT_KINDS.includes(kind)) {
      return respond(req, isForm, input.kind, input.windowDays, 0, [
        { line: 0, reason: `未知报告类型：${input.kind}（应为 queries / pages / dates）` },
      ], 400);
    }
    const parsed = parseGscExportCsv(text, kind);
    let written = 0;
    if (parsed.rows.length > 0) {
      try {
        written = await writeGscImportRows(kind, parsed.rows, {
          propertyUrl: input.propertyUrl,
          windowDays,
        });
        void recordSourceEvent(
          "gsc",
          "success",
          `${kind} CSV 文件导入成功：写入 ${written} 行（property=${input.propertyUrl}，window=${windowDays}d）`
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : "写入失败";
        void recordSourceEvent("gsc", "error", `${kind} 文件导入写入失败：${reason}`);
        return respond(req, isForm, input.kind, input.windowDays, 0, [
          { line: 0, reason },
        ], 500);
      }
    } else {
      void recordSourceEvent("gsc", "error", `${kind} 文件导入失败：未解析出有效数据行`);
    }
    return respond(req, isForm, input.kind, input.windowDays, written, parsed.errors, parsed.rows.length === 0 ? 400 : 200);
  }

  const kind = input.kind as GscImportKind;
  if (!GSC_IMPORT_KINDS.includes(kind)) {
    return respond(req, isForm, input.kind, input.windowDays, 0, [
      { line: 0, reason: `未知报告类型：${input.kind || "空"}（应为 queries / pages / dates）` },
    ], 400);
  }
  if (!input.csv.trim()) {
    return respond(req, isForm, input.kind, input.windowDays, 0, [{ line: 0, reason: "csv 内容为空" }], 400);
  }

  const windowDays = Number(input.windowDays ?? 28);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    return respond(req, isForm, input.kind, input.windowDays, 0, [
      { line: 0, reason: "windowDays 需为 1–365 的整数（报表对应的统计窗口天数）" },
    ], 400);
  }

  const parsed = parseGscExportCsv(input.csv, kind);
  let written = 0;
  if (parsed.rows.length > 0) {
    try {
      written = await writeGscImportRows(kind, parsed.rows, {
        propertyUrl: input.propertyUrl,
        windowDays,
      });
      void recordSourceEvent(
        "gsc",
        "success",
        `${kind} CSV 粘贴导入成功：写入 ${written} 行（property=${input.propertyUrl}，window=${windowDays}d）`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "写入失败";
      void recordSourceEvent("gsc", "error", `${kind} 粘贴导入写入失败：${reason}`);
      return respond(req, isForm, input.kind, input.windowDays, 0, [
        { line: 0, reason },
      ], 500);
    }
  } else {
    void recordSourceEvent(
      "gsc",
      "error",
      `${kind} 粘贴导入失败：未解析出有效数据行（${parsed.errors.slice(0, 2).map((e) => e.reason).join("；")}）`
    );
  }

  return respond(
    req,
    isForm,
    input.kind,
    input.windowDays,
    written,
    parsed.errors,
    parsed.rows.length === 0 ? 400 : 200
  );
}

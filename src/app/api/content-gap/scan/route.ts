// ===== /api/content-gap/scan =====
// POST 启动扫描（项目 owner 校验；后台 after() 执行）；GET 查询最新扫描状态；DELETE 取消。

import { NextResponse, after } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { isAuthEnabled } from "@/lib/auth-config";
import { getProjectById } from "@/lib/db/projects";
import { createSiteScan, finishScan, getSiteScan, latestSiteScan } from "@/lib/db/site-content";
import { runScanById } from "@/lib/seo/content-gap/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 项目数据的归属身份必须与 /api/projects 一致（项目在那里以 auth.user?.id ?? "demo-user"
 * 归档）。策略系统用 demo:<scope> cookie，两套身份不同——Content Gap 跟随项目身份，
 * 否则 demo 模式下永远找不到项目。
 */
async function projectOwnerOrNull() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return null;
  if (auth.user?.id) return auth.user.id;
  return isAuthEnabled ? null : "demo-user";
}

export async function POST(req: Request) {
  const userId = await projectOwnerOrNull();
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  let body: { projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "BAD_REQUEST" }, { status: 400 });
  }
  const projectId = Number(body.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "projectId 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const project = await getProjectById(userId, projectId);
  if (!project) return NextResponse.json({ error: "项目不存在", code: "PROJECT_NOT_FOUND" }, { status: 404 });

  // 同项目已有 running 扫描时拒绝重复启动
  const latest = await latestSiteScan(userId, projectId);
  if (latest?.status === "running") {
    return NextResponse.json({ error: "该项目已有进行中的扫描", code: "SCAN_RUNNING" }, { status: 409 });
  }

  const domain = project.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const scan = await createSiteScan(userId, projectId, domain);
  const scanId = scan.id;
  after(async () => {
    await runScanById(userId, projectId, domain, scanId);
  });
  return NextResponse.json({ data: { scanId } });
}

export async function GET(req: Request) {
  const userId = await projectOwnerOrNull();
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "projectId 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const scan = await latestSiteScan(userId, projectId);
  if (!scan) return NextResponse.json({ data: null });
  return NextResponse.json({ data: scan });
}

export async function DELETE(req: Request) {
  const userId = await projectOwnerOrNull();
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const scanId = Number(new URL(req.url).searchParams.get("scanId"));
  if (!Number.isInteger(scanId) || scanId <= 0) {
    return NextResponse.json({ error: "scanId 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const scan = await getSiteScan(userId, scanId);
  if (!scan) return NextResponse.json({ error: "扫描不存在", code: "SCAN_NOT_FOUND" }, { status: 404 });
  if (scan.status === "running") {
    await finishScan(userId, scanId, "cancelled");
  }
  return NextResponse.json({ data: { cancelled: true } });
}

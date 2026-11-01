// ===== /api/seo/serp =====
// 服务端路由，调用 SerpApi，带缓存和用量保护
// 关键词 SERP Top 10 + 相关搜索 + 相关问题

import { NextResponse } from "next/server";
import { getSerpUsage, searchSerp, summarizeSerp } from "@/lib/seo/serp-service";
import { serpApiErrorResponse } from "@/lib/seo/serp-route-errors";
import { normalizeDeviceParam } from "@/lib/seo/device-params";
import type { SeoApiError } from "@/lib/seo/types";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") ?? "").trim();
  const location = (searchParams.get("location") ?? "中国").trim();
  // 设备口径统一走 normalizeDeviceParam（唯一实现）：
  // 页面内部是 PC/移动端，而 /api/keywords/expand 对外返回 desktop/mobile，
  // 这里两者都接受并归一化，避免前端混用时 400（2026-11-01 DEF-02）。
  const deviceRaw = (searchParams.get("device") ?? "").trim();
  const device = deviceRaw ? normalizeDeviceParam(deviceRaw) : "PC";
  // P0-02-B 新增（可选）：SerpApi hl 语言码；缺省行为不变（zh-cn）
  const languageRaw = (searchParams.get("language") ?? "").trim();
  // P4-D 新增（可选）：SerpApi start 分页偏移（0/10/20…）。>0 的页是独立引擎调用
  // （独立缓存 key + 配额消耗），须由用户显式触发；缺省 0 保持既有行为不变。
  const startRaw = (searchParams.get("start") ?? "").trim();
  let start = 0;
  if (startRaw) {
    const parsed = Number(startRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed % 10 !== 0) {
      return badParams("start 必须是非负的 10 的倍数");
    }
    start = parsed;
  }

  if (!keyword) return badParams("keyword 参数不能为空");
  if (!device) return badParams("device 必须是 PC/desktop 或 移动端/mobile");

  const params = {
    keyword,
    location,
    device,
    ...(languageRaw ? { language: languageRaw } : {}),
    ...(start > 0 ? { start } : {}),
  };

  try {
    const { result } = await searchSerp(userId, plan, params);
    // 真实响应核实（2026-10-29，P7）：SerpApi start>0 时 organic position 是页内相对位置
    // （1-10），换算为绝对 Google 位置返回，保证跨页展示排名不重复；缓存仍存原始页内值，
    // 每次读取一致换算。start=0（第一页）原样透传。
    const data = start > 0
      ? { ...result, organic: result.organic.map((row) => ({ ...row, position: row.position + start })) }
      : result;
    // summary 为 P0-02-B 新增字段；既有 data.* 字段全部原样保留
    return NextResponse.json({
      data: { ...data, summary: summarizeSerp(data) },
      usage: await getSerpUsage(userId, plan),
    });
  } catch (e) {
    return serpApiErrorResponse(e);
  }
}

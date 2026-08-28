// ===== GSC API 错误归一化（供 /api/gsc/* 路由共用） =====
// 不向客户端透出 Google raw error / token 信息。

import { NextResponse } from "next/server";
import { GscNotConfiguredError, GscProviderError } from "@/lib/seo/gsc-provider";

export function mapGscError(e: unknown) {
  if (e instanceof GscNotConfiguredError) {
    return NextResponse.json({ error: e.message, code: "GSC_NOT_CONFIGURED" }, { status: 503 });
  }
  if (e instanceof GscProviderError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status }
    );
  }
  return NextResponse.json(
    { error: `服务器内部错误：${(e as Error).message}`, code: "GSC_PROVIDER_ERROR" },
    { status: 500 }
  );
}

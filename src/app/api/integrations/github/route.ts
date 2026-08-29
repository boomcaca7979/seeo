// ===== /api/integrations/github =====
// GET   ：连接状态（GET ?project_id=；含 repos 列表模式 ?list=true）
// POST  ：显式连接 { project_id, owner, repository, token? }（App 模式 token 可省）
//          校验：仓库存在/未归档/可推送/默认分支存在（GITHUB_* 错误）
// DELETE ：断开（?project_id=）
// 安全：凭证 AES-256-GCM 加密入库；绝不回显 token

import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/db";
import { getGitHubConnectionByProject, upsertGitHubConnection, deleteGitHubConnection } from "@/lib/db/github";
import { getGitHubAppToken, getGitHubRepo, isGitHubAppConfigured, listGitHubRepositories } from "@/lib/seo/github-provider";
import { encryptSecret } from "@/lib/crypto/secure-store";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveSqliteProjectId } from "@/lib/project-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveProject(req: Request): Promise<{ userId: string; projectId: number } | NextResponse> {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: "GitHub 集成需要登录 SeeO 账号", code: "GITHUB_NOT_CONNECTED" }, { status: 403 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const projectRef = (searchParams.get("project_id") ?? "").trim();
  if (!projectRef) {
    return NextResponse.json({ error: "project_id 参数无效", code: "INVALID_PROJECT_ID" }, { status: 400 });
  }
  const projectId = await resolveSqliteProjectId(userId, projectRef);
  if (projectId === null) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const project = await getProjectById(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "未找到该项目", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  return { userId, projectId };
}

export async function GET(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;
  const { userId, projectId } = resolved;
  const { searchParams } = new URL(req.url);

  if (searchParams.get("list") === "true") {
    if (!isGitHubAppConfigured()) {
      return NextResponse.json({ error: "GitHub App 未配置，无法列出仓库（请使用 token 连接）", code: "GITHUB_NOT_CONFIGURED" }, { status: 503 });
    }
    try {
      const token = await getGitHubAppToken();
      const repos = await listGitHubRepositories(token, true);
      return NextResponse.json({ data: { repos } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, code: (e as { code?: string }).code ?? "GITHUB_PROVIDER_ERROR" }, { status: 502 });
    }
  }

  const connection = await getGitHubConnectionByProject(userId, projectId);
  if (!connection) {
    return NextResponse.json({ data: { connected: false } });
  }
  return NextResponse.json({
    data: {
      connected: true,
      owner: connection.owner,
      repository: connection.repository,
      defaultBranch: connection.default_branch,
      authMode: connection.auth_mode,
      connectedAt: connection.connected_at,
    },
  });
}

export async function POST(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;
  let body: { owner?: string; repository?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
  }
  const owner = (body.owner ?? "").trim().toLowerCase();
  const repository = (body.repository ?? "").trim();
  if (!owner || !repository) {
    return NextResponse.json({ error: "owner/repository 不能为空", code: "BAD_REQUEST" }, { status: 400 });
  }
  const appMode = isGitHubAppConfigured();
  const token = body.token?.trim();
  if (!appMode && !token) {
    return NextResponse.json({ error: "GitHub App 未配置时必须提供访问 token（仅限 self-host/开发，将加密存储）", code: "GITHUB_NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    // 连接校验：仓库存在 / 未归档 / 可推送（GET /repos 对无权限仓库返回 404）
    const effectiveToken = token ?? (await (async () => {
      const { getGitHubAppToken } = await import("@/lib/seo/github-provider");
      return getGitHubAppToken();
    })());
    const repo = await getGitHubRepo(effectiveToken, owner, repository);
    if (repo.archived) {
      return NextResponse.json({ error: "仓库已归档，不可写入", code: "GITHUB_REPOSITORY_ARCHIVED" }, { status: 400 });
    }
    if (repo.permissions && repo.permissions.push === false) {
      return NextResponse.json({ error: "当前凭证对该仓库没有 push 权限", code: "GITHUB_PERMISSION_DENIED" }, { status: 403 });
    }
    await upsertGitHubConnection(resolved.userId, {
      project_id: resolved.projectId,
      owner,
      repository,
      default_branch: repo.default_branch,
      auth_mode: appMode ? "app" : "pat",
      encrypted_credentials: token ? encryptSecret(token) : null,
    });
    return NextResponse.json({
      data: {
        connected: true,
        owner,
        repository,
        defaultBranch: repo.default_branch,
        authMode: appMode ? "app" : "pat",
      },
    });
  } catch (e) {
    // 不回显 GitHub 原始响应体（可能含内部细节）；映射为稳定错误码 + 用户可读信息
    const code = (e as { code?: string }).code ?? "GITHUB_PROVIDER_ERROR";
    const friendly: Record<string, string> = {
      GITHUB_REPOSITORY_NOT_FOUND: "仓库不存在，或当前凭证无权访问该仓库",
      GITHUB_PERMISSION_DENIED: "GitHub 拒绝了该凭证（无效、过期或权限不足）",
      GITHUB_REPOSITORY_ARCHIVED: "仓库已归档，不可写入",
      GITHUB_RATE_LIMITED: "GitHub API 速率受限，请稍后重试",
      GITHUB_NOT_CONFIGURED: "GitHub App 未配置，连接时必须提供访问 token",
    };
    const status = code === "GITHUB_REPOSITORY_NOT_FOUND" ? 404
      : code === "GITHUB_PERMISSION_DENIED" ? 403
      : code === "GITHUB_RATE_LIMITED" ? 429
      : code === "GITHUB_NOT_CONFIGURED" ? 503
      : 502;
    return NextResponse.json({ error: friendly[code] ?? "GitHub 连接失败，请检查 owner/repository 与凭证", code }, { status });
  }
}

export async function DELETE(req: Request) {
  const resolved = await resolveProject(req);
  if (resolved instanceof NextResponse) return resolved;
  const ok = await deleteGitHubConnection(resolved.userId, resolved.projectId);
  if (!ok) {
    return NextResponse.json({ error: "该项目尚未连接 GitHub", code: "GITHUB_NOT_CONNECTED" }, { status: 404 });
  }
  return NextResponse.json({ data: { connected: false } });
}

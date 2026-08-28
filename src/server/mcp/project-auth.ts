import { isAuthEnabled } from "@/lib/auth-config";
import { createServer } from "@/lib/supabase/server";
import { getProjectByDomain, getProjectById, listCompetitors, countTrackedKeywordsByDomain } from "@/lib/db";
import { McpNormalizedError } from "./errors";
import type { ToolAuthContext } from "./context";

export interface AuthorizedProject { id: string; sqliteId: number; name: string; domain: string; createdAt: string; }

export async function authorizeProject(ctx: ToolAuthContext, projectId: string): Promise<AuthorizedProject> {
  if (!projectId?.trim()) throw new McpNormalizedError("BAD_REQUEST", "projectId is required.");
  const ref = projectId.trim();
  let project;
  if (isAuthEnabled && !/^\d+$/.test(ref)) {
    const supabase = await createServer();
    const { data, error } = await supabase.from("projects").select("id, name, domain, created_at").eq("id", ref).eq("user_id", ctx.userId).single();
    if (error || !data) throw new McpNormalizedError("PROJECT_ACCESS_DENIED", "The project is not accessible to this caller.");
    project = await getProjectByDomain(ctx.userId, data.domain);
    if (!project) throw new McpNormalizedError("PROJECT_NOT_FOUND", "The project has no local SeeO record.");
    return { id: data.id, sqliteId: project.id, name: data.name, domain: data.domain, createdAt: data.created_at };
  }
  const sqliteId = Number(ref);
  if (!Number.isInteger(sqliteId) || sqliteId <= 0) throw new McpNormalizedError("BAD_REQUEST", "projectId is invalid.");
  project = await getProjectById(ctx.userId, sqliteId);
  if (!project) throw new McpNormalizedError("PROJECT_ACCESS_DENIED", "The project is not accessible to this caller.");
  return { id: String(project.id), sqliteId: project.id, name: project.name, domain: project.domain, createdAt: project.created_at };
}

export async function listAuthorizedProjects(ctx: ToolAuthContext) {
  if (isAuthEnabled) {
    const supabase = await createServer();
    const { data, error } = await supabase.from("projects").select("id, name, domain, created_at").eq("user_id", ctx.userId).order("created_at", { ascending: true });
    if (error) throw new McpNormalizedError("INTERNAL_ERROR", "Projects could not be loaded.");
    return (data ?? []).map((project) => ({
      projectId: project.id,
      projectName: project.name,
      domain: project.domain,
      createdAt: project.created_at,
      status: "active",
    }));
  }
  const { listProjects } = await import("@/lib/db");
  return (await listProjects(ctx.userId)).map((project) => ({
    projectId: String(project.id),
    projectName: project.name,
    domain: project.domain,
    createdAt: project.created_at,
    status: "active",
  }));
}

export async function projectContext(ctx: ToolAuthContext, projectId: string) {
  const project = await authorizeProject(ctx, projectId);
  const [trackedKeywordsCount, competitors] = await Promise.all([countTrackedKeywordsByDomain(ctx.userId, project.domain), listCompetitors(ctx.userId, project.sqliteId)]);
  return { projectId: project.id, projectName: project.name, domain: project.domain, primaryLocale: null, targetCountry: null, trackedKeywordsCount, competitors: competitors.map((c) => c.domain), gscConnectionStatus: null, latestAuditStatus: null, latestRankTrackingStatus: null, plan: ctx.plan };
}

import { projects as mockProjects, type Project } from "@/lib/mock-data";

// 默认 mock 项目数据（匹配不到域名时使用）
const defaultMock: Project = {
  id: "default",
  domain: "",
  favicon: "?",
  healthScore: 70,
  trackedKeywords: 500,
  rankUp: 30,
  rankDown: 15,
  lastAudit: "暂未审计",
  organicTraffic: "—",
  backlinks: "—",
  trend: Array.from({ length: 14 }, (_, i) => ({
    day: `D${i + 1}`,
    value: 40 + Math.round(Math.sin(i / 2) * 10) + i,
  })),
};

// 根据域名匹配 mock 项目数据
export function matchMockProject(domain: string): Project {
  const matched = mockProjects.find(
    (p) => p.domain === domain
  );
  if (matched) return matched;
  // 没匹配到就用默认值，但替换域名和 favicon
  return {
    ...defaultMock,
    domain,
    favicon: domain.charAt(0).toUpperCase() || "?",
  };
}

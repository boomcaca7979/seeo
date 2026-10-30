// ===== /llms.txt 暂缓页下线行为测试（真实调用 GET）=====
//
// llms.txt 面向 AI crawler 公开分发站点 URL 清单。暂缓上线的公开页
// （/features/backlink-analysis 等）已被 noindex 且移出 sitemap，
// 这里也不得继续对外提供其 URL——否则等于给爬虫一份「被排除页面」的入口清单。
// 开关开启时两条 URL 必须恢复。flag 判定在模块作用域，故用 resetModules + env 切换。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = process.env.BACKLINK_CHECKER_ENABLED;

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.BACKLINK_CHECKER_ENABLED;
  else process.env.BACKLINK_CHECKER_ENABLED = ORIGINAL_ENV;
});

describe("/llms.txt 暂缓路径下线", () => {
  it("开关关闭（生产默认）：不含任何 backlink-analysis URL，其余 URL 保留", async () => {
    delete process.env.BACKLINK_CHECKER_ENABLED;
    const { GET } = await loadRoute();
    const res = GET();
    const body = await res.text();
    expect(body).not.toContain("/features/backlink-analysis");
    expect(body).toContain(`${"https://www.seeo.asia"}/pricing`);
    expect(body).toContain(`${"https://www.seeo.asia"}/features/seo-audit`);
    expect(body).toContain(`${"https://www.seeo.asia"}/login`);
  });

  it("开关开启：两条 backlink-analysis URL（EN+ZH）恢复", async () => {
    process.env.BACKLINK_CHECKER_ENABLED = "true";
    const { GET } = await loadRoute();
    const body = await (await GET()).text();
    expect(body).toContain("https://www.seeo.asia/features/backlink-analysis");
    expect(body).toContain("https://www.seeo.asia/zh/features/backlink-analysis");
    expect(body).toContain("Pro plan only");
  });
});

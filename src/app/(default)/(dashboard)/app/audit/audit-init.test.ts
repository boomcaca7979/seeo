// ===== F2/R2：Audit 页面初始化优先级 + deep-link 竞态 契约测试 =====
// F2 根因：审计时写入 localStorage["seeo:last-audit-domain"]，但刷新初始化没有读取它，
//   域名回退到项目列表第一个 → 刚审计的结果看起来"消失"。
// R2 根因：DomainSelect 独立 fetch /api/projects 后，用挂载时闭包的 value="" 判断"无值"，
//   onChange(第一个项目域名) 覆盖 URL ?domain= 已恢复的选中值（stale closure 竞态）。
// 测试框架限制：无 @testing-library/react，按仓库惯例采用「源码契约断言」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf-8"
);
const DOMAIN_SELECT_SRC = readFileSync(
  fileURLToPath(new URL("../../../../../components/dashboard/DomainSelect.tsx", import.meta.url)),
  "utf-8"
);

describe("F2：刷新后恢复上次审计域名（初始化优先级）", () => {
  it("优先级固定：URL query > last-audit-domain > 第一个项目 > 空", () => {
    expect(PAGE_SRC).toContain("URL ?domain= 参数 > localStorage 上次审计域名 > 项目列表第一个 > 空");
    // 顺序契约：queryDomain 分支在前，lastAuditDomain 分支次之，list[0] 分支最后
    const qIdx = PAGE_SRC.indexOf("if (queryDomain) {");
    const lIdx = PAGE_SRC.indexOf("} else if (lastAuditDomain) {");
    const pIdx = PAGE_SRC.indexOf("} else if (list.length > 0) {");
    expect(qIdx).toBeGreaterThan(-1);
    expect(lIdx).toBeGreaterThan(qIdx);
    expect(pIdx).toBeGreaterThan(lIdx);
  });

  it("初始化读取 localStorage['seeo:last-audit-domain']（与审计写入同一 key）", () => {
    // 写入端（handleConfirmAudit）
    expect(PAGE_SRC).toContain('localStorage.setItem("seeo:last-audit-domain"');
    // 读取端（挂载初始化）
    expect(PAGE_SRC).toContain('window.localStorage.getItem("seeo:last-audit-domain")');
  });

  it("localStorage 读取有 try/catch 防护（隐私模式等场景不抛错）", () => {
    const readIdx = PAGE_SRC.indexOf('window.localStorage.getItem("seeo:last-audit-domain")');
    expect(readIdx).toBeGreaterThan(-1);
    const around = PAGE_SRC.slice(Math.max(0, readIdx - 200), readIdx + 300);
    expect(around).toContain("try");
    expect(around).toContain("catch");
  });
});

describe("R2：DomainSelect deep-link 竞态（stale closure 覆盖）", () => {
  it("默认选第一个项目前读取 valueRef.current（最新 value），不用闭包旧值", () => {
    expect(DOMAIN_SELECT_SRC).toContain("const valueRef = useRef(value);");
    expect(DOMAIN_SELECT_SRC).toContain("valueRef.current = value;");
    expect(DOMAIN_SELECT_SRC).toContain("if (!valueRef.current && json.data.length > 0)");
    // 不允许回退到闭包 value 判断
    expect(DOMAIN_SELECT_SRC).not.toContain("if (!value && json.data.length > 0)");
  });
});

describe("R2：手动切换同步 URL query（刷新保持选中）", () => {
  it("handleDomainChange 用 router.replace 更新 ?domain=（不产生历史记录）", () => {
    expect(PAGE_SRC).toContain("const router = useRouter();");
    expect(PAGE_SRC).toMatch(/router\.replace\(`\/app\/audit\?domain=\$\{encodeURIComponent\(d\)\}`/);
    expect(PAGE_SRC).toContain("{ scroll: false }");
  });

  it("DomainSelect 延迟到页面初始化完成（projectsLoading=false）后挂载，避免瞬态选中第一个项目", () => {
    // 页面先按 URL > localStorage > 项目一 确定 domain，再挂载 DomainSelect；
    // 否则 DomainSelect 的 auto-select 可能先于初始化生效，发起多余的 latest 请求
    const gateIdx = PAGE_SRC.indexOf("{projectsLoading ? (");
    expect(gateIdx).toBeGreaterThan(-1);
    const dsIdx = PAGE_SRC.indexOf("<DomainSelect", gateIdx);
    expect(dsIdx).toBeGreaterThan(gateIdx);
  });
});

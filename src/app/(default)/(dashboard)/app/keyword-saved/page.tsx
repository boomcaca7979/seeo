"use client";

// ===== Saved Keywords（已保存的关键词）=====
//
// 三类「保存」严格分开（不混为一谈）：
//   ① 已追踪关键词：tracked_keywords 表，正在做位置追踪的真实数据（含最新排名/变化）
//   ② 关键词分组：keyword_groups + keyword_group_members（策略分组管理入口）
//   ③ 历史研究：keyword_researches 快照（打开 = keyword-overview?research=<id> 零供应商恢复）
// 数据全部来自本地 DB（/api/tracking、/api/keywords/groups*、/api/keywords/researches*），
// 零供应商 API 成本。空态有明确操作入口，绝不留白页。

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { RK_LINK_CLASS } from "@/components/viz/rank-theme";
import { RankPosition } from "@/components/viz/RankPosition";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { exportCsvRows } from "@/components/keywords/shared";

interface TrackedRow {
  id: number;
  keyword: string;
  location: string;
  device: string;
  domain: string;
  created_at: string;
  todayPosition: number | null;
  yesterdayPosition: number | null;
  change: number | null;
  matchedUrl: string | null;
}

interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  keywordCount: number;
}

interface MemberRow {
  id: number;
  keyword: string;
  location: string;
  device: string;
  domain: string;
}

interface ResearchRow {
  id: number;
  seed: string;
  location: string;
  device: string;
  keywordCount: number;
  savedAt: string;
}

type Tab = "tracked" | "groups" | "researches";

export default function KeywordSavedPage() {
  return (
    <Suspense fallback={null}>
      <KeywordSavedInner />
    </Suspense>
  );
}

function KeywordSavedInner() {
  const t = useTranslations("dashboard.keywords.saved");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const zh = locale === "zh";
  const { show, Toast } = useToast();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("tracked");

  // 追踪词
  const [tracked, setTracked] = useState<TrackedRow[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(true);
  const [trackedError, setTrackedError] = useState<string | null>(null);
  const [trackedQuery, setTrackedQuery] = useState("");

  // 分组
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<Record<number, MemberRow[]>>({});

  // 历史研究
  const [researches, setResearches] = useState<ResearchRow[]>([]);
  const [researchesLoading, setResearchesLoading] = useState(true);
  const [researchesError, setResearchesError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 重新拉取三类数据（失败重试入口共用）
  const [reloadKey, setReloadKey] = useState(0);

  const fmt = (n: number) => new Intl.NumberFormat(zh ? "zh-CN" : "en-US").format(n);

  /** 失败重试：先进入加载态（事件处理器内同步设置，不在 effect 里级联），再触发重新拉取 */
  const retryAll = () => {
    setTrackedLoading(true);
    setGroupsLoading(true);
    setResearchesLoading(true);
    setTrackedError(null);
    setGroupsError(null);
    setResearchesError(null);
    setReloadKey((k) => k + 1);
  };

  // 首次加载三类数据（纯 DB，零供应商）
  // DEF-07：加载期间 tab 计数显示「—」而不是 0，只有确认加载完成且为空才显示 0
  useEffect(() => {
    let alive = true;
    fetch("/api/tracking")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setTracked(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (alive) setTrackedError(tc("loadFailed"));
      })
      .finally(() => {
        if (alive) setTrackedLoading(false);
      });
    fetch("/api/keywords/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setGroups(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (alive) setGroupsError(t("groupsLoadFailed"));
      })
      .finally(() => {
        if (alive) setGroupsLoading(false);
      });
    fetch("/api/keywords/researches")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setResearches(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (alive) setResearchesError(t("researchesLoadFailed"));
      })
      .finally(() => {
        if (alive) setResearchesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tc, t, reloadKey]);

  // 展开分组成员（GET members，本地 DB）
  const toggleGroup = async (groupId: number) => {
    if (openGroupId === groupId) {
      setOpenGroupId(null);
      return;
    }
    setOpenGroupId(groupId);
    if (members[groupId]) return;
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`);
      const json = await res.json();
      if (res.ok) {
        setMembers((prev) => ({ ...prev, [groupId]: Array.isArray(json?.data) ? json.data : [] }));
      }
    } catch {
      // 保持空
    }
  };

  const removeTracked = async (id: number) => {
    if (!window.confirm(t("trackedRemoveConfirm"))) return;
    try {
      const res = await fetch(`/api/tracking?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        show(t("trackedRemoveFailed"), "error");
        return;
      }
      setTracked((prev) => prev.filter((r) => r.id !== id));
      show(t("trackedRemoved"), "success");
    } catch {
      show(t("trackedRemoveFailed"), "error");
    }
  };

  const removeMember = async (groupId: number, keywordId: number) => {
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId }),
      });
      if (!res.ok) {
        show(t("groupMemberRemoveFailed"), "error");
        return;
      }
      setMembers((prev) => ({ ...prev, [groupId]: (prev[groupId] ?? []).filter((m) => m.id !== keywordId) }));
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, keywordCount: Math.max(0, g.keywordCount - 1) } : g)));
      show(t("groupMemberRemoved"), "success");
    } catch {
      show(t("groupMemberRemoveFailed"), "error");
    }
  };

  const deleteGroup = async (groupId: number) => {
    if (!window.confirm(t("groupDeleteConfirm"))) return;
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        show(t("groupDeleteFailed"), "error");
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      if (openGroupId === groupId) setOpenGroupId(null);
      show(t("groupDeleted"), "success");
    } catch {
      show(t("groupDeleteFailed"), "error");
    }
  };

  const openResearch = async (id: number) => {
    // 打开 = 跳到关键词概览的恢复模式（零供应商请求）
    router.push(`/app/keyword-overview?research=${id}`);
  };

  const deleteResearch = async (id: number) => {
    if (!window.confirm(t("researchDeleteConfirm"))) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/keywords/researches/${id}`, { method: "DELETE" });
      const json = res.ok ? null : await res.json().catch(() => null);
      if (!res.ok) {
        const { message } = handleBillingError(json, t("researchDeleteFailed"));
        show(message, "error");
        return;
      }
      setResearches((prev) => prev.filter((r) => r.id !== id));
      show(t("researchDeleted"), "success");
    } catch {
      show(t("researchDeleteFailed"), "error");
    } finally {
      setDeletingId(null);
    }
  };

  const exportTracked = () => {
    exportCsvRows(
      "seeo-tracked-keywords.csv",
      ["keyword", "domain", "location", "device", "todayPosition", "change", "createdAt"],
      filteredTracked.map((r) => [
        r.keyword,
        r.domain,
        r.location,
        r.device,
        r.todayPosition,
        r.change,
        r.created_at,
      ])
    );
  };

  const filteredTracked = tracked.filter((r) =>
    trackedQuery.trim() ? r.keyword.toLowerCase().includes(trackedQuery.trim().toLowerCase()) : true
  );

  return (
    <div className="dash-container p-6 lg:p-8">
      <Toast />

      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{t("title")}</h1>
      <p className="mt-1 font-sans text-sm text-ink-60">{t("subtitle")}</p>

      {/* Tab 导航 */}
      <div className="mt-5 border-b border-line" role="tablist" aria-label={t("tablistLabel")}>
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              { key: "tracked" as const, label: t("tabTracked"), count: trackedLoading ? null : tracked.length },
              { key: "groups" as const, label: t("tabGroups"), count: groupsLoading ? null : groups.length },
              { key: "researches" as const, label: t("tabResearches"), count: researchesLoading ? null : researches.length },
            ]
          ).map((tabItem) => (
            <button
              key={tabItem.key}
              role="tab"
              aria-selected={tab === tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 font-sans text-sm transition-colors ${
                tab === tabItem.key
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent font-medium text-ink-60 hover:text-ink"
              }`}
            >
              {tabItem.label}
              <span className="font-mono text-xs text-ink-40">
                {tabItem.count === null ? "—" : fmt(tabItem.count)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== 已追踪关键词 ===== */}
      {tab === "tracked" && (
        <section className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={trackedQuery}
              onChange={(e) => setTrackedQuery(e.target.value)}
              placeholder={t("trackedSearchPlaceholder")}
              aria-label={t("trackedSearchPlaceholder")}
              className="h-9 w-56 rounded-md border border-line bg-card px-3 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <button type="button" onClick={exportTracked} disabled={tracked.length === 0} className="btn-secondary h-9 px-3 text-xs disabled:opacity-60">
              {t("exportCsv")}
            </button>
            <Link href="/app/keyword-magic" className={`ml-auto font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
              {t("goMagic")}
            </Link>
          </div>

          {trackedLoading ? (
            <p className="mt-4 font-sans text-xs text-ink-40">{tc("loading")}</p>
          ) : trackedError ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="font-sans text-sm text-neg">{trackedError}</p>
              <button type="button" onClick={retryAll} className="btn-secondary h-8 px-3 text-xs">
                {tc("retry")}
              </button>
            </div>
          ) : tracked.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-line py-12 text-center">
              <div className="font-sans text-sm font-medium text-ink">{t("trackedEmptyTitle")}</div>
              <p className="mx-auto mt-1 max-w-md font-sans text-xs text-ink-40">{t("trackedEmptyHint")}</p>
              <Link href="/app/keyword-magic" className="btn-primary mt-4 inline-flex h-9 px-4 text-sm">{t("trackedEmptyAction")}</Link>
            </div>
          ) : (
            <>
              <div className="card-a mt-4 p-4">
                <div className="hidden overflow-x-auto md:block">
                  <DataTable minWidthRem={56} ariaLabel={t("tabTracked")}>
                    <THead>
                      <Th>{t("colKeyword")}</Th>
                      <Th width="10rem">{t("colDomain")}</Th>
                      <Th width="9rem">{t("colMarket")}</Th>
                      <Th align="right" width="7rem">{t("colTodayRank")}</Th>
                      <Th align="right" width="7rem">{t("colChange")}</Th>
                      <Th width="7rem">{t("colAction")}</Th>
                    </THead>
                    <TBody>
                      {filteredTracked.map((r) => (
                        <TR key={r.id}>
                          <TD><span className="font-sans text-sm text-ink">{r.keyword}</span></TD>
                          <TD><span className="font-mono text-xs text-ink-60">{r.domain}</span></TD>
                          <TD><span className="font-sans text-xs text-ink-60">{`${r.location} · ${r.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"}`}</span></TD>
                          <TD align="right" numeric>
                            <RankPosition
                              position={r.todayPosition}
                              state={r.todayPosition === null ? "none" : "live"}
                              noneLabel={t("notRankingYet")}
                              unrankedLabel={t("notInTop100")}
                              staleLabel=""
                            />
                          </TD>
                          <TD align="right" numeric>
                            {r.change === null ? (
                              <span className="font-mono text-sm text-ink-40">—</span>
                            ) : (
                              <span className={`font-mono text-sm ${r.change > 0 ? "text-pos" : r.change < 0 ? "text-neg" : "text-ink-60"}`}>
                                {r.change > 0 ? `↑${r.change}` : r.change < 0 ? `↓${Math.abs(r.change)}` : "0"}
                              </span>
                            )}
                          </TD>
                          <TD>
                            <div className="flex items-center gap-2">
                              <Link href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`} className={`font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
                                {t("openOverview")}
                              </Link>
                              <button type="button" onClick={() => removeTracked(r.id)} className="font-sans text-xs text-neg hover:underline">
                                {t("remove")}
                              </button>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </DataTable>
                </div>
                <div className="md:hidden">
                  {filteredTracked.map((r) => (
                    <div key={r.id} className="border-b border-line-soft py-3 last:border-b-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-sans text-sm font-medium text-ink">{r.keyword}</div>
                          <div className="mt-0.5 truncate font-mono text-xs text-ink-40">{r.domain}</div>
                          <div className="mt-1 font-sans text-xs text-ink-60">{`${r.location} · ${r.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"}`}</div>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <RankPosition
                            position={r.todayPosition}
                            state={r.todayPosition === null ? "none" : "live"}
                            noneLabel={t("notRankingYet")}
                            unrankedLabel={t("notInTop100")}
                            staleLabel=""
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => removeTracked(r.id)} className="font-sans text-xs text-neg hover:underline">
                              {t("remove")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 font-sans text-xs text-ink-40">{t("trackedNote")}</p>
            </>
          )}
        </section>
      )}

      {/* ===== 关键词分组 ===== */}
      {tab === "groups" && (
        <section className="mt-4">
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs text-ink-40">{t("groupsHint")}</p>
            <Link href="/app/keyword-strategy" className={`font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
              {t("goStrategy")}
            </Link>
          </div>
          {groupsLoading ? (
            <p className="mt-4 font-sans text-xs text-ink-40">{tc("loading")}</p>
          ) : groupsError ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="font-sans text-sm text-neg">{groupsError}</p>
              <button type="button" onClick={retryAll} className="btn-secondary h-8 px-3 text-xs">
                {tc("retry")}
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-line py-12 text-center">
              <div className="font-sans text-sm font-medium text-ink">{t("groupsEmptyTitle")}</div>
              <p className="mx-auto mt-1 max-w-md font-sans text-xs text-ink-40">{t("groupsEmptyHint")}</p>
              <Link href="/app/keyword-strategy" className="btn-primary mt-4 inline-flex h-9 px-4 text-sm">{t("groupsEmptyAction")}</Link>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {groups.map((g) => (
                <div key={g.id} className="card-a p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggleGroup(g.id)} aria-expanded={openGroupId === g.id} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <svg viewBox="0 0 24 24" fill="none" className={`h-3.5 w-3.5 flex-shrink-0 text-ink-40 transition-transform ${openGroupId === g.id ? "rotate-90" : ""}`} aria-hidden="true">
                        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate font-sans text-base font-semibold text-ink">{g.name}</span>
                    </button>
                    <span className="font-mono text-xs text-ink-40">{t("memberCount", { count: g.keywordCount })}</span>
                    <StatusBadge label={new Date(g.created_at).toLocaleDateString(zh ? "zh-CN" : "en-US")} tone="neutral" dot={false} />
                    <button type="button" onClick={() => deleteGroup(g.id)} className="rounded-md border border-line px-2 py-1 font-sans text-xs text-neg hover:bg-line-soft">
                      {t("deleteGroup")}
                    </button>
                  </div>
                  {g.description && <p className="mt-1 font-sans text-xs text-ink-40">{g.description}</p>}
                  {openGroupId === g.id && (
                    <ul className="mt-3 space-y-2 border-l border-line pl-4">
                      {(members[g.id] ?? []).length === 0 ? (
                        <li className="font-sans text-xs text-ink-40">{t("membersLoading")}</li>
                      ) : (
                        (members[g.id] ?? []).map((m) => (
                          <li key={m.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{m.keyword}</span>
                            <span className="font-mono text-xs text-ink-40">{`${m.location} · ${m.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"}`}</span>
                            <Link href={`/app/keyword-overview?keyword=${encodeURIComponent(m.keyword)}`} className={`font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
                              {t("openOverview")}
                            </Link>
                            <button
                              type="button"
                              onClick={() => removeMember(g.id, m.id)}
                              className="rounded border border-line px-1.5 py-0.5 font-sans text-xs text-ink-60 hover:bg-line-soft"
                            >
                              {t("removeMember")}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ===== 历史研究 ===== */}
      {tab === "researches" && (
        <section className="mt-4">
          <p className="font-sans text-xs text-ink-40">{t("researchesHint")}</p>
          {researchesLoading ? (
            <p className="mt-4 font-sans text-xs text-ink-40">{tc("loading")}</p>
          ) : researchesError ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="font-sans text-sm text-neg">{researchesError}</p>
              <button type="button" onClick={retryAll} className="btn-secondary h-8 px-3 text-xs">
                {tc("retry")}
              </button>
            </div>
          ) : researches.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-line py-12 text-center">
              <div className="font-sans text-sm font-medium text-ink">{t("researchesEmptyTitle")}</div>
              <p className="mx-auto mt-1 max-w-md font-sans text-xs text-ink-40">{t("researchesEmptyHint")}</p>
              <Link href="/app/keyword-overview" className="btn-primary mt-4 inline-flex h-9 px-4 text-sm">{t("researchesEmptyAction")}</Link>
            </div>
          ) : (
            <div className="card-a mt-4 p-4">
              <div className="hidden overflow-x-auto md:block">
                <DataTable minWidthRem={48} ariaLabel={t("tabResearches")}>
                  <THead>
                    <Th>{t("colKeyword")}</Th>
                    <Th width="9rem">{t("colMarket")}</Th>
                    <Th align="right" width="7rem">{t("colKeywordCount")}</Th>
                    <Th width="10rem">{t("colSavedAt")}</Th>
                    <Th width="9rem">{t("colAction")}</Th>
                  </THead>
                  <TBody>
                    {researches.map((r) => (
                      <TR key={r.id}>
                        <TD><span className="font-sans text-sm text-ink">{r.seed}</span></TD>
                        <TD><span className="font-sans text-xs text-ink-60">{`${r.location} · ${r.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"}`}</span></TD>
                        <TD align="right" numeric><span className="font-mono text-sm">{fmt(r.keywordCount)}</span></TD>
                        <TD><span className="font-mono text-xs text-ink-60">{new Date(r.savedAt).toLocaleString(zh ? "zh-CN" : "en-US")}</span></TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => openResearch(r.id)} className={`font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
                              {t("openResearch")}
                            </button>
                            <button type="button" onClick={() => deleteResearch(r.id)} disabled={deletingId === r.id} className="font-sans text-xs text-neg hover:underline disabled:opacity-60">
                              {t("remove")}
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </DataTable>
              </div>
              <div className="md:hidden">
                {researches.map((r) => (
                  <div key={r.id} className="border-b border-line-soft py-3 last:border-b-0">
                    <div className="font-sans text-sm font-medium text-ink">{r.seed}</div>
                    <div className="mt-0.5 font-sans text-xs text-ink-60">
                      {`${r.location} · ${r.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"} · ${fmt(r.keywordCount)} ${t("keywordsUnit")}`}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-40">{new Date(r.savedAt).toLocaleString(zh ? "zh-CN" : "en-US")}</div>
                    <div className="mt-2 flex gap-3">
                      <button type="button" onClick={() => openResearch(r.id)} className={`font-sans text-xs hover:underline ${RK_LINK_CLASS}`}>
                        {t("openResearch")}
                      </button>
                      <button type="button" onClick={() => deleteResearch(r.id)} disabled={deletingId === r.id} className="font-sans text-xs text-neg hover:underline disabled:opacity-60">
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

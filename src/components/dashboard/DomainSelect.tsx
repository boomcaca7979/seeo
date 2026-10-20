"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadProjectList } from "@/lib/project-selector";
import { useActiveProjectOptional } from "@/components/dashboard/ActiveProjectContext";

interface Project {
  id: string;
  name: string;
  domain: string;
}

interface DomainSelectProps {
  value: string;
  onChange: (domain: string) => void;
  placeholder?: string;
  className?: string;
  /** 可访问名覆盖：调用方已有语义不同的可见标签时使用；缺省见 BUG-43 注释。 */
  label?: string;
}

const MANUAL_KEY = "__manual__";

/**
 * 域名选择器：项目下拉 + 手动输入切换。
 * 挂载时 fetch /api/projects，无项目时直接渲染文本输入框。
 */
export default function DomainSelect({ value, onChange, placeholder, className, label }: DomainSelectProps) {
  const t = useTranslations("dashboard.shared.domainSelect");
  // 控制台内由 ActiveProjectContext 提供项目列表与"当前项目"；
  // 单独渲染（测试、控制台外）时 ctx 为 null，走下面的既有降级路径。
  const ctx = useActiveProjectOptional();
  const ctxRef = useRef(ctx);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  // R2：effect 闭包里的 value 是挂载时的旧值（常为 ""）。
  // 若用闭包 value 判断"无值"，会在 URL ?domain= / localStorage 恢复已生效后
  // 仍用第一个项目域名覆盖选中值（deep-link 竞态）。用 ref 读取最新 value。
  const valueRef = useRef(value);
  // onChange 通常是调用方的内联箭头函数：把它放进 ref，取数回调才能保持稳定，
  // 否则每次父级 render 都会重建 loadProjects → 重新发一次 /api/projects。
  const onChangeRef = useRef(onChange);
  const controllerRef = useRef<AbortController | null>(null);

  // 渲染期禁止写 ref（react-compiler 规则），在 effect 中同步
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // ref 同步放在 effect 里（渲染期写 ref 违反 react-compiler 规则）
  useEffect(() => {
    ctxRef.current = ctx;
  });

  // BUG-17：加载失败与「确实没有项目」必须区分。两者都会退化成手动输入框，
  // 但只有后者才该说「暂无项目」——把 500 / 网络异常说成没有项目，
  // 用户会以为自己的项目被删了，而且不知道该重试。
  const [failed, setFailed] = useState(false);

  const loadProjects = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      // 控制台内：项目列表已由 ActiveProjectProvider 持有 → 直接用，不再打 /api/projects。
      // （此前 Topbar + 每个页面的 DomainSelect 各取一份，同一份数据被取 2~4 次）
      const shared = ctxRef.current;
      if (shared && shared.projects.length > 0) {
        setFailed(false);
        setProjects(shared.projects as Project[]);
        const fallback = shared.activeDomain || (shared.projects[0] as Project).domain;
        if (!valueRef.current && fallback) onChangeRef.current(fallback);
        setLoading(false);
        return;
      }
      // 独立渲染（无 Provider）：走共享取数入口，并发调用自动合并为一次请求
      const json = await loadProjectList();
      // 复位只在响应回来后做：effect 体里同步 setState 会触发级联渲染
      setFailed(false);
      if (json.ok && Array.isArray(json.data)) {
        setProjects(json.data as Project[]);
        // 无值时优先用「顶部的当前项目」，没有才回落第一个项目。
        // 只回落第一个项目正是"顶部选 B、页面显示最早项目 A"的根因。
        const fallback = ctxRef.current?.activeDomain ?? (json.data[0] as Project | undefined)?.domain ?? "";
        if (!valueRef.current && fallback) {
          onChangeRef.current(fallback);
        }
        // 无项目时切到手动输入
        if (json.data.length === 0) {
          setManual(true);
        }
      } else {
        // 非 200 或返回格式异常 → 降级为手动输入，并如实标记失败
        setManual(true);
        setFailed(true);
      }
    } catch {
      // 网络错误/超时/abort → 降级为手动输入，不要停留在 loading
      setManual(true);
      setFailed(true);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // effect 同步体内不能触发 setState（react-hooks/set-state-in-effect），
    // 挂载后排一个宏任务取数；卸载会清掉它，比原来的内联 async IIFE 更安全。
    // 只在挂载时取一次；重试由「重新加载」按钮显式触发。
    const startId = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(startId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时中止在途请求（保持改造前的行为）
  useEffect(() => () => controllerRef.current?.abort(), []);

  const baseClass = className ?? "mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none";

  if (loading) {
    return (
      <div className={baseClass}>
        <span className="text-ink-40">{t("loading")}</span>
      </div>
    );
  }

  // 无项目 或 手动模式：文本输入框
  if (manual || projects.length === 0) {
    return (
      // 包裹层必须是 shrink-safe 的：调用方把 min-w-0/max-w-full 传给了
      // select/input，但这个无类名 div 才是 flex 行里的真正项，
      // 它的固有宽度=「项目名（域名）」整串（实测 390px）会顶穿 360 屏的工具条。
      <div className="min-w-0 max-w-full">
        <input
          type="text"
          // BUG-43：调用方的可见 <label> 只是相邻兄弟（没有 htmlFor/id 配对，
          // 也没包住本组件），读屏到这里会念出「编辑框」而无名字。名字由组件自己给。
          aria-label={label ?? t("inputLabel")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("placeholder")}
          className={baseClass}
        />
        {projects.length > 0 && (
          <button
            type="button"
            onClick={() => setManual(false)}
            className="mt-1 font-sans text-xs text-ink-40 hover:text-ink-60"
          >
            {t("backToSelect")}
          </button>
        )}
        {projects.length === 0 && !failed && (
          <p className="mt-1 font-sans text-xs text-ink-40">
            {t("noProjectsHint")}
          </p>
        )}
        {failed && (
          <p className="mt-1 font-sans text-xs text-neg">
            {t("loadFailedHint")}{" "}
            <button
              type="button"
              onClick={() => void loadProjects()}
              className="underline hover:text-ink"
            >
              {t("retry")}
            </button>
          </p>
        )}
      </div>
    );
  }

  // 下拉选择
  const selectedValue = value && projects.some((p) => p.domain === value)
    ? value
    : MANUAL_KEY;

  return (
    <div className="min-w-0 max-w-full">
      <select
        aria-label={label ?? t("selectLabel")}
        value={selectedValue}
        onChange={(e) => {
          if (e.target.value === MANUAL_KEY) {
            setManual(true);
            onChange("");
          } else {
            onChange(e.target.value);
          }
        }}
        className={baseClass}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.domain}>
            {t("projectOption", { name: p.name, domain: p.domain })}
          </option>
        ))}
        {/* 非项目域名（URL 深链/手动输入）必须显示实际域名，不能只显示「手动输入…」——
            否则审计失败/结果页上用户无法分辨当前看的是哪个站点 */}
        <option value={MANUAL_KEY}>
          {selectedValue === MANUAL_KEY && value
            ? t("manualOptionWithDomain", { domain: value })
            : t("manualOption")}
        </option>
      </select>
    </div>
  );
}

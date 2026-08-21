"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface Project {
  id: number;
  name: string;
  domain: string;
}

interface DomainSelectProps {
  value: string;
  onChange: (domain: string) => void;
  placeholder?: string;
  className?: string;
}

const MANUAL_KEY = "__manual__";

/**
 * 域名选择器：项目下拉 + 手动输入切换。
 * 挂载时 fetch /api/projects，无项目时直接渲染文本输入框。
 */
export default function DomainSelect({ value, onChange, placeholder, className }: DomainSelectProps) {
  const t = useTranslations("dashboard.shared.domainSelect");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  // R2：effect 闭包里的 value 是挂载时的旧值（常为 ""）。
  // 若用闭包 value 判断"无值"，会在 URL ?domain= / localStorage 恢复已生效后
  // 仍用第一个项目域名覆盖选中值（deep-link 竞态）。用 ref 读取最新 value。
  const valueRef = useRef(value);

  // 渲染期禁止写 ref（react-compiler 规则），在 effect 中同步
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let settled = false;

    (async () => {
      try {
        const res = await fetch("/api/projects", {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        if (!settled && res.ok && Array.isArray(json.data)) {
          setProjects(json.data as Project[]);
          // 无值且项目存在时，默认选中第一个（读最新 value，避免覆盖 URL/localStorage 恢复值）
          if (!valueRef.current && json.data.length > 0) {
            onChange((json.data[0] as Project).domain);
          }
          // 无项目时切到手动输入
          if (json.data.length === 0) {
            setManual(true);
          }
        } else if (!settled) {
          // 非 200 或返回格式异常 → 降级为手动输入
          setManual(true);
        }
      } catch {
        // 网络错误/超时/abort → 降级为手动输入，不要停留在 loading
        if (!settled) setManual(true);
      } finally {
        clearTimeout(timeoutId);
        settled = true;
        setLoading(false);
      }
    })();

    return () => {
      settled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div>
        <input
          type="text"
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
        {projects.length === 0 && (
          <p className="mt-1 font-sans text-xs text-ink-40">
            {t("noProjectsHint")}
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
    <div>
      <select
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
        <option value={MANUAL_KEY}>{t("manualOption")}</option>
      </select>
    </div>
  );
}

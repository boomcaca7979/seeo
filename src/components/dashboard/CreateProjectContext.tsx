"use client";

// ===== 共享「创建项目」逻辑（F1：Topbar 与 ProjectList 复用同一 Modal/handler/API）=====
// Provider 挂载于 DashboardShell（跨所有 /app 页面），暴露 openCreateProject()
// 消费方：Topbar（项目切换器内「+ 新建项目」）、ProjectList（首页新建按钮）
// 避免复制第二套创建逻辑；额度校验（项目数 vs max_projects）由调用方在打开前判断

import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Modal from "@/components/dashboard/Modal";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";

interface CreateProjectContextValue {
  openCreateProject: () => void;
}

const CreateProjectContext = createContext<CreateProjectContextValue>({
  openCreateProject: () => {},
});

export function CreateProjectProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { show, Toast } = useToast();
  const t = useTranslations("dashboard.projectList");
  const tc = useTranslations("dashboard.common");
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    const domain = (formData.get("domain") as string).trim();

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(data, t("createFailed"));
        show(message, "error");
        setCreating(false);
        return;
      }
      setModalOpen(false);
      show(t("createdToast"), "success");
      // 优先使用服务端返回的 domain（已规范化），跳转到审计页
      const savedDomain = (data?.data?.domain ?? domain) as string;
      router.push(`/app/audit?domain=${encodeURIComponent(savedDomain)}`);
    } catch {
      show(tc("networkError"), "error");
    }
    setCreating(false);
  };

  const openCreateProject = useCallback(() => setModalOpen(true), []);
  const closeCreateProject = useCallback(() => setModalOpen(false), []);

  return (
    <CreateProjectContext.Provider value={{ openCreateProject }}>
      {children}

      <Modal
        open={modalOpen}
        onClose={closeCreateProject}
        title={t("createTitle")}
        footer={
          <>
            <button
              onClick={closeCreateProject}
              className="btn-secondary"
            >
              {tc("cancel")}
            </button>
            <button
              type="submit"
              form="new-project-form"
              disabled={creating}
              className="btn-primary"
            >
              {creating ? t("creating") : t("createCta")}
            </button>
          </>
        }
      >
        <form id="new-project-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="font-sans text-xs text-ink-60">{t("projectName")}</label>
            <input
              name="name"
              type="text"
              required
              placeholder={t("projectNamePlaceholder")}
              className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
          </div>
          <div>
            <label className="font-sans text-xs text-ink-60">{t("domain")}</label>
            <input
              name="domain"
              type="text"
              required
              placeholder="example.com"
              className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <p className="mt-2 font-sans text-xs text-ink-40">
              {t("domainHint")}
            </p>
          </div>
        </form>
      </Modal>

      <Toast />
    </CreateProjectContext.Provider>
  );
}

export function useCreateProject(): CreateProjectContextValue {
  return useContext(CreateProjectContext);
}
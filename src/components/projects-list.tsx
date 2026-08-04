"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { ProjectSummary } from "@/lib/domain";
import { calculatePerformance } from "@/lib/metrics";
import { formatCurrency, formatPercent } from "@/lib/utils";

const statusLabels = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
  archived: "Arquivado",
};

export function ProjectsList({
  projects: initialProjects,
  warning,
  canManage,
}: {
  projects: ProjectSummary[];
  warning?: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [deletedProjectIds, setDeletedProjectIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingProject, setPendingProject] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const projects = initialProjects.filter(
    (project) => !deletedProjectIds.includes(project.id),
  );

  function requestDelete(project: ProjectSummary) {
    setOpenMenuId(null);
    setDeleteError("");
    setPendingProject(project);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setPendingProject(null);
    setDeleteError("");
  }

  async function deleteProject() {
    if (!pendingProject) return;
    setDeleting(true);
    setDeleteError("");

    const response = await fetch(
      `/api/projects/${encodeURIComponent(pendingProject.id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legacy: Boolean(pendingProject.legacy),
          ...(pendingProject.legacy ? { name: pendingProject.name } : {}),
        }),
      },
    ).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response?.ok) {
      setDeleteError(body?.error ?? "Nao foi possivel excluir o projeto.");
      setDeleting(false);
      return;
    }

    setDeletedProjectIds((current) => [...current, pendingProject.id]);
    setPendingProject(null);
    setDeleting(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3">Carteira Genesis</p>
          <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
            Projetos
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Uma operacao isolada para cada expert, do onboarding ao resultado.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-sm font-bold text-white"
        >
          <Plus size={17} /> Criar projeto
        </Link>
      </header>
      {warning && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
          {warning}
        </p>
      )}

      {projects.length === 0 ? (
        <section className="panel rounded-[24px] px-6 py-14 text-center">
          <p className="text-sm font-black">Nenhum projeto na carteira</p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Crie um projeto para iniciar o acompanhamento da operacao.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {projects.map((project, index) => {
            const totals = calculatePerformance(project.dailyMetrics);
            const progress = Math.min(
              project.monthlyTarget > 0
                ? (totals.revenue / project.monthlyTarget) * 100
                : 0,
              100,
            );
            const menuOpen = openMenuId === project.id;

            return (
              <article
                key={project.id}
                className="panel rise-in group relative rounded-[24px] p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_65px_rgba(21,28,38,.1)]"
                style={{ animationDelay: `${index * 55}ms` }}
              >
                <div className="mb-7 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="grid size-12 place-items-center rounded-[15px] text-xs font-black text-[var(--sidebar)]"
                      style={{ background: project.color }}
                    >
                      {project.initials}
                    </div>
                    <div>
                      <h2 className="font-black tracking-[-0.03em]">{project.name}</h2>
                      <p className="text-xs text-[var(--muted)]">{project.expertName}</p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={`Opcoes do projeto ${project.name}`}
                        aria-expanded={menuOpen}
                        onClick={() =>
                          setOpenMenuId((current) =>
                            current === project.id ? null : project.id,
                          )
                        }
                        className="grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-black/5"
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {menuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_16px_45px_rgba(21,28,38,.18)]"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => requestDelete(project)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            <Trash2 size={14} /> Excluir projeto
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Faturamento
                    </p>
                    <p className="mt-1 text-lg font-black">{formatCurrency(totals.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      ROAS
                    </p>
                    <p className="mt-1 text-lg font-black">{totals.roas.toFixed(2)}x</p>
                  </div>
                </div>

                <div className="mb-5">
                  <div className="mb-2 flex justify-between text-[10px] font-semibold text-[var(--muted)]">
                    <span>Meta mensal</span>
                    <span>{formatPercent(progress, 0)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/[0.055]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${progress}%`, background: project.color }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--line)] pt-4">
                  <span className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    {statusLabels[project.status]}
                  </span>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-1 text-xs font-black"
                  >
                    Abrir <ArrowUpRight size={14} />
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {pendingProject && (
        <div
          role="presentation"
          className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            className="w-full max-w-md rounded-[24px] bg-[var(--paper)] p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
                <AlertTriangle size={19} />
              </span>
              <button
                type="button"
                aria-label="Fechar confirmacao"
                disabled={deleting}
                onClick={closeDeleteDialog}
                className="grid size-9 place-items-center rounded-full text-[var(--muted)] hover:bg-black/5 disabled:opacity-40"
              >
                <X size={17} />
              </button>
            </div>
            <h2
              id="delete-project-title"
              className="mt-5 text-2xl font-black tracking-[-0.04em]"
            >
              Excluir {pendingProject.name}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              O projeto saira da carteira e nao aceitara novas alteracoes. Metricas,
              vendas e registros historicos serao preservados por seguranca.
            </p>
            {deleteError && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
                {deleteError}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={closeDeleteDialog}
                className="rounded-xl border border-[var(--line)] px-4 py-3 text-xs font-bold disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={deleteProject}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Trash2 size={15} />
                )}
                {deleting ? "Excluindo..." : "Confirmar exclusao"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

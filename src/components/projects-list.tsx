import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, Plus } from "lucide-react";
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
  projects,
  warning,
}: {
  projects: ProjectSummary[];
  warning?: string;
}) {
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

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {projects.map((project, index) => {
          const totals = calculatePerformance(project.dailyMetrics);
          const progress = Math.min(
            project.monthlyTarget > 0
              ? (totals.revenue / project.monthlyTarget) * 100
              : 0,
            100,
          );

          return (
            <article
              key={project.id}
              className="panel rise-in group rounded-[24px] p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_65px_rgba(21,28,38,.1)]"
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
                <button
                  type="button"
                  aria-label="Mais opcoes"
                  className="grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-black/5"
                >
                  <MoreHorizontal size={17} />
                </button>
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
    </div>
  );
}

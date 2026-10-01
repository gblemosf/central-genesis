"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleAlert, FolderKanban, ListChecks } from "lucide-react";
import { setupStatusLabels, type SetupStep } from "@/lib/setup-guide";

const tones = {
  available: "bg-emerald-50 text-emerald-800", pending: "bg-amber-50 text-amber-900",
  review: "bg-blue-50 text-blue-900", optional: "bg-slate-100 text-slate-700", unknown: "bg-slate-100 text-slate-700",
};

export function SetupGuide({ steps, projects, demoMode }: {
  steps: SetupStep[];
  projects: { id: string; name: string; expertName: string }[];
  demoMode: boolean;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const next = steps.find((step) => step.status === "pending" || step.status === "review");
  function destination(step: SetupStep) {
    return step.projectView && projectId ? `/projects/${projectId}?view=${step.projectView}` : step.href;
  }
  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow mb-3">Preparar a operação</p>
        <h1 className="text-3xl font-black tracking-[-0.05em] sm:text-4xl">O que configurar, na ordem certa</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">Conecte as fontes uma vez, vincule os produtos ao projeto e confira os dados. Depois, sua rotina é escolher projeto, período e produtos para analisar.</p>
      </header>

      {demoMode && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Demonstração. Este roteiro usa exemplos e não confirma as configurações de produção.</p>}

      <section aria-label="Escolher projeto para configurar" className="panel flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-black">Qual projeto você quer preparar?</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Os atalhos abaixo abrem a configuração deste projeto. Conexões são compartilhadas pela organização.</p>
        </div>
        {projects.length ? <label className="min-w-0 sm:w-80">
          <span className="sr-only">Projeto do passo a passo</span>
          <select className="field" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.expertName}</option>)}
          </select>
        </label> : <Link href="/projects/new" className="inline-flex items-center gap-2 text-sm font-bold">Criar primeiro projeto <ArrowRight size={16} /></Link>}
      </section>

      {next && <section className="flex flex-col gap-4 rounded-2xl bg-[var(--sidebar)] p-6 text-white sm:flex-row sm:items-center sm:justify-between" aria-label="Próximo passo sugerido">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/55">Próximo passo sugerido</p>
          <h2 className="mt-2 text-xl font-black">{next.title}</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-white/70">{next.description}</p>
        </div>
        <Link href={destination(next)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold text-[var(--ink)]">{next.action} <ArrowRight size={14} /></Link>
      </section>}

      <section aria-labelledby="setup-steps-title">
        <div className="mb-4">
          <h2 id="setup-steps-title" className="text-xl font-black">Roteiro de configuração</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">Abra uma etapa para ver o que precisa fazer e onde. “Disponível” indica o cadastro ou a estrutura consultada nesta visita; confirme eventos e sincronizações antes de confiar na atualização automática.</p>
        </div>
        <ol className="space-y-3">
          {steps.map((step, index) => <li key={step.id}>
            <details className="group panel rounded-2xl" open={step.id === next?.id}>
              <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-black/5 text-sm font-black">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black">{step.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.description}</p>
                  <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${tones[step.status]}`}>
                    {step.status === "available" ? <Check size={12} /> : step.status === "pending" ? <CircleAlert size={12} /> : <ListChecks size={12} />}
                    {demoMode ? "Exemplo" : setupStatusLabels[step.status]}
                  </span>
                </div>
                <ChevronDown size={18} className="shrink-0 text-[var(--muted)] transition group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t border-[var(--line)] p-5 sm:pl-[72px]">
                <p className="rounded-xl bg-black/[0.035] p-3 text-xs leading-5">{step.evidence}</p>
                <ul className="list-disc space-y-2 pl-4 text-xs leading-6 text-[var(--muted)]">
                  {step.tasks.map((task) => <li key={task}>{task}</li>)}
                </ul>
                <Link href={destination(step)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-3 text-xs font-bold text-white">{step.action} <ArrowRight size={14} /></Link>
              </div>
            </details>
          </li>)}
        </ol>
      </section>

      <section className="panel rounded-2xl p-6" aria-labelledby="routine-title">
        <h2 id="routine-title" className="text-xl font-black">Depois da configuração, onde consultar?</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {[
            ["Vendas e público", "Compras e recuperações ficam em Vendas. Contatos e respostas ficam em Público."],
            ["Divulgação", "Origens e UTMs mostram a atribuição recebida. Tráfego diário mostra o investimento da Meta."],
            ["Financeiro", "Receita das vendas separa bruto, taxas e líquido. Custos e saldo inclui despesas. Projeções são cenários futuros."],
          ].map(([title, description]) => <div key={title}><h3 className="text-sm font-bold">{title}</h3><p className="mt-2 text-xs leading-6 text-[var(--muted)]">{description}</p></div>)}
        </div>
        <Link href={projectId ? `/projects/${projectId}` : "/projects"} className="mt-6 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4"><FolderKanban size={16} /> {projectId ? "Abrir painel do projeto" : "Abrir projetos"}</Link>
      </section>
    </div>
  );
}

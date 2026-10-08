"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnalysisFilters } from "@/components/analysis-filters";
import { DataHelp, MetricCard } from "@/components/metric-card";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  IntegrationConnection,
  ProjectSummary,
} from "@/lib/domain";
import { calculatePerformance } from "@/lib/metrics";
import {
  buildOverviewDailySeries,
  connectionOperationalSummary,
  overviewDataAvailability,
} from "@/lib/overview";
import {
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils";

interface OverviewDashboardProps {
  projects: ProjectSummary[];
  connections: IntegrationConnection[];
  source: "live" | "demo";
  reportingDate: string;
  period: { start: string; end: string };
  warning?: string;
}

const statusLabel = {
  connected: "Conectada",
  attention: "Atenção",
  disconnected: "Desconectada",
  revoked: "Revogada",
};

export function OverviewDashboard({
  projects,
  connections,
  source,
  reportingDate,
  warning,
  period,
}: OverviewDashboardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedProject, setSelectedProject] = useState("all");
  const activeProjects = projects.filter((project) => project.status === "active");
  const visibleProjects =
    selectedProject === "all"
      ? activeProjects
      : activeProjects.filter((project) => project.id === selectedProject);
  const projectPeriods = visibleProjects.map(project => {
    const rows = project.dailyMetrics.filter(row => row.date >= period.start && row.date <= period.end);
    return { project, rows, available: overviewDataAvailability(rows) };
  });
  const rows = projectPeriods.flatMap(project => project.rows);
  const totals = calculatePerformance(rows);
  const byDate = buildOverviewDailySeries(rows, reportingDate, period.start, projectPeriods.map(project => project.rows));
  const revenueAvailable = projectPeriods.length > 0 && projectPeriods.every(project => project.available.revenue);
  const trafficAvailable = projectPeriods.length > 0 && projectPeriods.every(project => project.available.traffic);
  const salesAvailable = projectPeriods.length > 0 && projectPeriods.every(project => project.available.sales);
  const complete = revenueAvailable && trafficAvailable;
  const missingSources = projectPeriods.flatMap(({ project, available }) => {
    const missing = [
      !available.revenue && "líquido após taxas",
      !available.traffic && "tráfego",
      !available.sales && "quantidade de vendas",
    ].filter(Boolean);
    return missing.length ? [{ id: project.id, name: project.name, missing: missing.join(", ") }] : [];
  });

  const kpis = [
    {
      label: "Líquido registrado após taxas",
      value: revenueAvailable ? formatCurrency(totals.revenue) : "Indisponível",
      hint: visibleProjects.some(project => project.qualityWarnings?.length) ? "Base parcial: recebimentos pendentes abaixo" : salesAvailable ? `${formatNumber(totals.coreSales)} vendas registradas do produto de entrada` : "Quantidade de vendas indisponível",
      view: "results",
      available: revenueAvailable,
      color: "var(--mint)",
    },
    {
      label: "Investimento em mídia",
      value: trafficAvailable ? formatCurrency(totals.investment) : "Indisponível",
      hint: trafficAvailable
        ? totals.ctr !== null ? `${formatPercent(totals.ctr)} CTR consolidado` : "Sem impressões para calcular CTR"
        : "Tráfego incompleto no período",
      view: "metrics",
      available: trafficAvailable,
      color: "var(--coral)",
    },
    {
      label: "Saldo após mídia",
      value: complete && totals.profit !== null ? formatCurrency(totals.profit) : "Indisponível",
      hint: complete ? "Líquido após taxas menos mídia; não representa lucro" : "Confira os projetos com dados indisponíveis abaixo",
      view: "financial",
      available: complete && totals.profit !== null,
      color: totals.profit !== null && totals.profit >= 0 ? "var(--signal)" : "var(--coral)",
    },
    {
      label: "ROAS líquido registrado",
      value: complete && totals.investment > 0 && totals.roas !== null ? `${totals.roas.toFixed(2)}x` : "Indisponível",
      hint: trafficAvailable && salesAvailable && totals.coreSales > 0 && totals.cpa !== null
        ? `Mídia por venda de entrada: ${formatCurrency(totals.cpa)} · inclui orgânicas`
        : complete && totals.investment === 0 ? "Sem investimento no período: não há divisor para o ROAS" : "Depende de líquido e investimento disponíveis",
      view: "financial",
      available: complete && totals.investment > 0 && totals.roas !== null,
      color: "var(--violet)",
    },
  ];

  return (
    <div className="space-y-6" aria-busy={pending}>
      <header className="rise-in flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow mb-3">Central Gênesis</p>
          <h1 className="max-w-3xl text-3xl font-black tracking-[-0.04em] sm:text-4xl">
            Visão geral dos projetos
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Compare os resultados e abra um projeto para analisar produtos, vendas e origens.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/setup" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 text-xs font-bold">Passo a passo <ArrowRight size={14} /></Link>
          <Link
            href="/projects/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-sm font-bold text-white transition hover:-translate-y-0.5"
          >
            <Plus size={17} /> Novo projeto
          </Link>
        </div>
      </header>

      <AnalysisFilters value={{ ...period, productIds: null }} products={[]} hideProducts
        context={<><label className="flex w-full min-w-0 items-center gap-3 text-xs font-semibold sm:w-auto sm:flex-1">Projeto<select aria-label="Projeto na visão geral" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} className="field max-w-sm text-sm"><option value="all">Todos os projetos ativos</option>{activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><span className="text-xs text-[var(--muted)]">{visibleProjects.length} projeto(s) nesta análise</span></>}
        onChange={(value) => startTransition(() => router.replace(`/overview?${new URLSearchParams({ start: value.start, end: value.end })}`, { scroll: false }))} />
      {pending && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm">Atualizando o período. Aguarde para conferir os novos resultados.</p>}
      <div className={pending ? "pointer-events-none space-y-6 opacity-40" : "space-y-6"}>

      {(source === "demo" || warning) && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-100/55 px-4 py-3 text-xs font-medium text-amber-950">
          {warning ??
            "Modo demonstracao ativo. Configure o Supabase para visualizar os dados reais."}
        </div>
      )}
      {visibleProjects.flatMap(project => (project.qualityWarnings ?? []).map(message => (
        <p key={`${project.id}:${message}`} className="rounded-xl bg-amber-50 p-4 text-xs leading-5"><strong>{project.name} — base parcial.</strong> {message} Saldo e ROAS dependem dessa conciliação.</p>
      )))}

      <section aria-label="Indicadores principais" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(kpi => <MetricCard key={kpi.label} label={kpi.label} value={kpi.value} hint={kpi.hint} accent={kpi.color} unavailable={!kpi.available}
          action={{ label: kpi.available ? "Conferir composição" : "Conferir fontes", href: visibleProjects.length === 1
            ? `/projects/${visibleProjects[0].id}?${new URLSearchParams({ view: kpi.available ? kpi.view : "settings", start: period.start, end: period.end })}`
            : missingSources.length ? "#overview-sources" : "#overview-projects" }} />)}
      </section>

      {missingSources.length > 0 && (
        <div id="overview-sources" className="scroll-mt-56 rounded-xl border border-amber-400/30 bg-amber-100/55 px-4 py-3 text-xs leading-5 text-amber-950">
          <p className="font-bold">Dados indisponíveis no período selecionado</p>
          <p>Os projetos abaixo continuam na seleção. Os totais que dependem dessas fontes ficam indisponíveis; ausência de registros não comprova valor zero.</p>
          <ul className="mt-2 list-inside list-disc">
            {missingSources.map(project => <li key={project.id}><Link className="underline" href={`/projects/${project.id}?${new URLSearchParams({ view: "settings", start: period.start, end: period.end })}`}>{project.name} — revisar fontes</Link>: {project.missing}.</li>)}
          </ul>
        </div>
      )}

      <DataHelp><p>Valores dos eventos recebidos ou importados; ainda não comprovam todo o histórico dos gateways. O líquido após taxas é anterior à divisão entre participantes. O gasto da Meta corresponde à última sincronização. ROAS e mídia por venda cruzam totais do período, incluindo vendas orgânicas; não são a atribuição da Meta. O saldo não considera custos externos nem a divisão entre parceiros.</p></DataHelp>

      {rows.length > 0 && <section className="grid gap-4 xl:grid-cols-[1.55fr_.8fr]">
        <article className="panel rounded-[24px] p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Pulso financeiro</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                Líquido e investimento diário
              </h2>
            </div>
            <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-[var(--mint)]" /> Líquido
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-[var(--coral)]" /> Meta
              </span>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={byDate} margin={{ left: -18, right: 8 }}>
                <defs>
                  <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#61d6c8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#61d6c8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#dcd8cf" strokeDasharray="4 5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => `${value.slice(8)}/${value.slice(5, 7)}`}
                  tick={{ fontSize: 10, fill: "#69717c" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => formatNumber(value, true)}
                  tick={{ fontSize: 10, fill: "#69717c" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => value === null || value === undefined ? "Indisponível" : formatCurrency(Number(value))}
                  labelFormatter={(label) => `Dia ${String(label).slice(8)}`}
                  contentStyle={{
                    background: "#121a24",
                    border: 0,
                    borderRadius: 12,
                    color: "white",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="linear"
                  dataKey="revenue"
                  name="Líquido após taxas"
                  connectNulls={false}
                  stroke="#20a999"
                  strokeWidth={2.5}
                  fill="url(#revenue)"
                />
                <Area
                  type="linear"
                  dataKey="investment"
                  name="Investimento em mídia"
                  connectNulls={false}
                  stroke="#ff6b5e"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">Lacunas indicam dados indisponíveis. Um dia sem informação não é exibido como zero.</p>
        </article>

        <article className="rounded-[24px] bg-[var(--sidebar)] p-5 text-white sm:p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                Ritmo de vendas
              </p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                Vendas de entrada por dia
              </h2>
            </div>
            <ShoppingBag size={19} className="text-[var(--signal)]" />
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDate} margin={{ left: -28 }}>
                <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => `${value.slice(8)}/${value.slice(5, 7)}`}
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,.35)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,.35)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,.04)" }}
                  contentStyle={{
                    background: "#f1eee7",
                    border: 0,
                    borderRadius: 12,
                    color: "#151c26",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="coreSales" name="Vendas de entrada" fill="#d8ff63" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>}

      <section id="overview-projects" className="grid scroll-mt-56 gap-4 xl:grid-cols-[1.25fr_1fr]">
        <article className="panel rounded-[24px] p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="eyebrow">Carteira ativa</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                Projetos em operação
              </h2>
            </div>
            <Link
              href="/projects"
              className="text-xs font-bold text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Ver todos
            </Link>
          </div>
          <div className="space-y-2">
            {visibleProjects.map((project) => {
              const projectRows = project.dailyMetrics.filter((row) => row.date >= period.start && row.date <= period.end);
              const performance = calculatePerformance(projectRows);
              const available = overviewDataAvailability(projectRows);
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}?${new URLSearchParams({ start: period.start, end: period.end })}`}
                  className="group flex items-center gap-3 rounded-2xl border border-transparent px-2 py-3 transition hover:border-[var(--line)] hover:bg-white/60 sm:gap-4 sm:px-3"
                >
                  <div
                    className="grid size-11 shrink-0 place-items-center rounded-[14px] text-xs font-black text-[var(--sidebar)]"
                    style={{ background: project.color }}
                  >
                    {project.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{project.name}</p>
                    <p className="truncate text-[11px] text-[var(--muted)]">
                      {project.expertName}
                      <span className="mt-1 block">{project.lastSyncAt ? `Última sincronização: ${new Date(project.lastSyncAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Sincronização sem horário informado"}</span>
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-black">{available.revenue ? formatCurrency(performance.revenue) : "Líquido indisponível"}</p>
                    <p className="text-[10px] text-[var(--muted)]">
                      {available.revenue && available.traffic && performance.investment > 0 && performance.roas !== null ? `${performance.roas.toFixed(2)}x ROAS líquido` : "Confira as fontes"}
                    </p>
                  </div>
                  <ArrowUpRight
                    size={16}
                    className="text-[var(--muted)] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </Link>
              );
            })}
            {activeProjects.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-center">
                <p className="text-xs font-black">Nenhum projeto ativo</p>
                <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
                  Abra um projeto em revisao, conclua o abastecimento e altere o status
                  para Ativo.
                </p>
                <Link href="/projects" className="mt-4 inline-flex text-xs font-black">
                  Revisar projetos <ArrowUpRight size={14} />
                </Link>
              </div>
            )}
          </div>
        </article>

        <article className="panel rounded-[24px] p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="eyebrow">Fontes dos dados</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                Estado das conexões
              </h2>
            </div>
            <RefreshCw size={17} className="text-[var(--muted)]" />
          </div>
          <p className="mb-4 text-xs leading-5 text-[var(--muted)]">Conexão cadastrada não garante dados recentes. Confira a última verificação e os erros de sincronização.</p>
          <div className="space-y-3">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/45 p-3.5"
              >
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    connection.status === "connected" && "bg-emerald-500",
                    connection.status === "attention" && "bg-amber-400",
                    connection.status === "disconnected" && "bg-slate-300",
                    connection.status === "revoked" && "bg-red-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold">{connection.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">
                    {connectionOperationalSummary(connection)}
                    {connection.lastVerifiedAt && <span className="mt-1 block">Verificada em {new Date(connection.lastVerifiedAt).toLocaleDateString("pt-BR")}</span>}
                  </p>
                </div>
                <span className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {statusLabel[connection.status]}
                </span>
              </div>
              ))}
          </div>
          <Link
            href="/integrations"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] py-2.5 text-xs font-bold transition hover:bg-white"
          >
            Gerenciar conexões <ArrowUpRight size={14} />
          </Link>
        </article>
      </section>
      </div>
    </div>
  );
}

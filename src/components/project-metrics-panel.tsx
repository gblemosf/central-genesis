"use client";

import {
  ArrowRight,
  ArrowUpDown,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  Save,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type {
  AutomaticMetricField,
  ProjectAnalytics,
  ProjectFunnelStage,
  ProjectMetricConfig,
  ProjectProduct,
} from "@/lib/domain";
import {
  inspectMetricsCsv,
  type MetricsCsvInspection,
} from "@/lib/metrics-csv";
import {
  aggregateProjectDailyMetrics,
  calculateDailyPerformance,
  calculateFinancialSummary,
  calculateProjectionScenario,
  percentage,
} from "@/lib/project-metrics";
import { automaticMetricFields, resolveMetricReferences, usesAutomaticMetric, type MetricReference } from "@/lib/metric-references";
import { filterProductMetrics, type AnalysisFilter } from "@/lib/analysis-filters";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function hasMetricData(metric: ProjectAnalytics["dailyMetrics"][number]) {
  return (
    metric.investment !== 0 ||
    metric.revenue !== 0 ||
    metric.impressions !== 0 ||
    metric.clicks !== 0 ||
    metric.pageViews !== 0 ||
    metric.checkouts !== 0 ||
    metric.coreSales !== 0 ||
    Boolean(metric.csvDaily && Object.values(metric.csvDaily).some((value) => value !== 0)) ||
    metric.productMetrics.some(
      (product) => product.quantity !== 0 || product.revenue !== 0,
    )
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  help,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  help: string;
}) {
  return (
    <label className="block text-xs font-bold">
      <span className="flex items-center justify-between gap-2">
        {label}
        <span className="rounded-full bg-violet-50 px-2 py-1 text-[8px] uppercase tracking-wider text-violet-800">
          Manual
        </span>
      </span>
      <div className="relative">
        <input
          className="field mt-2 pr-12"
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]">
            {suffix}
          </span>
        )}
      </div>
      <span className="mt-2 block text-[10px] font-normal leading-4 text-[var(--muted)]">
        {help}
      </span>
    </label>
  );
}

function CsvPreview({ preview }: { preview: MetricsCsvInspection | null }) {
  if (!preview) return null;
  return (
    <div className="mt-4 rounded-xl bg-black/[0.035] p-3 font-normal">
      <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-wider">
        <span className="rounded-full bg-white px-2 py-1">
          Metricas diarias
        </span>
        <span>{preview.rows.length} linha(s) valida(s)</span>
        <span>{preview.errors.length} erro(s)</span>
      </div>
      <p className="mt-2 break-words text-[9px] leading-4 text-[var(--muted)]">
        {preview.headers.join(" | ") || "Cabecalhos indisponiveis"}
      </p>
      {preview.errors.length > 0 && (
        <ul className="mt-3 max-h-28 space-y-1 overflow-auto rounded-lg bg-red-50 p-3 text-[9px] text-red-800">
          {preview.errors.map((error, index) => (
            <li key={`${error.line ?? "file"}-${index}`}>{error.message}</li>
          ))}
        </ul>
      )}
      {preview.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-[9px]">
            <tbody>
              {preview.rows.slice(0, 3).map((row) => (
                <tr key={row.line} className="border-t border-black/5">
                  <td className="whitespace-nowrap py-1 pr-3 font-bold">Linha {row.line}</td>
                  <td className="whitespace-nowrap py-1 text-[var(--muted)]">
                    {Object.values(row.raw).join(" | ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReferenceField({ label, field, config, reference, onMode, onChange }: {
  label: string; field: AutomaticMetricField; config: ProjectMetricConfig; reference: MetricReference;
  onMode: (automatic: boolean) => void; onChange: (value: number) => void;
}) {
  const automatic = usesAutomaticMetric(config, field);
  return <div className="space-y-2 text-xs">
    <div className="flex items-center justify-between gap-2">
      <label className="font-bold" htmlFor={`metric-${field}`}>{label}</label>
      <select aria-label={`Fonte de ${label}`} className="rounded-lg border border-[var(--line)] bg-white p-1 text-[10px]"
        value={automatic ? "auto" : "manual"} onChange={(event) => onMode(event.target.value === "auto")}>
        <option value="auto">Automático</option><option value="manual">Personalizar</option>
      </select>
    </div>
    {automatic ? <output id={`metric-${field}`} className="field block bg-emerald-50 font-bold">
      {reference.value === null ? "Aguardando dados" : decimalFormatter.format(reference.value)}
    </output> : <input id={`metric-${field}`} className="field" type="number" min="0" step="0.01"
      value={config[field]} onChange={(event) => onChange(Number(event.target.value) || 0)} />}
    <p className="text-[10px] leading-4 text-[var(--muted)]">{automatic ? reference.detail : "Valor personalizado preservado. Selecione Automático para acompanhar as integrações."}</p>
  </div>;
}

export function ProjectMetricsPanel({
  projectId,
  analytics: initialAnalytics,
  products,
  stages,
  demoMode,
  readOnly = false,
  filter,
  view: controlledView,
  onViewChange,
}: {
  projectId: string;
  analytics: ProjectAnalytics;
  products: ProjectProduct[];
  stages: ProjectFunnelStage[];
  demoMode: boolean;
  readOnly?: boolean;
  filter: AnalysisFilter;
  view?: "daily" | "financial" | "planning" | "data" | "config";
  onViewChange?: (view: "daily" | "financial" | "planning" | "data" | "config") => void;
}) {
  const router = useRouter();
  const [loadedAnalytics, setLoadedAnalytics] = useState<ProjectAnalytics | null>(null);
  const sourceAnalytics = loadedAnalytics ?? initialAnalytics;
  const productSubset = filter.productIds !== null;
  const analytics = { ...sourceAnalytics, dailyMetrics: filterProductMetrics(sourceAnalytics.dailyMetrics.filter(
    (row) => row.date >= filter.start && row.date <= filter.end,
  ), filter.productIds) };
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const hasObservedData = analytics.dailyMetrics.some(hasMetricData);
  const hasAnySourceRows =
    analytics.dataSources.csvDailyRows > 0 ||
    analytics.dataSources.metaTrafficRows > 0 ||
    analytics.dataSources.webhookSalesEvents > 0;
  const [isRefreshing, startTransition] = useTransition();
  const [localView, setLocalView] = useState<
    "daily" | "financial" | "planning" | "data" | "config"
  >(hasObservedData ? "daily" : "data");
  const view = controlledView ?? localView;
  const setView = onViewChange ?? setLocalView;
  const [config, setConfig] = useState(analytics.config);
  const [configConfirmed, setConfigConfirmed] = useState(analytics.configSaved);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(analytics.warning ?? "");
  const [metricsFile, setMetricsFile] = useState<File | null>(null);
  const [metricsPreview, setMetricsPreview] = useState<MetricsCsvInspection | null>(null);
  const [inspectingCsv, setInspectingCsv] = useState(false);
  const inspectionSequence = useRef(0);
  const [importing, setImporting] = useState(false);
  const metricsInput = useRef<HTMLInputElement>(null);
  const csvHasErrors = Boolean(
    inspectingCsv || metricsPreview?.errors.length,
  );
  const populatedRows = analytics.dailyMetrics.filter(hasMetricData);
  const [dailyStart, setDailyStart] = useState(analytics.config.periodStart);
  const [dailyEnd, setDailyEnd] = useState(analytics.config.periodEnd);
  const [dailyAscending, setDailyAscending] = useState(true);
  useEffect(() => {
    if (demoMode || readOnly) return;
    const controller = new AbortController();
    async function loadPeriod() {
      setLoadingPeriod(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/analytics?${new URLSearchParams({ periodStart: filter.start, periodEnd: filter.end })}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || body.data?.warning) throw new Error(body.error ?? body.data?.warning ?? "Não foi possível carregar o período.");
        if (!controller.signal.aborted) {
          setLoadedAnalytics(body.data);
          setConfig((current) => ({ ...current, periodStart: filter.start, periodEnd: filter.end }));
          setDailyStart(filter.start); setDailyEnd(filter.end);
          setMessage("");
        }
      } catch (cause) {
        if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : "Falha ao carregar o período.");
      } finally { if (!controller.signal.aborted) setLoadingPeriod(false); }
    }
    void loadPeriod();
    return () => controller.abort();
  }, [filter.start, filter.end, projectId, demoMode, readOnly]);
  const dailyRows = populatedRows
    .filter((metric) => metric.date >= dailyStart && metric.date <= dailyEnd)
    .sort((a, b) => dailyAscending
      ? a.date.localeCompare(b.date)
      : b.date.localeCompare(a.date));
  const hasRevenueMetrics = populatedRows.some((metric) => metric.revenue !== 0);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const mappedProducts = products
    .filter((product) => product.mappedProjectId === projectId && product.stageId)
    .sort((a, b) => {
      const positionA = stageById.get(a.stageId ?? "")?.position ?? 0;
      const positionB = stageById.get(b.stageId ?? "")?.position ?? 0;
      return positionA - positionB || a.name.localeCompare(b.name);
    });
  const selectedReference = filter.productIds?.length === 1 ? mappedProducts.find((product) =>
    product.id === filter.productIds![0] && ["core", "front_end", "low_ticket"].includes(stageById.get(product.stageId ?? "")?.type ?? "")) : null;
  const referenceConfig = !config.ticketProductId && selectedReference ? { ...config, ticketProductId: selectedReference.id } : config;
  const resolved = resolveMetricReferences(referenceConfig, mappedProducts, stages, analytics.observedSales ?? [],
    sourceAnalytics.dailyMetrics, analytics.dataSources.webhookSalesEvents > 0 && !analytics.warning);
  const effective = resolved.effective;
  const performance = (metric: ProjectAnalytics["dailyMetrics"][number]) => {
    const value = calculateDailyPerformance(metric, config.trafficFeePercent);
    return productSubset ? { ...value, cpa: null, checkoutConversion: null, coreRoas: null, generalRoas: null } : value;
  };
  const calculatedRows = dailyRows.map(performance);
  const aggregate = aggregateProjectDailyMetrics(populatedRows);
  const dailyAggregate = aggregateProjectDailyMetrics(dailyRows);
  const orderBumpProducts = aggregate.productMetrics
    .filter((product) => product.stageType === "order_bump")
    .sort((a, b) => {
      const positionA = stageById.get(a.stageId)?.position ?? 0;
      const positionB = stageById.get(b.stageId)?.position ?? 0;
      return positionA - positionB || a.productName.localeCompare(b.productName);
    })
    .slice(0, 3);
  const orderBumpSlots = Array.from(
    { length: 3 },
    (_, index) => orderBumpProducts[index] ?? null,
  );
  const total = performance(dailyAggregate);
  const financial = calculateFinancialSummary(populatedRows, config);
  const productTotals = aggregate.productMetrics;

  const ticketProductId = resolved.ticketId;
  const formationProductId = resolved.formationId;
  const downsellProductId = resolved.downsellId;
  const productTotal = (productId: string | null) => {
    const matches = productTotals.filter((product) => product.productId === productId);
    if (!matches.length) return null;
    return matches.reduce(
      (total, product) => ({
        ...total,
        quantity: total.quantity + product.quantity,
        revenue: total.revenue + product.revenue,
      }),
      { ...matches[0], quantity: 0, revenue: 0 },
    );
  };
  const ticketTotal = productTotal(ticketProductId);
  const formationTotal = productTotal(formationProductId);
  const downsellTotal = productTotal(downsellProductId);
  const ticketPrice = effective.ticketNetPrice;
  const formationPrice = effective.formationNetPrice;
  const baseScenario = calculateProjectionScenario(
    effective.baseCpa,
    effective,
    ticketPrice,
    formationPrice,
  );
  const idealScenario = calculateProjectionScenario(
    config.idealCpa || effective.baseCpa,
    effective,
    ticketPrice,
    formationPrice,
  );
  const historicalAttendanceRate = percentage(
    config.historicalAttendance,
    effective.historicalTicketSales,
  );
  const historicalFormationRate = percentage(
    effective.historicalFormationSales,
    config.historicalAttendance,
  );
  const historicalTicketConversion = percentage(
    effective.historicalFormationSales,
    effective.historicalTicketSales,
  );
  const plannedBudget =
    config.ticketBudget +
    config.apiBudget +
    config.remarketingBudget +
    config.distributionBudget;
  const planningRequirements = [
    { ready: config.ticketBudget > 0, label: "Orcamento de ingresso" },
    { ready: ticketPrice > 0, label: "Produto ou ticket liquido de ingresso" },
    { ready: effective.baseCpa > 0, label: "CPA base observado ou personalizado" },
    { ready: effective.historicalTicketSales > 0, label: "Vendas no período de referência" },
    { ready: !formationProductId || config.historicalAttendance > 0, label: "Comparecimento (se houver formação)" },
    {
      ready: !formationProductId || (formationPrice > 0 && resolved.references.historicalFormationSales.value !== null),
      label: "Ticket liquido da formacao",
    },
  ];
  const missingPlanning = planningRequirements.filter((requirement) => !requirement.ready);
  const planningReady = missingPlanning.length === 0;
  const trafficSourceSummary = [
    analytics.dataSources.csvDailyRows > 0
      ? `${analytics.dataSources.csvDailyRows} linha(s) CSV diario`
      : null,
    analytics.dataSources.metaTrafficRows > 0
      ? `${analytics.dataSources.metaTrafficRows} dia(s) Meta`
      : null,
  ]
    .filter(Boolean)
    .join(" + ") || "Pendente";
  const salesSourceSummary = [
    analytics.dataSources.csvDailyRows > 0
      ? `${analytics.dataSources.csvDailyRows} linha(s) CSV diario`
      : null,
    analytics.dataSources.webhookSalesEvents > 0
      ? `${analytics.dataSources.webhookSalesEvents} evento(s) de API / webhook`
      : null,
  ]
    .filter(Boolean)
    .join(" + ") || "Pendente";

  const updateConfig = <Key extends keyof ProjectMetricConfig>(
    key: Key,
    value: ProjectMetricConfig[Key],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
    if (key === "periodStart" && typeof value === "string") setDailyStart(value);
    if (key === "periodEnd" && typeof value === "string") setDailyEnd(value);
    setConfigConfirmed(false);
  };

  function referenceField(field: AutomaticMetricField, label: string) {
    return <ReferenceField key={field} label={label} field={field} config={config} reference={resolved.references[field]}
      onMode={(automatic) => updateConfig("automaticMetrics", { ...config.automaticMetrics, [field]: automatic })}
      onChange={(value) => updateConfig(field, value)} />;
  }

  async function saveConfig() {
    if (readOnly) {
      setMessage("Projeto historico em modo somente leitura.");
      return;
    }
    setSaveState("saving");
    setMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      setSaveState("saved");
      setMessage("Parametros demonstrativos atualizados.");
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/metrics-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setSaveState("error");
        setMessage(body?.error ?? "Nao foi possivel salvar os parametros.");
        return;
      }

      setSaveState("saved");
      setConfigConfirmed(true);
      setMessage("Parametros salvos. Os indicadores foram recalculados.");
      const refreshed = await fetch(`/api/projects/${projectId}/analytics?${new URLSearchParams({ periodStart: config.periodStart, periodEnd: config.periodEnd })}`);
      const refreshedBody = await refreshed.json();
      if (refreshed.ok && refreshedBody.data && !refreshedBody.data.warning) setLoadedAnalytics(refreshedBody.data);
      else setMessage("Escolhas salvas. Reabra Métricas para atualizar os resultados; a consulta não pôde ser concluída agora.");
      startTransition(() => router.refresh());
    } catch {
      setSaveState("error");
      setMessage("Falha de rede ao salvar os parametros.");
    }
  }

  async function importMetrics() {
    if (
      !metricsFile || importing || readOnly || demoMode || csvHasErrors
    ) return;
    setImporting(true);
    setMessage("");
    const formData = new FormData();
    formData.set("metricsFile", metricsFile);

    try {
      const response = await fetch(`/api/projects/${projectId}/metrics-import`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            data?: {
              dailyRows: number;
              duplicate: boolean;
              periodStart: string;
              periodEnd: string;
            };
            error?: string;
            issues?: { file: string; line?: number; message: string }[];
          }
        | null;
      if (!response.ok || !body?.data) {
        setMessage(
          body?.issues?.map((issue) => `${issue.file}: ${issue.message}`).join(" | ")
            ?? body?.error
            ?? "Nao foi possivel importar a planilha.",
        );
        setImporting(false);
        return;
      }

      setConfig((current) => ({
        ...current,
        periodStart: body.data!.periodStart,
        periodEnd: body.data!.periodEnd,
      }));
      setDailyStart(body.data.periodStart);
      setDailyEnd(body.data.periodEnd);
      setMessage(
        body.data.duplicate
          ? "Este arquivo ja havia sido processado; nenhuma metrica foi alterada."
          : `${body.data.dailyRows} linha(s) diarias importadas.`,
      );
      setMetricsFile(null);
      setMetricsPreview(null);
      if (metricsInput.current) metricsInput.current.value = "";
      setImporting(false);
      setView("daily");
      startTransition(() => router.refresh());
    } catch {
      setMessage("Falha de rede ao importar as planilhas.");
      setImporting(false);
    }
  }

  async function selectCsv(file: File | null) {
    const sequence = ++inspectionSequence.current;
    setMetricsFile(file);
    if (!file) {
      setInspectingCsv(false);
      setMetricsPreview(null);
      return;
    }
    setInspectingCsv(true);
    try {
      const preview = inspectMetricsCsv(await file.text());
      if (sequence !== inspectionSequence.current) return;
      setMetricsPreview(preview);
    } catch {
      if (sequence === inspectionSequence.current) {
        setMetricsPreview(null);
        setMessage("Nao foi possivel ler o arquivo CSV selecionado.");
      }
    } finally {
      if (sequence === inspectionSequence.current) setInspectingCsv(false);
    }
  }

  const dailyDate = (date: string) => {
    if (date === "GERAL") return date;
    const [year, month, day] = date.split("-");
    return `${day}/${month}/${year.slice(2)}`;
  };
  const orderBumpFor = (
    row: ReturnType<typeof calculateDailyPerformance>,
    product: (typeof orderBumpSlots)[number],
    index: number,
  ) => product
    ? row.orderBumps.find(
        (item) => item.productId === product.productId && item.stageId === product.stageId,
      )
    : row.orderBumps[index];
  const percentOrUnavailable = (value: number | null) =>
    value === null ? "N/D" : formatPercent(value);
  const ratioOrUnavailable = (value: number | null) =>
    value === null ? "N/D" : `${value.toFixed(2)}x`;

  return (
    <div className="space-y-5">
      {message && <p role="status" className="rounded-xl bg-blue-50 p-4 text-xs">{message}</p>}
      {loadingPeriod && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={16} /> Carregando o período selecionado…</p>}
      {productSubset && <p className="rounded-xl bg-blue-50 p-4 text-xs leading-5">Receitas e vendas refletem os produtos selecionados. Tráfego e custos pertencem ao projeto inteiro; CPA, ROAS, margem e lucro por produto ficam indisponíveis sem divisão dos gastos por produto.</p>}
      {!demoMode && !readOnly && (loadingPeriod || config.periodStart !== filter.start || config.periodEnd !== filter.end) ?
        <p className="panel rounded-xl p-5 text-sm">{loadingPeriod ? "Aguarde para consultar os resultados atualizados." : "Não foi possível carregar a seleção. Os números do período anterior estão ocultos."}</p> : <>
      {!controlledView && <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-white/45 p-1">
        {[
          ["daily", "Metricas diarias"],
          ["financial", "Financeiro"],
          ["planning", "Metas e projecoes"],
          ["data", "Abastecimento"],
          ["config", "Premissas"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key as typeof view)}
            className={`rounded-lg px-3 py-2 text-[10px] font-bold ${
              view === key ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>}

      {!hasAnySourceRows && (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow text-amber-800">Primeira utilizacao</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Este projeto ainda nao recebeu dados observados
              </h2>
              <p className="mt-2 text-xs leading-5">
                O CSV diario ou as integracoes alimentam o que realmente aconteceu. As
                premissas servem apenas para custos e projecoes futuras; elas nao
                substituem os dados observados.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setView("data")}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-3 text-xs font-bold text-white"
              >
                <Upload size={14} /> Importar CSV diario
              </button>
              <button
                type="button"
                onClick={() => setView("config")}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 px-4 py-3 text-xs font-bold"
              >
                Entender premissas <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>
      )}

      {view === "daily" && (
        populatedRows.length ? (
        <section className="panel overflow-hidden rounded-[24px]">
          <div className="flex flex-col gap-2 border-b border-[var(--line)] p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
            <div>
              <p className="eyebrow">Desempenho por dia</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Midia, funil e vendas
              </h2>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={() => setDailyAscending((current) => !current)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--line)] px-3 text-[9px] font-bold">
                <ArrowUpDown size={12} /> {dailyAscending ? "Mais antigas" : "Mais recentes"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1900px] w-full border-collapse text-right text-[10px]">
              <thead className="bg-[var(--sidebar)] text-white">
                <tr>
                  {[
                    "Dia",
                    "CTR",
                    "Connect rate",
                    "Conv. LP",
                    "Conv. checkout",
                    "Vendas",
                    "Faturamento core",
                    "Gasto trafego",
                    "Gasto final",
                    "ROAS core",
                    ...orderBumpSlots.flatMap((_, index) => [
                      "Vendas",
                      `OB${index + 1}`,
                    ]),
                    "CPA",
                    "Faturamento total",
                    "ARPU",
                    "ROAS geral",
                  ].map((label, index) => (
                    <th
                      key={`${label}-${index}`}
                      className={`whitespace-nowrap px-3 py-3 font-bold ${index === 0 ? "text-left" : ""}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...calculatedRows, total].map((row) => (
                  <tr
                    key={row.date}
                    className={
                      row.date === "GERAL"
                        ? "border-t-2 border-[var(--ink)] bg-amber-50 font-black"
                        : "border-t border-[var(--line)] odd:bg-white/35"
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-left font-bold">
                      {dailyDate(row.date)}
                    </td>
                    <td className="px-3 py-3">{percentOrUnavailable(row.ctr)}</td>
                    <td className="px-3 py-3">{percentOrUnavailable(row.connectRate)}</td>
                    <td className="px-3 py-3">{percentOrUnavailable(row.landingPageConversion)}</td>
                    <td className="px-3 py-3">{percentOrUnavailable(row.checkoutConversion)}</td>
                    <td className="px-3 py-3">{formatNumber(row.csvDaily?.core ?? row.coreSales)}</td>
                    <td className="px-3 py-3">
                      {row.coreRevenueAvailable ? formatCurrency(row.coreRevenue) : "N/D"}
                    </td>
                    <td className="px-3 py-3">{formatCurrency(row.investment)}</td>
                    <td className="px-3 py-3">{formatCurrency(row.finalInvestment)}</td>
                    <td className="px-3 py-3">{ratioOrUnavailable(row.coreRoas)}</td>
                    {orderBumpSlots.flatMap((product, index) => {
                      const bump = orderBumpFor(row, product, index);
                      const key = product
                        ? `${product.productId}-${product.stageId}`
                        : `order-bump-${index + 1}`;
                      return [
                        <td
                          key={`${key}-sales`}
                          className="px-3 py-3"
                        >
                          {formatNumber(bump?.quantity ?? 0)}
                        </td>,
                        <td
                          key={`${key}-revenue`}
                          className="px-3 py-3"
                        >
                          {(bump?.quantity ?? 0) > 0 && (bump?.revenue ?? 0) === 0
                            ? "N/D"
                            : formatCurrency(bump?.revenue ?? 0)}
                        </td>,
                      ];
                    })}
                    <td className="px-3 py-3">
                      {row.cpa === null ? "N/D" : formatCurrency(row.cpa)}
                    </td>
                    <td className="px-3 py-3">
                      {row.trackedRevenueAvailable ? formatCurrency(row.trackedRevenue) : "N/D"}
                    </td>
                    <td className="px-3 py-3">
                      {row.arpu === null ? "N/D" : formatCurrency(row.arpu)}
                    </td>
                    <td className="px-3 py-3">{ratioOrUnavailable(row.generalRoas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!orderBumpProducts.length && (
            <p className="border-t border-[var(--line)] px-5 py-4 text-[11px] text-[var(--muted)]">
              Mapeie produtos como Order bump para exibi-los separadamente.
            </p>
          )}
        </section>
        ) : (
          <section className="panel rounded-[24px] p-8 text-center">
            <Database className="mx-auto text-[var(--muted)]" size={28} />
            <h2 className="mt-4 text-xl font-black">Nenhuma metrica para exibir</h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-[var(--muted)]">
              Linhas zeradas nao representam dias medidos. Importe os CSVs ou sincronize
              uma fonte para preencher a tabela diaria.
            </p>
            <button
              type="button"
              onClick={() => setView("data")}
              className="mt-5 rounded-xl bg-[var(--ink)] px-4 py-3 text-xs font-bold text-white"
            >
              Ir para abastecimento
            </button>
          </section>
        )
      )}

      {view === "financial" && (
        hasRevenueMetrics ? (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {[
              ["Receita registrada", formatCurrency(financial.revenue)],
              ["Custo total", formatCurrency(financial.totalCost)],
              ["Resultado com custos registrados", productSubset ? "N/D" : formatCurrency(financial.profit)],
              ["Margem", productSubset ? "N/D" : formatPercent(financial.margin)],
              ["ROAS de midia", productSubset || financial.finalTrafficInvestment === 0 ? "N/D" : `${financial.roas.toFixed(2)}x`],
              ["ROI operacional", productSubset || financial.totalCost === 0 ? "N/D" : `${financial.roi.toFixed(2)}x`],
            ].map(([label, value]) => (
              <article key={label} className="panel rounded-[20px] p-5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-3 text-xl font-black tracking-[-0.04em]">{value}</p>
              </article>
            ))}
          </section>

          <p className="rounded-xl bg-blue-50 p-4 text-xs leading-5">O resultado considera somente receitas e custos registrados. Taxas contratuais, participação e despesas externas precisam ser informadas quando existirem. Consulte Vendas para conferir bruto, taxas e repasse ao produtor.</p>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="panel rounded-[24px] p-6">
              <p className="eyebrow">Receita por produto</p>
              <div className="mt-5 space-y-3">
                {productTotals.map((product) => (
                  <div
                    key={`${product.productId}:${product.stageId}`}
                    className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-[var(--line)] pb-3 text-xs"
                  >
                    <span className="font-bold">{product.productName}</span>
                    <span className="text-[var(--muted)]">
                      {formatNumber(product.quantity)} venda(s)
                    </span>
                    <span className="font-black">
                      {product.revenue !== 0 ? formatCurrency(product.revenue) : "N/D"}
                    </span>
                  </div>
                ))}
                {!productTotals.length && (
                  <p className="text-xs text-[var(--muted)]">
                    O detalhamento aparecera apos mapear produtos e receber vendas por
                    integracao. O CSV informa apenas o faturamento liquido total.
                  </p>
                )}
                {productTotals.some(
                  (product) => product.quantity !== 0 && product.revenue === 0,
                ) && (
                  <p className="rounded-xl bg-blue-50 px-4 py-3 text-[10px] leading-4 text-blue-950">
                    N/D indica quantidade vinda do CSV sem receita individual por produto.
                  </p>
                )}
              </div>
            </article>
            <article className="rounded-[24px] bg-[var(--sidebar)] p-6 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                Composicao dos custos
              </p>
              <div className="mt-5 space-y-3 text-xs">
                {[
                  ["Investimento em midia", financial.trafficInvestment],
                  ["Taxa sobre trafego", financial.finalTrafficInvestment - financial.trafficInvestment],
                  ["Manychat", config.manychatCost],
                  ["Custos da empresa", config.companyCosts],
                  ["Outros custos", config.otherCosts],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between border-b border-white/8 pb-3">
                    <span className="text-white/45">{label}</span>
                    <span className="font-black">{formatCurrency(value as number)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-xl bg-white/[0.055] p-4">
                <p className="text-[9px] uppercase tracking-wider text-white/40">
                  Resultado da empresa ({decimalFormatter.format(config.companySharePercent)}%)
                </p>
                <p className="mt-2 text-2xl font-black">
                  {productSubset || config.companySharePercent === 0 ? "Participação não calculada" : formatCurrency(financial.companyResult)}
                </p>
              </div>
            </article>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              ["Faturado ingressos/core", ticketTotal?.revenue],
              ["Faturado formacao", formationTotal?.revenue],
              ["Faturado downsell", downsellTotal?.revenue],
            ].map(([label, value]) => (
              <article key={label as string} className="panel rounded-[20px] p-5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-3 text-xl font-black">
                  {typeof value === "number" && value !== 0
                    ? formatCurrency(value)
                    : "N/D"}
                </p>
              </article>
            ))}
          </section>
        </div>
        ) : (
          <section className="panel rounded-[24px] p-8 text-center">
            <Info className="mx-auto text-[var(--muted)]" size={28} />
            <h2 className="mt-4 text-xl font-black">Financeiro ainda nao calculavel</h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-[var(--muted)]">
              Sem receita no período e nos produtos selecionados. Selecione outro período ou confira a integração de vendas.
            </p>
          </section>
        )
      )}

      {view === "data" && (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              ["Trafego", trafficSourceSummary],
              ["Vendas", salesSourceSummary],
              [
                "Periodo encontrado",
                populatedRows.length
                  ? `${dailyDate(populatedRows[0].date)} a ${dailyDate(populatedRows.at(-1)!.date)}`
                  : "Sem dados",
              ],
            ].map(([label, value]) => (
              <article key={label} className="panel rounded-[20px] p-5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-3 text-xl font-black">{value}</p>
              </article>
            ))}
          </section>

          <section className="panel rounded-[24px] p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-900">
                <FileSpreadsheet size={19} />
              </div>
              <div>
                <p className="eyebrow">Importacao por projeto</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Abastecer metricas por CSV
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
                  Os registros sao vinculados automaticamente a este projeto. Datas ja
                  existentes sao atualizadas, sem duplicar linhas. Em uma data importada,
                  os campos agregados daquele arquivo passam a ter prioridade.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                ["1", "Escolha o arquivo", "Envie uma linha combinada por dia medido."],
                ["2", "Validacao automatica", "Datas, colunas e numeros sao conferidos antes de salvar."],
                ["3", "Calculo no painel", "Taxas e valores financeiros sao derivados das premissas."],
              ].map(([number, title, description]) => (
                <div key={number} className="rounded-2xl bg-black/[0.035] p-4">
                  <span className="grid size-6 place-items-center rounded-full bg-[var(--ink)] text-[10px] font-black text-white">
                    {number}
                  </span>
                  <p className="mt-3 text-xs font-black">{title}</p>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                    {description}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 max-w-3xl">
              <label className="block rounded-2xl border border-dashed border-[var(--line)] bg-white/35 p-5 text-xs font-bold">
                Planilha diaria combinada
                <input
                  ref={metricsInput}
                  className="mt-3 block w-full text-[11px] font-medium file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-[10px] file:font-bold file:text-white"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void selectCsv(event.target.files?.[0] ?? null)}
                  disabled={readOnly || demoMode}
                />
                <span className="mt-3 block font-normal leading-5 text-[var(--muted)]">
                  Obrigatorias: date, invest, impressions, clicks, pageviews, checkouts,
                  core, ob1, ob2 e ob3. Aceita datas AAAA-MM-DD ou DD/MM/AAAA.
                </span>
                <a
                  href="/templates/metricas-diarias.csv"
                  download
                  className="mt-3 inline-flex items-center gap-2 text-[10px] font-black text-violet-800"
                >
                  <Download size={13} /> Baixar modelo diario
                </a>
                <CsvPreview preview={metricsPreview} />
              </label>
            </div>

            <div className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-950">
              <strong>Como a atualizacao funciona:</strong> somente as datas presentes no
              arquivo sao atualizadas; as demais permanecem. Faturamento core, faturamento
              dos tres order bumps, CPA, ARPU e ROAS sao recalculados no painel.
            </div>

            {(readOnly || demoMode) && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-950">
                A importacao exige um projeto real persistido no Supabase.
              </p>
            )}
            <button
              type="button"
              onClick={importMetrics}
              disabled={
                importing ||
                isRefreshing ||
                !metricsFile ||
                csvHasErrors ||
                readOnly ||
                demoMode
              }
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {importing || isRefreshing ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Upload size={15} />
              )}
              {importing ? "Importando..." : "Importar planilha"}
            </button>
          </section>
          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Historico imutavel</p>
            <h2 className="mt-2 text-xl font-black">Arquivos processados</h2>
            <div className="mt-5 space-y-2">
              {(analytics.imports ?? []).map((item) => (
                <div key={item.id} className="grid gap-2 rounded-xl bg-black/[0.035] p-4 text-[10px] sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-black">{item.filename}</p>
                    <p className="mt-1 truncate text-[9px] text-[var(--muted)]">
                      SHA-256 {item.sha256}
                    </p>
                  </div>
                  <span className="font-bold">
                    Diario · {item.rows} linha(s)
                  </span>
                  <span className="text-[var(--muted)]">
                    {dailyDate(item.periodStart)} a {dailyDate(item.periodEnd)}
                  </span>
                </div>
              ))}
              {!analytics.imports?.length && (
                <p className="text-xs text-[var(--muted)]">Nenhum arquivo versionado ainda.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {view === "planning" && (
        planningReady ? (
        <div className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-2">
            {[
              ["Cenario CPA base", baseScenario],
              [config.idealCpa > 0 ? "Cenario CPA ideal" : "Cenário base — sem CPA alvo definido", idealScenario],
            ].map(([label, scenario]) => {
              const values = scenario as typeof baseScenario;
              return (
                <article key={label as string} className="panel rounded-[24px] p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="eyebrow">{label as string}</p>
                      <p className="mt-2 text-3xl font-black tracking-[-0.05em]">
                        {formatCurrency(values.revenue)}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black text-amber-900">
                      CPA {formatCurrency(values.cpa)}
                    </span>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[
                      ["Vendas ingresso", decimalFormatter.format(values.ticketSales)],
                      ["Comparecimento", decimalFormatter.format(values.attendance)],
                      ["Vendas formacao", decimalFormatter.format(values.formationSales)],
                      ["Lucro projetado", formatCurrency(values.profit)],
                      ["ROAS projetado", `${values.roas.toFixed(2)}x`],
                    ].map(([itemLabel, value]) => (
                      <div key={itemLabel} className="border-b border-[var(--line)] pb-3 text-xs">
                        <p className="text-[var(--muted)]">{itemLabel}</p>
                        <p className="mt-1 font-black">{value}</p>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="panel rounded-[24px] p-6">
              <p className="eyebrow">Base historica</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {[
                  ["Comparecimento", formatPercent(historicalAttendanceRate)],
                  ["Formacao / comparecimento", formatPercent(historicalFormationRate)],
                  ["Formacao / ingresso", formatPercent(historicalTicketConversion)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-black/[0.035] p-4">
                    <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
                      {label}
                    </p>
                    <p className="mt-2 text-xl font-black">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "Ingresso executado",
                    ticketTotal?.quantity ?? 0,
                    baseScenario.ticketSales,
                  ],
                  [
                    "Formacao executada",
                    formationTotal?.quantity ?? 0,
                    baseScenario.formationSales,
                  ],
                ].map(([label, actual, target]) => (
                  <div key={label as string} className="rounded-2xl border border-[var(--line)] p-4">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold">{label}</span>
                      <span className="font-black">
                        {formatPercent(percentage(actual as number, target as number), 0)}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] text-[var(--muted)]">
                      {decimalFormatter.format(actual as number)} de {decimalFormatter.format(target as number)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
            <article className="rounded-[24px] bg-[var(--sidebar)] p-6 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                Divisao do investimento
              </p>
              <p className="mt-3 text-3xl font-black">{formatCurrency(plannedBudget)}</p>
              <div className="mt-6 space-y-3 text-xs">
                {[
                  ["Orcamento ingresso", config.ticketBudget],
                  ["Orcamento API", config.apiBudget],
                  ["Orcamento RMKT", config.remarketingBudget],
                  ["Orcamento distribuicao", config.distributionBudget],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between border-b border-white/8 pb-3">
                    <span className="text-white/45">{label}</span>
                    <span className="font-black">{formatCurrency(value as number)}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              ["Grupos alunos", config.studentGroupLeads, config.studentGroupTarget],
              ["Grupos compradores", config.buyerGroupLeads, config.buyerGroupTarget],
              ["Alunos captura", config.captureLeads, config.captureTarget],
            ].map(([label, actual, target]) => (
              <article key={label as string} className="panel rounded-[20px] p-5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-3 text-2xl font-black">{formatNumber(actual as number)}</p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {target
                    ? `${formatPercent(percentage(actual as number, target as number), 0)} da meta`
                    : "Meta ainda nao informada"}
                </p>
              </article>
            ))}
          </section>
        </div>
        ) : (
          <section className="panel rounded-[24px] p-7">
            <p className="eyebrow">Projecao bloqueada</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Defina as referências para gerar cenários
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
              Sem esses dados, um resultado negativo significa apenas configuracao
              incompleta, nao uma previsao real do projeto.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {planningRequirements.map((requirement) => (
                <div
                  key={requirement.label}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-xs font-bold ${
                    requirement.ready
                      ? "bg-emerald-50 text-emerald-950"
                      : "bg-amber-50 text-amber-950"
                  }`}
                >
                  <span
                    className={`grid size-5 place-items-center rounded-full ${
                      requirement.ready ? "bg-emerald-200" : "bg-amber-200"
                    }`}
                  >
                    {requirement.ready ? <Check size={12} /> : "!"}
                  </span>
                  {requirement.label}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView("config")}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 text-xs font-bold text-white"
            >
              Preencher premissas <ArrowRight size={14} />
            </button>
          </section>
        )
      )}

      {view === "config" && (
        <div className="space-y-4">
          <section className="rounded-[24px] bg-[var(--sidebar)] p-6 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
              Antes de preencher
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
              Selecione os produtos. Os dados calculáveis vêm das integrações.
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/60">
              Preços líquidos e quantidades usam as vendas do período de referência. O CPA base usa o gasto registrado quando há um único produto de entrada. Metas, orçamento, custos externos e presença precisam de uma definição sua.
            </p>
            {!configConfirmed && (
              <p className="mt-4 rounded-xl bg-amber-300/15 px-4 py-3 text-[11px] leading-5 text-amber-100">
                A consulta dos resultados já está disponível. Salve somente se quiser manter as escolhas de referência e os valores personalizados.
              </p>
            )}
          </section>

          <button type="button" className="rounded-xl bg-emerald-100 px-4 py-3 text-xs font-bold text-emerald-950" onClick={() => updateConfig("automaticMetrics", Object.fromEntries(automaticMetricFields.map((field) => [field, true])))}>Usar dados das integrações</button>
          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Regras financeiras opcionais</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Use os filtros acima para escolher o período. Taxas contratuais e participação são decisões da operação, não taxas de venda da plataforma.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <NumberField
                label="Taxa sobre trafego"
                value={config.trafficFeePercent}
                suffix="%"
                help="Percentual cobrado sobre a midia, somado ao investimento realizado."
                onChange={(value) => updateConfig("trafficFeePercent", value)}
              />
              <NumberField
                label="Participacao da empresa"
                value={config.companySharePercent}
                suffix="%"
                help="Parcela do lucro operacional atribuida a empresa."
                onChange={(value) => updateConfig("companySharePercent", value)}
              />
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Custos da operacao</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Valores descontados do faturamento no Financeiro. Nao sao lidos dos CSVs.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField label="Manychat / automacao" value={config.manychatCost} help="Custo do periodo com Manychat ou ferramenta equivalente." onChange={(value) => updateConfig("manychatCost", value)} />
              <NumberField label="Custos fixos da empresa" value={config.companyCosts} help="Equipe, ferramentas e demais custos fixos atribuidos ao projeto." onChange={(value) => updateConfig("companyCosts", value)} />
              <NumberField label="Outros custos" value={config.otherCosts} help="Despesas adicionais que nao entram nas categorias anteriores." onChange={(value) => updateConfig("otherCosts", value)} />
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Planejamento de investimento</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Usado apenas nos cenarios futuros. O realizado continua vindo do CSV diario
              ou da Meta.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
               <NumberField label="Midia para ingresso" value={config.ticketBudget} help="Parte da verba destinada a vender o produto de entrada." onChange={(value) => updateConfig("ticketBudget", value)} />
              <NumberField label="Automacao / API" value={config.apiBudget} help="Reserva planejada para API ou automacao; nao e venda nem trafego realizado." onChange={(value) => updateConfig("apiBudget", value)} />
              <NumberField label="Remarketing" value={config.remarketingBudget} help="Verba de midia para impactar novamente a audiencia." onChange={(value) => updateConfig("remarketingBudget", value)} />
              <NumberField label="Distribuicao" value={config.distributionBudget} help="Verba de midia para distribuicao de conteudo ou campanhas auxiliares." onChange={(value) => updateConfig("distributionBudget", value)} />
              {referenceField("baseCpa", "CPA base")}
              <NumberField label="CPA ideal" value={config.idealCpa} help="Meta opcional de custo por venda. Sem meta, a projeção usa somente o CPA base." onChange={(value) => updateConfig("idealCpa", value)} />
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Produtos de referencia</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Escolha os produtos usados nas projeções. A detecção automática só seleciona quando existe um único produto no papel correspondente. Ao selecionar um único produto de entrada no filtro, ele também serve de referência enquanto não houver outra escolha salva.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Produto ingresso/core", "ticketProductId"],
                ["Produto formacao", "formationProductId"],
                ["Produto downsell", "downsellProductId"],
              ].map(([label, field]) => (
                <label key={field} className="space-y-2 text-xs font-bold">
                  {label}
                  <select
                    className="field"
                    value={config[field as "ticketProductId" | "formationProductId" | "downsellProductId"] ?? ""}
                    onChange={(event) =>
                      updateConfig(
                        field as "ticketProductId" | "formationProductId" | "downsellProductId",
                        event.target.value || null,
                      )
                    }
                  >
                    <option value="">Detectar pelo funil</option>
                    {mappedProducts.filter((product) => !["ticketProductId", "formationProductId", "downsellProductId"].some((other) => other !== field && config[other as "ticketProductId"] === product.id)).map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                  <span className="mt-2 block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Selecione uma opção para calcular a referência. Não é necessário repetir o mesmo produto em outros papéis.
                  </span>
                </label>
              ))}
               {referenceField("ticketNetPrice", "Preço líquido core")}
               {referenceField("orderBump1NetPrice", "Preço líquido OB1")}
               {referenceField("orderBump2NetPrice", "Preço líquido OB2")}
               {referenceField("orderBump3NetPrice", "Preço líquido OB3")}
               {referenceField("formationNetPrice", "Ticket líquido formação")}
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Base historica para projecao</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              O período selecionado acima é a referência. As quantidades automáticas vêm das vendas desse período; escolha datas comparáveis à operação que deseja projetar. Vendas de produtos diferentes não comprovam que os mesmos compradores avançaram no funil.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {referenceField("historicalTicketSales", "Ingressos vendidos")}
              <NumberField label="Comparecimentos" value={config.historicalAttendance} help="Informe presença efetiva dos compradores no mesmo período. Responder um formulário não comprova comparecimento." onChange={(value) => updateConfig("historicalAttendance", value)} />
              {referenceField("historicalFormationSales", "Vendas de formação")}
            </div>
          </section>

          <details className="panel rounded-[24px] p-6">
            <summary className="cursor-pointer text-xs font-black">
              Indicadores manuais opcionais de captacao e grupos
            </summary>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Abra e preencha somente se esta operacao acompanha grupos e captacao fora
              das integracoes.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField label="Pessoas em grupos de alunos" value={config.studentGroupLeads} help="Quantidade atual acompanhada manualmente." onChange={(value) => updateConfig("studentGroupLeads", value)} />
              <NumberField label="Meta dos grupos de alunos" value={config.studentGroupTarget} help="Objetivo de pessoas para os grupos de alunos." onChange={(value) => updateConfig("studentGroupTarget", value)} />
              <NumberField label="Pessoas em grupos de compradores" value={config.buyerGroupLeads} help="Quantidade atual acompanhada manualmente." onChange={(value) => updateConfig("buyerGroupLeads", value)} />
              <NumberField label="Meta de compradores" value={config.buyerGroupTarget} help="Objetivo de pessoas nos grupos de compradores." onChange={(value) => updateConfig("buyerGroupTarget", value)} />
              <NumberField label="Alunos na captacao" value={config.captureLeads} help="Quantidade atual de alunos captados manualmente." onChange={(value) => updateConfig("captureLeads", value)} />
              <NumberField label="Meta de captacao" value={config.captureTarget} help="Objetivo de alunos captados para o periodo." onChange={(value) => updateConfig("captureTarget", value)} />
            </div>
          </details>

          <button
            type="button"
            onClick={saveConfig}
            disabled={saveState === "saving" || isRefreshing || readOnly}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-3 text-xs font-bold text-white disabled:opacity-40"
          >
            {saveState === "saving" || isRefreshing ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : saveState === "saved" ? (
              <Check size={15} />
            ) : (
              <Save size={15} />
            )}
            {saveState === "saving" ? "Salvando..." : "Salvar premissas"}
          </button>
        </div>
      )}
      </>}
    </div>
  );
}

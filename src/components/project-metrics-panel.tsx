"use client";

import {
  ArrowRight,
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
import { useRef, useState, useTransition } from "react";
import type {
  ProjectAnalytics,
  ProjectFunnelStage,
  ProjectMetricConfig,
  ProjectProduct,
} from "@/lib/domain";
import {
  aggregateProjectDailyMetrics,
  calculateDailyPerformance,
  calculateFinancialSummary,
  calculateProjectionScenario,
  percentage,
} from "@/lib/project-metrics";
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

export function ProjectMetricsPanel({
  projectId,
  analytics,
  products,
  stages,
  demoMode,
  readOnly = false,
}: {
  projectId: string;
  analytics: ProjectAnalytics;
  products: ProjectProduct[];
  stages: ProjectFunnelStage[];
  demoMode: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const hasObservedData = analytics.dailyMetrics.some(hasMetricData);
  const hasAnySourceRows =
    analytics.dataSources.csvTrafficRows > 0 ||
    analytics.dataSources.csvSalesRows > 0 ||
    analytics.dataSources.metaTrafficRows > 0 ||
    analytics.dataSources.webhookSalesEvents > 0;
  const [isRefreshing, startTransition] = useTransition();
  const [view, setView] = useState<
    "daily" | "financial" | "planning" | "data" | "config"
  >(hasObservedData ? "daily" : "data");
  const [config, setConfig] = useState(analytics.config);
  const [configConfirmed, setConfigConfirmed] = useState(analytics.configSaved);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(analytics.warning ?? "");
  const [trafficFile, setTrafficFile] = useState<File | null>(null);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const trafficInput = useRef<HTMLInputElement>(null);
  const salesInput = useRef<HTMLInputElement>(null);
  const populatedRows = analytics.dailyMetrics.filter(hasMetricData);
  const hasRevenueMetrics = populatedRows.some((metric) => metric.revenue !== 0);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const mappedProducts = products
    .filter((product) => product.mappedProjectId === projectId && product.stageId)
    .sort((a, b) => {
      const positionA = stageById.get(a.stageId ?? "")?.position ?? 0;
      const positionB = stageById.get(b.stageId ?? "")?.position ?? 0;
      return positionA - positionB || a.name.localeCompare(b.name);
    });
  const productById = new Map(mappedProducts.map((product) => [product.id, product]));
  const calculatedRows = populatedRows.map((metric) =>
    calculateDailyPerformance(metric, config.trafficFeePercent),
  );
  const aggregate = aggregateProjectDailyMetrics(populatedRows);
  const orderBumpProducts = aggregate.productMetrics
    .filter((product) => product.stageType === "order_bump")
    .sort((a, b) => {
      const positionA = stageById.get(a.stageId)?.position ?? 0;
      const positionB = stageById.get(b.stageId)?.position ?? 0;
      return positionA - positionB || a.productName.localeCompare(b.productName);
    });
  const total = calculateDailyPerformance(aggregate, config.trafficFeePercent);
  const financial = calculateFinancialSummary(populatedRows, config);
  const productTotals = aggregate.productMetrics;

  const assignedProductIds = new Set<string>();
  const roleProductId = (
    configuredId: string | null,
    types: ProjectFunnelStage["type"][],
  ) => {
    const productId =
      configuredId && productById.has(configuredId) && !assignedProductIds.has(configuredId)
        ? configuredId
        : mappedProducts.find(
            (product) =>
              !assignedProductIds.has(product.id) &&
              types.includes(stageById.get(product.stageId ?? "")?.type ?? "core"),
          )?.id ?? null;
    if (productId) assignedProductIds.add(productId);
    return productId;
  };
  const ticketProductId = roleProductId(config.ticketProductId, [
    "front_end",
    "low_ticket",
    "core",
  ]);
  const formationProductId = roleProductId(config.formationProductId, [
    "upsell",
    "middle_end",
    "back_end",
  ]);
  const downsellProductId = roleProductId(config.downsellProductId, ["downsell"]);
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
  const ticketPrice =
    config.ticketNetPrice || productById.get(ticketProductId ?? "")?.price || 0;
  const formationPrice =
    config.formationNetPrice || productById.get(formationProductId ?? "")?.price || 0;
  const baseScenario = calculateProjectionScenario(
    config.baseCpa,
    config,
    ticketPrice,
    formationPrice,
  );
  const idealScenario = calculateProjectionScenario(
    config.idealCpa,
    config,
    ticketPrice,
    formationPrice,
  );
  const historicalAttendanceRate = percentage(
    config.historicalAttendance,
    config.historicalTicketSales,
  );
  const historicalFormationRate = percentage(
    config.historicalFormationSales,
    config.historicalAttendance,
  );
  const historicalTicketConversion = percentage(
    config.historicalFormationSales,
    config.historicalTicketSales,
  );
  const plannedBudget =
    config.ticketBudget +
    config.apiBudget +
    config.remarketingBudget +
    config.distributionBudget;
  const planningRequirements = [
    { ready: config.ticketBudget > 0, label: "Orcamento de ingresso" },
    { ready: ticketPrice > 0, label: "Produto ou ticket liquido de ingresso" },
    { ready: config.baseCpa > 0 && config.idealCpa > 0, label: "CPA base e ideal" },
    { ready: config.historicalTicketSales > 0, label: "Ingressos do historico" },
    { ready: config.historicalAttendance > 0, label: "Comparecimento do historico" },
    {
      ready: config.historicalFormationSales <= 0 || formationPrice > 0,
      label: "Ticket liquido da formacao",
    },
  ];
  const missingPlanning = planningRequirements.filter((requirement) => !requirement.ready);
  const planningReady = missingPlanning.length === 0;
  const trafficSourceSummary = [
    analytics.dataSources.csvTrafficRows > 0
      ? `${analytics.dataSources.csvTrafficRows} linha(s) CSV`
      : null,
    analytics.dataSources.metaTrafficRows > 0
      ? `${analytics.dataSources.metaTrafficRows} dia(s) Meta`
      : null,
  ]
    .filter(Boolean)
    .join(" + ") || "Pendente";
  const salesSourceSummary = [
    analytics.dataSources.csvSalesRows > 0
      ? `${analytics.dataSources.csvSalesRows} linha(s) CSV`
      : null,
    analytics.dataSources.webhookSalesEvents > 0
      ? `${analytics.dataSources.webhookSalesEvents} evento(s) webhook`
      : null,
  ]
    .filter(Boolean)
    .join(" + ") || "Pendente";

  const updateConfig = <Key extends keyof ProjectMetricConfig>(
    key: Key,
    value: ProjectMetricConfig[Key],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setConfigConfirmed(false);
  };

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
      startTransition(() => router.refresh());
    } catch {
      setSaveState("error");
      setMessage("Falha de rede ao salvar os parametros.");
    }
  }

  async function importMetrics() {
    if ((!trafficFile && !salesFile) || importing || readOnly || demoMode) return;
    setImporting(true);
    setMessage("");
    const formData = new FormData();
    if (trafficFile) formData.set("trafficFile", trafficFile);
    if (salesFile) formData.set("salesFile", salesFile);

    try {
      const response = await fetch(`/api/projects/${projectId}/metrics-import`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            data?: {
              trafficRows: number;
              salesRows: number;
              periodStart: string;
              periodEnd: string;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !body?.data) {
        setMessage(body?.error ?? "Nao foi possivel importar as planilhas.");
        setImporting(false);
        return;
      }

      setConfig((current) => ({
        ...current,
        periodStart: body.data!.periodStart,
        periodEnd: body.data!.periodEnd,
      }));
      setMessage(
        `${body.data.trafficRows} linha(s) de trafego e ${body.data.salesRows} linha(s) de vendas importadas.`,
      );
      setTrafficFile(null);
      setSalesFile(null);
      if (trafficInput.current) trafficInput.current.value = "";
      if (salesInput.current) salesInput.current.value = "";
      setImporting(false);
      setView("daily");
      startTransition(() => router.refresh());
    } catch {
      setMessage("Falha de rede ao importar as planilhas.");
      setImporting(false);
    }
  }

  const dailyDate = (date: string) => {
    if (date === "GERAL") return date;
    const [year, month, day] = date.split("-");
    return `${day}/${month}/${year.slice(2)}`;
  };
  const orderBumpFor = (
    row: ReturnType<typeof calculateDailyPerformance>,
    productId: string,
    stageId: string,
  ) =>
    row.orderBumps.find(
      (product) => product.productId === productId && product.stageId === stageId,
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-white/45 p-1">
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
      </div>

      {message && (
        <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
          {message}
        </p>
      )}

      {!hasAnySourceRows && (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow text-amber-800">Primeira utilizacao</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Este projeto ainda nao recebeu dados observados
              </h2>
              <p className="mt-2 text-xs leading-5">
                Os CSVs ou as integracoes alimentam o que realmente aconteceu. As
                premissas servem apenas para custos e projecoes futuras; elas nao
                substituem os arquivos de trafego e vendas.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setView("data")}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-3 text-xs font-bold text-white"
              >
                <Upload size={14} /> Importar os CSVs
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
            <p className="text-[10px] text-[var(--muted)]">
              {dailyDate(config.periodStart)} a {dailyDate(config.periodEnd)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] w-full border-collapse text-right text-[10px]">
              <thead className="bg-[var(--sidebar)] text-white">
                <tr>
                  {[
                    "Dia",
                    "CTR",
                    "Connect rate",
                    "Conv. LP",
                    "Conv. checkout",
                    "Vendas core",
                    "Faturamento core",
                    "Gasto trafego",
                    "Gasto final",
                    "ROAS core",
                    ...orderBumpProducts.flatMap((product, index) => [
                      `Vendas OB${index + 1}`,
                      product.productName,
                    ]),
                    "Faturamento total",
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
                    <td className="px-3 py-3">{formatPercent(row.ctr)}</td>
                    <td className="px-3 py-3">{formatPercent(row.connectRate)}</td>
                    <td className="px-3 py-3">{formatPercent(row.landingPageConversion)}</td>
                    <td className="px-3 py-3">{formatPercent(row.checkoutConversion)}</td>
                    <td className="px-3 py-3">{formatNumber(row.coreSales)}</td>
                    <td className="px-3 py-3">
                      {row.coreSales > 0 &&
                      !row.productMetrics.some(
                        (product) =>
                          product.stageType === "core" && product.revenue !== 0,
                      )
                        ? "N/D"
                        : formatCurrency(row.coreRevenue)}
                    </td>
                    <td className="px-3 py-3">{formatCurrency(row.investment)}</td>
                    <td className="px-3 py-3">{formatCurrency(row.finalInvestment)}</td>
                    <td className="px-3 py-3">
                      {row.coreSales > 0 &&
                      !row.productMetrics.some(
                        (product) =>
                          product.stageType === "core" && product.revenue !== 0,
                      )
                        ? "N/D"
                        : `${row.coreRoas.toFixed(2)}x`}
                    </td>
                    {orderBumpProducts.flatMap((product) => {
                      const bump = orderBumpFor(row, product.productId, product.stageId);
                      return [
                        <td
                          key={`${product.productId}-${product.stageId}-sales`}
                          className="px-3 py-3"
                        >
                          {formatNumber(bump?.quantity ?? 0)}
                        </td>,
                        <td
                          key={`${product.productId}-${product.stageId}-revenue`}
                          className="px-3 py-3"
                        >
                          {(bump?.quantity ?? 0) > 0 && (bump?.revenue ?? 0) === 0
                            ? "N/D"
                            : formatCurrency(bump?.revenue ?? 0)}
                        </td>,
                      ];
                    })}
                    <td className="px-3 py-3">{formatCurrency(row.trackedRevenue)}</td>
                    <td className="px-3 py-3">{row.generalRoas.toFixed(2)}x</td>
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
        hasRevenueMetrics && configConfirmed ? (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {[
              ["Faturamento total", formatCurrency(financial.revenue)],
              ["Custo total", formatCurrency(financial.totalCost)],
              ["Lucro real", formatCurrency(financial.profit)],
              ["Margem", formatPercent(financial.margin)],
              ["ROAS de midia", `${financial.roas.toFixed(2)}x`],
              ["ROI operacional", `${financial.roi.toFixed(2)}x`],
            ].map(([label, value]) => (
              <article key={label} className="panel rounded-[20px] p-5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-3 text-xl font-black tracking-[-0.04em]">{value}</p>
              </article>
            ))}
          </section>

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
                  {formatCurrency(financial.companyResult)}
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
              {!configConfirmed
                ? "Revise e salve as premissas manuais antes de calcular custos, margem e lucro."
                : "Sem faturamento observado, custos isolados nao formam um resultado real. Abasteca as vendas antes de analisar lucro, margem ou ROAS."}
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
                ["1", "Escolha a fonte", "Envie trafego, vendas ou os dois arquivos."],
                ["2", "Validacao automatica", "Datas, colunas e numeros sao conferidos antes de salvar."],
                ["3", "Leitura por data", "Trafego e vendas se encontram pela data de cada linha."],
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

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <label className="rounded-2xl border border-dashed border-[var(--line)] bg-white/35 p-5 text-xs font-bold">
                Planilha de trafego
                <input
                  ref={trafficInput}
                  className="mt-3 block w-full text-[11px] font-medium file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-[10px] file:font-bold file:text-white"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setTrafficFile(event.target.files?.[0] ?? null)}
                  disabled={readOnly || demoMode}
                />
                <span className="mt-3 block font-normal leading-5 text-[var(--muted)]">
                  Obrigatorias: date, invest, impressions, clicks, pageviews e
                  checkouts. Aceita datas AAAA-MM-DD ou DD/MM/AAAA.
                </span>
                <a
                  href="/templates/metricas-trafego.csv"
                  download
                  className="mt-3 inline-flex items-center gap-2 text-[10px] font-black text-violet-800"
                >
                  <Download size={13} /> Baixar modelo de trafego
                </a>
              </label>
              <label className="rounded-2xl border border-dashed border-[var(--line)] bg-white/35 p-5 text-xs font-bold">
                Planilha de vendas
                <input
                  ref={salesInput}
                  className="mt-3 block w-full text-[11px] font-medium file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-[10px] file:font-bold file:text-white"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setSalesFile(event.target.files?.[0] ?? null)}
                  disabled={readOnly || demoMode}
                />
                <span className="mt-3 block font-normal leading-5 text-[var(--muted)]">
                  Obrigatorias: date, core e fat_liquido. OBs, upsells e downsells sao
                  opcionais; ob1 corresponde ao primeiro Order bump do funil.
                </span>
                <a
                  href="/templates/metricas-vendas.csv"
                  download
                  className="mt-3 inline-flex items-center gap-2 text-[10px] font-black text-violet-800"
                >
                  <Download size={13} /> Baixar modelo de vendas
                </a>
              </label>
            </div>

            <div className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-950">
              <strong>Como a atualizacao funciona:</strong> somente as datas presentes no
              arquivo sao atualizadas; as demais permanecem. O CSV de vendas traz o
              faturamento liquido total, mas nao separa receita individual por produto.
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
                (!trafficFile && !salesFile) ||
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
              {importing ? "Importando..." : "Importar planilhas"}
            </button>
          </section>
        </div>
      )}

      {view === "planning" && (
        planningReady ? (
        <div className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-2">
            {[
              ["Cenario CPA base", baseScenario],
              ["Cenario CPA ideal", idealScenario],
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
              Complete as premissas antes de gerar cenarios
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
              Premissas nao sao dados dos CSVs
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/60">
              Os arquivos registram trafego e vendas realizados. Os campos abaixo sao
              decisoes manuais usadas para custos e simulacoes. Preencha somente o que
              representa a operacao deste projeto.
            </p>
            {!configConfirmed && (
              <p className="mt-4 rounded-xl bg-amber-300/15 px-4 py-3 text-[11px] leading-5 text-amber-100">
                Os valores iniciais ainda nao foram confirmados para este projeto. Revise
                cada premissa e use &quot;Salvar premissas&quot;.
              </p>
            )}
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Periodo e regras financeiras</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              O periodo e ajustado automaticamente ao importar CSVs, mas pode ser refinado
              para a analise desejada.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-xs font-bold">
                <span className="flex items-center justify-between gap-2">
                  Data inicial
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] uppercase tracking-wider text-emerald-800">
                    CSV / manual
                  </span>
                </span>
                <input
                  className="field mt-2"
                  type="date"
                  value={config.periodStart}
                  onChange={(event) => updateConfig("periodStart", event.target.value)}
                />
                <span className="mt-2 block text-[10px] font-normal leading-4 text-[var(--muted)]">
                  Primeiro dia considerado nos indicadores.
                </span>
              </label>
              <label className="block text-xs font-bold">
                <span className="flex items-center justify-between gap-2">
                  Data final
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] uppercase tracking-wider text-emerald-800">
                    CSV / manual
                  </span>
                </span>
                <input
                  className="field mt-2"
                  type="date"
                  value={config.periodEnd}
                  onChange={(event) => updateConfig("periodEnd", event.target.value)}
                />
                <span className="mt-2 block text-[10px] font-normal leading-4 text-[var(--muted)]">
                  Ultimo dia considerado nos indicadores.
                </span>
              </label>
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
              Usado apenas nos cenarios futuros. O realizado continua vindo do CSV de
              trafego ou da Meta.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <NumberField label="Midia total planejada" value={config.plannedTrafficInvestment} help="Teto total de midia previsto para o periodo." onChange={(value) => updateConfig("plannedTrafficInvestment", value)} />
              <NumberField label="Midia para ingresso" value={config.ticketBudget} help="Parte da verba destinada a vender o produto de entrada." onChange={(value) => updateConfig("ticketBudget", value)} />
              <NumberField label="Automacao / API" value={config.apiBudget} help="Reserva planejada para API ou automacao; nao e venda nem trafego realizado." onChange={(value) => updateConfig("apiBudget", value)} />
              <NumberField label="Remarketing" value={config.remarketingBudget} help="Verba de midia para impactar novamente a audiencia." onChange={(value) => updateConfig("remarketingBudget", value)} />
              <NumberField label="Distribuicao" value={config.distributionBudget} help="Verba de midia para distribuicao de conteudo ou campanhas auxiliares." onChange={(value) => updateConfig("distributionBudget", value)} />
              <NumberField label="CPA base" value={config.baseCpa} help="Custo por venda usado no cenario conservador." onChange={(value) => updateConfig("baseCpa", value)} />
              <NumberField label="CPA ideal" value={config.idealCpa} help="Custo por venda desejado no cenario otimista." onChange={(value) => updateConfig("idealCpa", value)} />
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Produtos de referencia</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Relacione os papeis usados nas projecoes. &quot;Detectar pelo funil&quot; usa o
              primeiro produto mapeado com o papel correspondente.
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
                    {mappedProducts.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                  <span className="mt-2 block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Se nao houver produto mapeado, informe o ticket liquido abaixo.
                  </span>
                </label>
              ))}
              <NumberField label="Ticket liquido ingresso" value={config.ticketNetPrice} help="Valor liquido recebido por venda do produto de entrada." onChange={(value) => updateConfig("ticketNetPrice", value)} />
              <NumberField label="Ticket liquido formacao" value={config.formationNetPrice} help="Valor liquido recebido por venda da formacao ou produto principal." onChange={(value) => updateConfig("formationNetPrice", value)} />
            </div>
          </section>

          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Base historica para projecao</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Use os numeros de uma campanha anterior comparavel. Eles calculam taxas de
              comparecimento e conversao; nao sao extraidos dos dois CSVs atuais.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <NumberField label="Ingressos vendidos" value={config.historicalTicketSales} help="Quantidade de ingressos vendidos na referencia anterior." onChange={(value) => updateConfig("historicalTicketSales", value)} />
              <NumberField label="Comparecimentos" value={config.historicalAttendance} help="Quantas pessoas compareceram entre os compradores anteriores." onChange={(value) => updateConfig("historicalAttendance", value)} />
              <NumberField label="Vendas de formacao" value={config.historicalFormationSales} help="Quantas vendas da formacao ocorreram na referencia anterior." onChange={(value) => updateConfig("historicalFormationSales", value)} />
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
    </div>
  );
}

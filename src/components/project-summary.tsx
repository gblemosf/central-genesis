"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type { AnalysisFilter } from "@/lib/analysis-filters";
import type {
  ProjectAnalytics,
  ProjectCatalog,
  ProjectDailyMetric,
  ProjectFormsData,
  ProjectProduct,
  ProjectSummary as Project,
} from "@/lib/domain";
import {
  matchesSaleProducts,
  paidSaleGroups,
  parseWidgetPreference,
  previousAnalysisPeriod,
  saleSources,
  widgetLabels,
  widgetPresets,
  type WidgetId,
} from "@/lib/dashboard-widgets";
import { calculatePerformance } from "@/lib/metrics";
import {
  summarizeSales,
  type ProjectOperations,
} from "@/lib/project-operations";
import { getProjectReadiness } from "@/lib/project-readiness";
import type { WorkspaceView } from "@/lib/workspace-navigation";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

function Values({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="space-y-3">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-3 last:border-0 last:pb-0"
        >
          <dt className="min-w-0 text-xs break-words text-[var(--muted)]">
            {label}
          </dt>
          <dd className="max-w-[65%] min-w-0 text-right text-sm font-bold break-words tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectSummary({
  project,
  analytics,
  rows,
  ready,
  error,
  filter,
  products,
  catalog,
  forms,
  demoMode,
  onNavigate,
  onSyncMeta,
  syncing,
}: {
  project: Project;
  analytics: ProjectAnalytics;
  rows: ProjectDailyMetric[];
  ready: boolean;
  error: string;
  filter: AnalysisFilter;
  products: ProjectProduct[];
  catalog: ProjectCatalog;
  forms: ProjectFormsData;
  demoMode: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onSyncMeta: () => void;
  syncing: boolean;
}) {
  const preferenceKey = `genesis:dashboard:v1:${project.id}`;
  const [preference, setPreference] = useState<{
    key: string;
    ids: WidgetId[];
  } | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState("");
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    // Preferences contain only widget IDs; no sales or contact data are stored in the browser.
    function restore() {
      try {
        setPreference({
          key: preferenceKey,
          ids: parseWidgetPreference(localStorage.getItem(preferenceKey)),
        });
      } catch {
        setPreferenceNotice(
          "Preferências disponíveis apenas enquanto esta página estiver aberta.",
        );
      }
    }
    const timer = setTimeout(restore, 0);
    window.addEventListener("storage", restore);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", restore);
    };
  }, [preferenceKey]);
  const widgets =
    preference?.key === preferenceKey ? preference.ids : widgetPresets.Gestão;
  function saveWidgets(ids: WidgetId[]) {
    setPreference({ key: preferenceKey, ids });
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(ids));
      setPreferenceNotice(
        "Organização salva neste navegador para este projeto.",
      );
    } catch {
      setPreferenceNotice(
        "Não foi possível salvar neste navegador. A organização será mantida nesta sessão.",
      );
    }
  }
  function moveWidget(index: number, step: number) {
    const ids = [...widgets];
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    saveWidgets(ids);
  }
  const periodKey = `${project.id}:${filter.start}:${filter.end}`;
  const previous = previousAnalysisPeriod(filter);
  const compare = widgets.includes("comparison");
  const [previousData, setPreviousData] = useState<{
    key: string;
    data?: ProjectOperations;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!compare || demoMode || project.legacy) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/projects/${project.id}/operations?${new URLSearchParams({ start: previous.start, end: previous.end })}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error ?? "Não foi possível consultar o período anterior.",
          );
        if (!controller.signal.aborted)
          setPreviousData({ key: periodKey, data: body.data });
      } catch (cause) {
        if (!controller.signal.aborted)
          setPreviousData({
            key: periodKey,
            error:
              cause instanceof Error ? cause.message : "Falha na comparação.",
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [
    compare,
    demoMode,
    project.id,
    project.legacy,
    previous.start,
    previous.end,
    periodKey,
  ]);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: ProjectOperations;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [currency, setCurrency] = useState("");
  useEffect(() => {
    if (demoMode || project.legacy) return;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(
          `/api/projects/${project.id}/operations?${new URLSearchParams({ start: filter.start, end: filter.end })}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error ?? "Não foi possível consultar as vendas.",
          );
        if (!controller.signal.aborted) {
          setLoaded({ key: periodKey, data: body.data });
          setFailure(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setFailure({
            key: periodKey,
            message:
              cause instanceof Error ? cause.message : "Falha de conexão.",
          });
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    project.id,
    project.legacy,
    filter.start,
    filter.end,
    periodKey,
    demoMode,
    revision,
  ]);
  const operationError = failure?.key === periodKey ? failure.message : "";
  const data =
    loaded?.key === periodKey && !operationError ? loaded.data : null;
  const currencies = [
    ...new Set([
      ...(data?.sales.map((sale) => sale.currency) ?? []),
      ...(data?.recovery.map((row) => row.currency).filter(Boolean) ?? []),
    ]),
  ].sort();
  const selectedCurrency = currencies.includes(currency)
    ? currency
    : data?.currency || currencies[0] || "BRL";
  const sales =
    data?.sales.filter(
      (sale) =>
        sale.currency === selectedCurrency &&
        matchesSaleProducts(sale, filter, products),
    ) ?? [];
  const recovery =
    data?.recovery.filter(
      (row) =>
        row.currency === selectedCurrency &&
        (filter.productIds === null ||
          Boolean(
            row.catalogProductId &&
              filter.productIds.includes(row.catalogProductId),
          )),
    ) ?? [];
  const summary = summarizeSales(sales, selectedCurrency);
  const prior = previousData?.key === periodKey ? previousData : null;
  const priorSales =
    prior?.data?.sales.filter(
      (sale) =>
        sale.currency === selectedCurrency &&
        matchesSaleProducts(sale, filter, products),
    ) ?? [];
  const priorSummary = summarizeSales(priorSales, selectedCurrency);
  const money = (value: number | null) =>
    value === null
      ? "Não informado"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: selectedCurrency,
        }).format(value);
  const totals = calculatePerformance(rows);
  const traffic = rows.reduce(
    (sum, row) => ({
      impressions: sum.impressions + row.impressions,
      clicks: sum.clicks + row.clicks,
      pageViews: sum.pageViews + row.pageViews,
      checkouts: sum.checkouts + row.checkouts,
    }),
    { impressions: 0, clicks: 0, pageViews: 0, checkouts: 0 },
  );
  const hasTraffic =
    ready && rows.length > 0 && rows.every(row => row.trafficAvailable !== false);
  const sources = saleSources(sales),
    paid = paidSaleGroups(sales);
  const noPage = paid.filter((items) => items.every((sale) => !sale.attribution.page)).length;
  const readiness = getProjectReadiness(
    project,
    { ...catalog, products },
    analytics,
  );
  const pendingItems = readiness.items.filter((item) => !item.ready);
  const operationState =
    operationError ||
    (demoMode
      ? "A demonstração não contém transações individuais."
      : project.legacy
        ? "Detalhamento indisponível para este projeto legado."
        : !data
          ? "Consultando vendas do período…"
          : "Nenhuma venda registrada nesta seleção.");
  const link = (view: WorkspaceView, label: string) => (
    <button
      type="button"
      onClick={() => onNavigate(view)}
      className="mt-5 inline-flex items-center gap-1 text-xs font-bold underline underline-offset-4"
    >
      {label}
      <ArrowUpRight size={14} />
    </button>
  );

  const contents: Record<WidgetId, ReactNode> = {
    comparison: (
      <>
        <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
          Período atual comparado com{" "}
          {previous.start.split("-").reverse().join("/")} a{" "}
          {previous.end.split("-").reverse().join("/")}, com a mesma duração,
          moeda e seleção de produtos.
        </p>
        {data && prior?.data ? (
          <Values
            items={[
              [
                "Compras · anterior → atual",
                `${priorSummary.transactions} → ${summary.transactions}`,
              ],
              [
                "Líquido · anterior → atual",
                `${priorSales.length ? money(priorSummary.afterFees) : "Sem dados"} → ${sales.length ? money(summary.afterFees) : "Sem dados"}`,
              ],
              [
                "Repasse · anterior → atual",
                `${priorSales.length ? money(priorSummary.payout) : "Sem dados"} → ${sales.length ? money(summary.payout) : "Sem dados"}`,
              ],
              [
                "Variação das compras",
                priorSummary.transactions
                  ? formatPercent(
                      (summary.transactions / priorSummary.transactions - 1) *
                        100,
                    )
                  : "Sem base anterior",
              ],
            ]}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            {prior?.error ||
              (demoMode || project.legacy || !data
                ? operationState
                : "Consultando período anterior…")}
          </p>
        )}
        {link("results", "Abrir resultados")}
      </>
    ),
    finance: (
      <>
        {data && sales.length ? (
          <>
            <Values
              items={[
                ["Bruto aprovado", money(summary.gross)],
                ["Reembolsos", money(summary.refunded)],
                ["Taxas da plataforma (saldo)", money(summary.fee)],
                ["Líquido após taxas", money(summary.afterFees)],
                ["Repasse ao produtor", money(summary.payout)],
              ]}
            />
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              O líquido após taxas e o repasse descontam os reembolsos
              registrados. O repasse considera a divisão entre participantes;
              não representa todo o líquido da venda.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">{operationState}</p>
        )}
        {link("sales", "Conferir transações")}
      </>
    ),
    traffic: (
      <>
        {hasTraffic ? (
          <Values
            items={[
              ["Investimento do projeto", formatCurrency(totals.investment)],
              ["Impressões", formatNumber(traffic.impressions)],
              ["Cliques", formatNumber(traffic.clicks)],
              [
                "CTR de link",
                traffic.impressions && totals.ctr !== null
                  ? formatPercent(totals.ctr)
                  : "Não calculável",
              ],
              ["Visitas à página", formatNumber(traffic.pageViews)],
              ["Idas ao checkout", formatNumber(traffic.checkouts)],
            ]}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            {!ready
              ? error || "Consultando tráfego…"
              : "Sem dados de tráfego nesta seleção."}
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          Tráfego e gastos pertencem ao projeto. A seleção de produtos filtra as
          vendas, sem dividir os gastos da conta.
        </p>
        {link("metrics", "Analisar tráfego diário")}
      </>
    ),
    origins: (
      <>
        {data && paid.length ? (
          <>
            <Values
              items={sources
                .slice(0, 5)
                .map(([source, count]) => [source, `${count} compra(s)`])}
            />
            <p
              className={`mt-4 rounded-xl p-3 text-xs ${noPage ? "bg-amber-50 text-amber-950" : "bg-black/5"}`}
            >
              {noPage} de {paid.length} compra(s) sem página de entrada informada.
              A URL do checkout não identifica a página de entrada. Ausência de
              UTM não comprova tráfego orgânico.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">{operationState}</p>
        )}
        {link("origins", "Investigar origens e páginas")}
      </>
    ),
    recovery: (
      <>
        {data ? (
          <>
            <Values
              items={[
                ["Tentativas registradas", formatNumber(recovery.length)],
                [
                  "Compras marcadas como recuperadas (não conciliadas)",
                  formatNumber(
                    recovery.filter((row) => row.status === "recovered").length,
                  ),
                ],
                [
                  "Demais tentativas",
                  formatNumber(
                    recovery.filter((row) => row.status !== "recovered").length,
                  ),
                ],
              ]}
            />
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              Registros pela última atividade no período. A marca de recuperação
              ainda depende da conferência da tentativa anterior e da compra.
              Ela não comprova recuperação por agente ou mensagem.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">{operationState}</p>
        )}
        {link("recovery", "Consultar tentativas")}
      </>
    ),
    forms: (
      <>
        {forms.forms.length ? (
          <>
            <Values
              items={forms.forms.map((form) => [
                form.title,
                `${formatNumber(form.totalResponses)} respostas`,
              ])}
            />
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              Total histórico dos formulários vinculados, independente do filtro
              de produtos e período acima.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Nenhum formulário vinculado. Conecte um formulário para acompanhar
            perguntas e respostas.
          </p>
        )}
        {link(
          forms.forms.length ? "forms" : "forms-setup",
          forms.forms.length ? "Abrir respostas" : "Conectar formulário",
        )}
      </>
    ),
    sources: (
      <>
        <Values
          items={[
            [
              "Produtos vinculados",
              String(
                products.filter(
                  (product) =>
                    product.mappedProjectId === project.id &&
                    !product.archivedAt,
                ).length,
              ),
            ],
            [
              "Contas Meta",
              catalog.metaAccounts.filter(
                (account) => (catalog.linkedMetaAccountIds ?? [catalog.linkedMetaAccountId]).includes(account.id),
              ).map((account) => account.name).join(" + ") || "Não vinculada",
            ],
            [
              "Google Forms",
              `${forms.forms.length} formulário(s) vinculado(s)`,
            ],
          ]}
        />
        {pendingItems.length > 0 && (
          <ul className="mt-4 space-y-2">
            {pendingItems.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(item.target)
                  }
                  className="text-left text-xs text-amber-900 underline underline-offset-4"
                >
                  {item.label}: {item.description}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          Vínculo não garante atualização. Confira sincronizações e erros em
          Configurar → Conexões e metas. Ausência de vendas no período não comprova falha na integração.
        </p>
        {link("settings", "Revisar fontes")}
      </>
    ),
  };

  return (
    <div className="space-y-5">
      {analytics.qualityWarnings?.map(message => <p key={message} className="rounded-xl bg-amber-50 p-4 text-xs leading-5"><strong>Base parcial.</strong> {message} Os valores financeiros abaixo correspondem somente às vendas processadas.</p>)}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">
            Seu painel do projeto
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Escolha os blocos que ajudam na sua rotina.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currencies.length > 1 && (
            <label className="flex items-center gap-2 text-xs">
              Moeda
              <select
                className="field"
                aria-label="Moeda do resumo"
                value={selectedCurrency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {currencies.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setCustomizing(!customizing)}
            aria-expanded={customizing}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-xs font-bold"
          >
            <Plus size={15} />
            Personalizar painel
          </button>
        </div>
      </div>
      {customizing && (
        <section
          aria-label="Personalizar painel"
          className="panel space-y-4 rounded-2xl p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 text-xs font-semibold">
              Começar com um modelo
            </span>
            {Object.entries(widgetPresets).map(([name, ids]) => (
              <button
                type="button"
                key={name}
                onClick={() => saveWidgets([...ids])}
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold"
              >
                {name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {Object.entries(widgetLabels).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={widgets.includes(id as WidgetId)}
                  onChange={(event) =>
                    saveWidgets(
                      event.target.checked
                        ? [...widgets, id as WidgetId]
                        : widgets.filter((value) => value !== id),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p role="status" className="text-xs text-[var(--muted)]">
            {preferenceNotice ||
              "A organização é salva neste navegador para este projeto. Use as setas nos blocos para mudar a ordem."}
          </p>
        </section>
      )}
      {operationError && (
        <div
          role="alert"
          className="flex flex-wrap justify-between gap-3 rounded-xl bg-amber-50 p-4 text-sm"
        >
          <span>
            {operationError} Os valores de vendas não estão sendo exibidos.
          </span>
          <button
            type="button"
            className="font-bold underline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicadores principais"
      >
        {[
          [
            "Compras aprovadas",
            data ? String(summary.transactions) : "Indisponível",
          ],
          [
            "Líquido após taxas",
            data && sales.length ? money(summary.afterFees) : "Sem dados",
          ],
          [
            "Repasse ao produtor",
            data && sales.length ? money(summary.payout) : "Sem dados",
          ],
          [
            "Investimento do projeto",
            hasTraffic ? formatCurrency(totals.investment) : "Sem dados",
          ],
        ].map(([label, value]) => (
          <article key={label} className="panel rounded-2xl p-5">
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p className="mt-3 text-2xl font-black tracking-tight tabular-nums">
              {value}
            </p>
          </article>
        ))}
      </section>
      {analytics.dataSources.csvDailyRows > 0 && (
        <p className="rounded-xl bg-blue-50 p-4 text-xs leading-5">
          O resumo financeiro acima usa transações da API e dos webhooks.
          Importações diárias de CSV aparecem em Tráfego diário e Custos e
          saldo, pois não contêm o detalhamento de cada compra.
        </p>
      )}
      {!widgets.length && (
        <div className="panel rounded-2xl p-8 text-center text-sm">
          Seu painel está vazio.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => setCustomizing(true)}
          >
            Adicionar blocos
          </button>
        </div>
      )}
      <section
        className="grid items-start gap-4 xl:grid-cols-2"
        aria-label="Blocos do resumo"
      >
        {widgets.map((id, index) => (
          <article key={id} className="panel min-w-0 rounded-2xl p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h3 className="text-base font-bold">{widgetLabels[id]}</h3>
              {customizing && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Mover ${widgetLabels[id]} para cima`}
                    disabled={index === 0}
                    onClick={() => moveWidget(index, -1)}
                    className="rounded-lg border p-2 disabled:opacity-25"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover ${widgetLabels[id]} para baixo`}
                    disabled={index === widgets.length - 1}
                    onClick={() => moveWidget(index, 1)}
                    className="rounded-lg border p-2 disabled:opacity-25"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${widgetLabels[id]}`}
                    onClick={() =>
                      saveWidgets(widgets.filter((value) => value !== id))
                    }
                    className="rounded-lg border p-2"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            {contents[id]}
          </article>
        ))}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <p>
          {data
            ? `Vendas consultadas em ${new Date(data.loadedAt).toLocaleString("pt-BR")}. Atualização a cada minuto enquanto esta tela estiver visível.`
            : "Os blocos indicam quando a fonte não possui dados disponíveis."}
        </p>
        <button
          type="button"
          onClick={onSyncMeta}
          disabled={syncing || (!demoMode && !catalog.linkedMetaAccountId)}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 font-bold disabled:opacity-40"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Atualizar tráfego da Meta
        </button>
      </div>
    </div>
  );
}

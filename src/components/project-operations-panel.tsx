"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import {
  csvDocument,
  summarizeSales,
  type ProjectOperations,
  type SaleRow,
} from "@/lib/project-operations";
import { dateInTimezone } from "@/lib/dates";
import type { AnalysisFilter } from "@/lib/analysis-filters";
import type { ProjectProduct } from "@/lib/domain";
import { saleOrigins } from "@/lib/dashboard-widgets";

export type OperationView =
  | "sales"
  | "origins"
  | "contacts"
  | "recovery"
  | "results";
const labels = {
  sales: "Vendas",
  origins: "Origens das vendas",
  contacts: "Contatos",
  recovery: "Recuperação",
  results: "Receita das vendas",
};
const statusLabels: Record<string, string> = {
  paid: "Paga",
  refunded: "Reembolso",
  reversed: "Estornada — histórico Hotmart",
  partial_refund: "Reembolso parcial — valor pendente",
  pending: "Pagamento pendente",
  abandoned: "Abandono",
  failed: "Falha no pagamento",
  expired: "Expirada",
  recovered: "Marcada como recuperada (não conciliada)",
};
const pageSize = 50;
export function money(value: number | null, currency = "BRL") {
  return value === null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
        value,
      );
}
export function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(date);
}
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const url = URL.createObjectURL(
    new Blob([csvDocument(headers, rows)], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ProjectGrid({
  headers,
  rows,
  empty = "Nenhum registro encontrado.",
  sticky = true,
}: {
  headers: ReactNode[];
  rows: { id: string; cells: ReactNode[] }[];
  empty?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className="overflow-auto rounded-2xl border border-[var(--line)] bg-white/60"
      style={{ maxHeight: "65vh" }}
    >
      <table className="w-full border-separate border-spacing-0 text-left text-xs">
        <thead className="sticky top-0 z-20 bg-[var(--paper)]">
          <tr>
            {headers.map((label, index) => (
              <th
                key={index}
                scope="col"
                className={`min-w-36 border-b border-[var(--line)] px-4 py-3 font-bold ${index === 0 && sticky ? "sticky left-0 z-30 bg-[var(--paper)]" : ""}`}
              >
                <div className="min-w-24 max-w-72 whitespace-normal">
                  {label}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group hover:bg-violet-50/70">
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={`border-b border-[var(--line)] px-4 py-3 align-top ${index === 0 && sticky ? "sticky left-0 z-10 bg-[var(--paper)] group-hover:bg-violet-50" : ""}`}
                >
                  <div className="max-w-80 whitespace-pre-wrap break-words">
                    {cell === null || cell === undefined || cell === ""
                      ? "—"
                      : cell}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="p-8 text-sm text-[var(--muted)]">{empty}</p>
      )}
    </div>
  );
}

const salesHeaders = [
  "Data / hora",
  "Transação",
  "Produto",
  "Status",
  "Nome",
  "E-mail",
  "Telefone",
  "Bruto",
  "Taxa da plataforma",
  "Líquido após taxa",
  "Recebido pelo produtor",
  "Página de entrada",
  "Checkout",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "Adicional?",
  "Pagamento",
  "Parcelas",
  "Oferta",
  "Plataforma",
];
function saleCells(sale: SaleRow, exporting = false): ReactNode[] {
  const values = [sale.gross, sale.fee, sale.afterFees, sale.payout].map(
    (value) => (exporting ? value : money(value, sale.currency)),
  );
  return [
    timestamp(sale.occurredAt),
    sale.transaction,
    sale.product,
    statusLabels[sale.status],
    sale.name,
    sale.email,
    sale.phone,
    ...values,
    sale.attribution.page ?? "Não identificada",
    sale.attribution.checkoutUrl ?? "Não informado",
    sale.attribution.source,
    sale.attribution.medium,
    sale.attribution.campaign,
    sale.attribution.content,
    sale.attribution.term,
    sale.attribution.id,
    sale.orderBump ? "Sim" : "Não",
    sale.paymentMethod,
    sale.installments,
    sale.offer,
    sale.provider,
  ];
}

export function ProjectOperationsPanel({
  projectId,
  view,
  demoMode = false,
  filter,
  products,
}: {
  projectId: string;
  view: OperationView;
  demoMode?: boolean;
  filter: AnalysisFilter;
  products: ProjectProduct[];
}) {
  const period = useMemo(() => ({ start: filter.start, end: filter.end }), [filter.start, filter.end]);
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<number[]>([0, 2, 3, 4, 9, 10, 13]);
  const [status, setStatus] = useState("");
  const [currency, setCurrency] = useState("");
  const [loadedData, setData] = useState<ProjectOperations | null>(null);
  const [loadedPeriod, setLoadedPeriod] = useState("");
  const data = loadedPeriod === `${period.start}:${period.end}` ? loadedData : null;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (demoMode) return;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/projects/${projectId}/operations?${new URLSearchParams(period)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Falha ao carregar os registros.");
        if (!controller.signal.aborted) {
          setData(body.data);
          setLoadedPeriod(`${period.start}:${period.end}`);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(
            cause instanceof Error ? cause.message : "Falha de conexão.",
          );
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
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
  }, [projectId, period, revision, demoMode]);

  const selectedCurrency = currency || data?.currency || "BRL";
  const filtered = useMemo(() => {
    const selectedIds = filter.productIds;
    const matchesProduct = (sale: SaleRow) => selectedIds === null ||
      (sale.catalogProductId ? selectedIds.includes(sale.catalogProductId) : products.some((product) =>
        selectedIds.includes(product.id) && product.externalId === sale.productId && product.connectionId === sale.connectionId));
    const matchedContacts = new Set([
      ...(data?.sales ?? []).filter(matchesProduct).map((sale) => sale.contactId),
      ...(data?.recovery ?? []).filter((attempt) => selectedIds === null ||
        selectedIds.includes(attempt.catalogProductId ?? "")).map((attempt) => attempt.contactId),
    ]);
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    const matches = (values: unknown[]) =>
      !needle ||
      values.some((value) =>
        String(value ?? "")
          .toLocaleLowerCase("pt-BR")
          .includes(needle),
      );
    return {
      sales: (data?.sales ?? []).filter(
        (sale) =>
          sale.currency === selectedCurrency &&
          matchesProduct(sale) &&
          (!status || sale.status === status) &&
          matches([
            sale.transaction,
            sale.product,
            sale.name,
            sale.email,
            sale.phone,
            ...Object.values(sale.attribution),
          ]),
      ),
      contacts: (data?.contacts ?? []).filter((contact) => {
        const hasActivity = [contact.createdAt, contact.lastSeenAt].some((value) => {
          if (!value || Number.isNaN(Date.parse(value))) return false;
          const date = dateInTimezone(new Date(value));
          return date >= period.start && date <= period.end;
        }) || matchedContacts.has(contact.id);
        return hasActivity && (selectedIds === null || matchedContacts.has(contact.id)) &&
          matches([contact.name, contact.email, contact.phone, contact.source]);
      }),
      recovery: (data?.recovery ?? []).filter(
        (attempt) =>
          attempt.currency === selectedCurrency &&
          (selectedIds === null || selectedIds.includes(attempt.catalogProductId ?? "")) &&
          (!status || attempt.status === status) &&
          matches([
            attempt.name,
            attempt.email,
            attempt.phone,
            attempt.product,
            attempt.source,
            attempt.campaign,
          ]),
      ),
    };
  }, [data, query, status, selectedCurrency, filter.productIds, products, period]);
  const summary = summarizeSales(filtered.sales, selectedCurrency);
  const currencies = Array.from(
    new Set([
      data?.currency || "BRL",
      ...(data?.sales ?? []).map((sale) => sale.currency),
      ...(data?.recovery ?? []).map((row) => row.currency),
    ]),
  );
  const origins = saleOrigins(filtered.sales);
  const refunded = new Set(
    filtered.sales
      .filter((sale) => sale.status === "refunded")
      .map((sale) => `${sale.connectionId}:${sale.transaction}`),
  );
  const buyers = new Set(
    filtered.sales
      .filter(
        (sale) =>
          sale.status === "paid" &&
          !refunded.has(`${sale.connectionId}:${sale.transaction}`),
      )
      .map((sale) => sale.contactId)
      .filter(Boolean),
  );
  const cohort = filtered.contacts.filter((contact) => {
    const date = dateInTimezone(new Date(contact.createdAt));
    return date >= period.start && date <= period.end;
  });
  const converted = cohort.filter((contact) => buyers.has(contact.id)).length;
  const conversion = cohort.length
    ? `${((converted / cohort.length) * 100).toFixed(1)}%`
    : "Sem base de contatos";
  let headers: string[] = salesHeaders;
  let allRows: { id: string; cells: ReactNode[] }[] = filtered.sales.map(
    (sale) => ({ id: sale.id, cells: saleCells(sale) }),
  );
  if (view === "origins") {
    headers = [
      "Origem",
      "Meio",
      "Campanha",
      "Página de entrada",
      "Compras",
      "Bruto",
      "Taxas",
      "Líquido após taxa",
      "Recebido pelo produtor",
      "Reembolsos",
    ];
    allRows = Array.from(origins, ([id, group]) => {
      const sums = summarizeSales(group.sales, selectedCurrency);
      return {
        id,
        cells: [
          ...group.label,
          sums.transactions,
          money(sums.gross, selectedCurrency),
          money(sums.fee, selectedCurrency),
          money(sums.afterFees, selectedCurrency),
          money(sums.payout, selectedCurrency),
          sums.refunds,
        ],
      };
    });
  }
  if (view === "contacts") {
    headers = [
      "Nome",
      "E-mail",
      "Telefone",
      "Origem do contato",
      "Primeiro registro",
      "Último registro",
      "Compras no período",
      "Recebido pelo produtor",
    ];
    allRows = filtered.contacts.map((contact) => {
      const sums = summarizeSales(
        filtered.sales.filter((sale) => sale.contactId === contact.id),
        selectedCurrency,
      );
      return {
        id: contact.id,
        cells: [
          contact.name,
          contact.email,
          contact.phone,
          contact.source,
          timestamp(contact.createdAt),
          timestamp(contact.lastSeenAt),
          sums.transactions,
          money(sums.payout, selectedCurrency),
        ],
      };
    });
  }
  if (view === "recovery") {
    headers = [
      "Status",
      "Nome",
      "E-mail",
      "Telefone",
      "Produto",
      "Valor da tentativa",
      "Origem",
      "Campanha",
      "Último evento",
      "Checkout",
      "Plataforma",
    ];
    allRows = filtered.recovery.map((attempt) => ({
      id: attempt.id,
      cells: [
        statusLabels[attempt.status] ?? attempt.status,
        attempt.name,
        attempt.email,
        attempt.phone,
        attempt.product,
        money(attempt.amount, attempt.currency),
        attempt.source,
        attempt.campaign,
        timestamp(attempt.lastSeenAt),
        attempt.checkoutUrl ?? "",
        attempt.provider,
      ],
    }));
  }
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(allRows.length / pageSize)),
  );
  function exportRows() {
    const rows =
      view === "sales" || view === "results"
        ? filtered.sales.map((sale) => saleCells(sale, true))
        : allRows.map((row) => row.cells);
    downloadCsv(`${view}-${period.start}-${period.end}.csv`, headers, rows);
  }
  return (
    <section className="panel space-y-6 rounded-[24px] p-5 sm:p-7">
      {data?.sales.some(sale=>["reversed","partial_refund"].includes(sale.status)) && <p className="rounded-xl bg-amber-50 p-3 text-sm">A Hotmart informou estornos no histórico. Essas compras estão separadas das receitas aprovadas. A data do estorno e o valor de reembolsos parciais dependem dos eventos da plataforma; totais líquidos com reembolso parcial ficam como não informados.</p>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Operação do projeto</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">
            {labels[view]}
          </h2>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {view === "contacts"
              ? "Contatos do projeto com compras no período selecionado."
              : "Registros recebidos das plataformas • horário de Brasília"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{" "}
            Atualizar
          </button>
          <button
            className="flex items-center gap-2 rounded-xl bg-[var(--ink)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            onClick={exportRows}
            disabled={loading || !allRows.length || Boolean(error)}
          >
            <Download size={14} /> Exportar CSV completo
          </button>
        </div>
      </div>
      {filter.productIds !== null && <p className="text-xs text-[var(--muted)]">Contatos limitados às compras e tentativas vinculadas aos produtos selecionados no período. Registros sem produto identificado ficam fora desta seleção.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_130px_180px]">
        <label className="relative self-end">
          <Search
            size={15}
            className="absolute left-3 top-4 text-[var(--muted)]"
          />
          <input
            className="field pl-9 text-sm"
            style={{ paddingLeft: "2.25rem" }}
            aria-label="Buscar registros"
            placeholder="Nome, produto, contato ou campanha"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-xs">
          Moeda
          <select
            className="field mt-1"
            value={selectedCurrency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {currencies.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Status
          <select
            className="field mt-1"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(statusLabels)
              .filter(([key]) =>
                view === "recovery"
                  ? !["paid", "refunded"].includes(key)
                  : ["paid", "refunded"].includes(key),
              )
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-900"
        >
          {error}{" "}
          {data &&
            "Os dados anteriores estão preservados; atualize para tentar novamente."}
        </p>
      )}
      {demoMode && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm">
          Conecte um projeto real para consultar suas vendas e respostas.
        </p>
      )}
      {!data && !demoMode && (loading || !error) ? (
        <div className="flex gap-3 p-8 text-sm">
          <LoaderCircle className="animate-spin" size={18} /> Carregando dados
          do projeto…
        </div>
      ) : data ? (
        <>
          {view !== "recovery" && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Compras", String(summary.transactions)],
                ["Valor bruto", money(summary.gross, selectedCurrency)],
                [
                  "Líquido após taxa da plataforma",
                  money(summary.afterFees, selectedCurrency),
                ],
                [
                  "Recebido pelo produtor",
                  money(summary.payout, selectedCurrency),
                ],
              ].map(([label, value]) => (
                <div className="rounded-2xl bg-black/[0.035] p-4" key={label}>
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <strong className="mt-2 block text-xl tracking-tight">
                    {value}
                  </strong>
                </div>
              ))}
            </div>
          )}
          {view === "results" && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [
                  "Reembolsos no período",
                  money(summary.refunded, selectedCurrency),
                ],
                ["Contatos registrados no período", String(cohort.length)],
                ["Relação entre contatos e compradores registrados", conversion],
              ].map(([label, value]) => (
                <div
                  className="rounded-2xl border border-[var(--line)] p-4"
                  key={label}
                >
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <strong className="mt-2 block text-lg">{value}</strong>
                </div>
              ))}
            </div>
          )}
          {view === "results" && (
            <p className="text-xs leading-5 text-[var(--muted)]">
              Proporção dos contatos com primeiro registro no período que também
              possuem compra registrada nesta seleção. A cobertura do histórico
              e a identificação por e-mail ou telefone podem alterar essa relação;
              ela não mede conversão atribuída a anúncio ou formulário.
            </p>
          )}
          {view === "recovery" && (
            <p className="rounded-xl bg-amber-50 p-4 text-xs leading-5">
              Compras marcadas como recuperadas (não conciliadas): o status
              registrado ainda depende da conferência da tentativa anterior e
              da compra. Ele não comprova recuperação por agente ou mensagem.
            </p>
          )}
          {(view === "sales" || view === "origins") && (
            <p className="text-xs leading-5 text-[var(--muted)]">
              Página de entrada e checkout são endereços distintos. A presença
              da URL de pagamento não comprova qual página levou à compra.
            </p>
          )}
          {view !== "recovery" && (
            <p className="text-xs leading-5 text-[var(--muted)]">
              Líquido após taxa = bruto menos a taxa informada pela plataforma.
              Recebido pelo produtor considera a comissão ou repasse informado.
              Reembolsos são descontados desses totais.{" "}
              {summary.unknownFinancial > 0 &&
                `${summary.unknownFinancial} registro(s) sem detalhamento suficiente: o valor ausente aparece como “Não informado”.`}
            </p>
          )}
          {view === "sales" && <details className="rounded-xl border border-[var(--line)] p-4">
            <summary className="text-xs font-bold">Colunas da tabela · {columns.length} de {salesHeaders.length}</summary>
            <p className="mt-3 text-xs text-[var(--muted)]">O CSV sempre inclui todas as colunas, independentemente desta seleção.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{salesHeaders.map((label, index) => <label key={label} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={columns.includes(index)} disabled={columns.length === 1 && columns.includes(index)} onChange={(event) => setColumns(event.target.checked ? [...columns, index] : columns.filter((value) => value !== index))} />{label}
            </label>)}</div>
            <button type="button" className="mt-4 text-xs font-bold underline" onClick={() => setColumns(salesHeaders.map((_, index) => index))}>Exibir todas</button>
          </details>}
          <ProjectGrid
            headers={view === "sales" ? headers.filter((_, index) => columns.includes(index)) : headers}
            rows={allRows.slice(
              (currentPage - 1) * pageSize,
              currentPage * pageSize,
            ).map((row) => view === "sales" ? { ...row, cells: row.cells.filter((_, index) => columns.includes(index)) } : row)}
            empty="Nenhum registro neste filtro. Confira o período e o vínculo dos produtos em Configurar → Produtos e funil."
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>
              {allRows.length} registros • Página {currentPage} de{" "}
              {Math.max(1, Math.ceil(allRows.length / pageSize))}
            </span>
            <div className="flex gap-2">
              <button
                className="rounded-lg border px-3 py-2 disabled:opacity-30"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Anterior
              </button>
              <button
                className="rounded-lg border px-3 py-2 disabled:opacity-30"
                disabled={currentPage * pageSize >= allRows.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Próxima
              </button>
            </div>
            <span>
              {data
                ? `Consultado em ${timestamp(data.loadedAt)} • atualização a cada minuto`
                : "Aguardando dados"}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}

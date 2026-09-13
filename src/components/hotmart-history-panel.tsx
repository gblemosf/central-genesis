"use client";
import { useEffect, useState } from "react";
import { historyStatusLabels } from "@/lib/hotmart-history";
import { csvDocument } from "@/lib/project-operations";
import { record, saleAttribution, text } from "@/lib/sales-attribution";

type Product = { id: string; name: string; external_id: string };
type Job = {
  id: string;
  product_id: string;
  start_at: string;
  end_at: string;
  status: string;
  processed: number;
  error_message: string | null;
};
type HistoryRecord = {
  id: string;
  transaction_id: string;
  purchase_status: string;
  ordered_at: string;
  approved_at: string | null;
  gross_amount: number;
  currency: string;
  payload: Record<string, unknown>;
  observed_at: string;
};
type Data = {
  products: Product[];
  jobs: Job[];
  records: HistoryRecord[];
  total: number;
};
const field =
  "w-full rounded-xl border border-[var(--line)] bg-white p-2 text-sm";
const jobLabels: Record<string, string> = {
  queued: "Na fila",
  running: "Importando",
  completed: "Concluída",
  failed: "Precisa de atenção",
};
function date(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}
function money(value: unknown, currency: string) {
  return value === null || value === undefined
    ? "Não informado"
    : Number(value).toLocaleString("pt-BR", { style: "currency", currency });
}
const headers = [
  "Pedido em",
  "Aprovado em",
  "Transação",
  "Produto",
  "Estado atual",
  "Nome",
  "E-mail",
  "Telefone",
  "Moeda",
  "Valor da compra",
  "Taxa",
  "Líquido após taxa",
  "Recebido pelo produtor",
  "Página",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "SCK original",
  "Código da página",
  "SRC original",
  "Pagamento",
  "Parcelas",
  "Oferta",
  "Consultado em",
];
function cells(row: HistoryRecord, exporting = false) {
  const contact = record(row.payload.contact),
    financial = record(row.payload.financial),
    attribution = record(row.payload.attribution);
  const utm = saleAttribution(
    attribution,
    text(row.payload.product_external_id),
  );
  return [
    date(row.ordered_at),
    row.approved_at ? date(row.approved_at) : "",
    row.transaction_id,
    text(row.payload.product_name),
    historyStatusLabels[row.purchase_status] || row.purchase_status,
    text(contact.name),
    text(contact.email),
    text(contact.phone),
    row.currency,
    ...[
      row.gross_amount,
      financial.platform_fee,
      financial.net_after_fees,
      financial.payout,
    ].map((v) => (exporting ? v : money(v, row.currency))),
    utm.page || "Não identificada",
    utm.source,
    utm.medium,
    utm.campaign,
    utm.content,
    utm.term,
    utm.id,
    text(attribution.sck),
    text(attribution.xcod),
    text(row.payload.tracking_source),
    text(record(row.payload.payment).type),
    text(record(row.payload.payment).installments),
    text(record(row.payload.offer).name || record(row.payload.offer).code),
    date(row.observed_at),
  ];
}

export function HotmartHistoryPanel({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState(() => {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    return { start: today.slice(0, 7) + "-01", end: today };
  });
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const query = new URLSearchParams({
          ...period,
          productId,
          status,
          page: String(page),
        });
        const response = await fetch(
          `/api/projects/${projectId}/hotmart-history?${query}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error || "Não foi possível carregar o histórico.",
          );
        if (!controller.signal.aborted) {
          setData(body);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Falha de conexão.",
          );
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [projectId, period, productId, status, page, revision]);
  async function submit(id?: string) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/hotmart-history`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(id ? { id } : { productId, ...period }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Não foi possível iniciar a importação.");
      setNotice(
        "Importação na fila. Ela continua em segundo plano, mesmo se você fechar esta tela.",
      );
      setRevision((v) => v + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  function exportPage() {
    const blob = new Blob(
      [
        csvDocument(
          headers,
          (data?.records || []).map((row) => cells(row, true)),
        ),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `historico-hotmart-pagina-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const running = data?.jobs.some(
    (job) =>
      job.product_id === productId &&
      ["queued", "running"].includes(job.status),
  );
  return (
    <details
      className="rounded-2xl border border-[var(--line)] bg-white/60 p-4"
      open
    >
      <summary className="cursor-pointer text-base font-bold">
        Importar histórico da Hotmart
      </summary>
      <p className="my-3 text-sm text-[var(--muted)]">
        Escolha um produto vinculado a este projeto e o período dos pedidos. As
        compras aprovadas entram em Vendas, Origens, Contatos e Resultados.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm">
          Produto
          <select
            className={field}
            value={productId}
            required
            onChange={(e) => {
              setProductId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Selecione o produto</option>
            {data?.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          De
          <input
            className={field}
            type="date"
            required
            value={period.start}
            max={period.end}
            onChange={(e) => {
              setPeriod({ ...period, start: e.target.value });
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm">
          Até
          <input
            className={field}
            type="date"
            required
            value={period.end}
            min={period.start}
            max={new Date().toLocaleDateString("en-CA", {
              timeZone: "America/Sao_Paulo",
            })}
            onChange={(e) => {
              setPeriod({ ...period, end: e.target.value });
              setPage(1);
            }}
          />
        </label>
        <button
          className="self-end rounded-xl bg-[var(--ink)] p-3 text-sm font-bold text-white disabled:opacity-40"
          disabled={busy || !productId || running}
        >
          {busy
            ? "Enviando…"
            : running
              ? "Importação em andamento"
              : "Importar período"}
        </button>
      </form>
      {data && !data.products.length && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
          Vincule um produto da conexão Hotmart na aba Produtos para habilitar a
          importação.
        </p>
      )}
      <p className="mt-3 text-xs text-[var(--muted)]">
        Ao importar um período anterior ao vínculo, este produto passa a
        pertencer ao projeto desde a data escolhida. Períodos já vinculados a
        outro projeto são bloqueados.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-sm">
          {notice}
        </p>
      )}
      {!!data?.jobs.length && (
        <div className="my-4 space-y-2">
          {data.jobs.slice(0, 5).map((job) => (
            <div
              key={job.id}
              className="rounded-xl border border-[var(--line)] p-3 text-sm"
            >
              <strong>{jobLabels[job.status]}</strong> ·{" "}
              {data.products.find((p) => p.id === job.product_id)?.name ||
                "Produto Hotmart"}{" "}
              · {date(job.start_at).split(",")[0]} a{" "}
              {date(job.end_at).split(",")[0]} · {job.processed} registros
              processados
              {job.error_message && (
                <p className="mt-1 text-red-800">{job.error_message}</p>
              )}
              {job.status === "failed" && (
                <button
                  type="button"
                  className="mt-2 underline"
                  disabled={busy}
                  onClick={() => void submit(job.id)}
                >
                  Retomar do último lote
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Histórico consultado — todos os estados ({data?.total ?? 0})
        </summary>
        <p className="my-3 text-xs text-[var(--muted)]">
          Valores da compra, por moeda e estado atual; pendências e reembolsos
          não são receita aprovada. A API não informa aqui a data ou o valor
          efetivo de cada estorno parcial. UTMs ausentes ficam sem
          identificação. Recuperação exige uma pendência observada antes da
          aprovação.
        </p>
        <div className="my-3 flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Estado
            <select
              className={field}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(historyStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-xl border p-2 text-sm"
            disabled={!data?.records.length}
            onClick={exportPage}
          >
            Exportar página CSV
          </button>
        </div>
        <div className="max-h-[540px] overflow-auto rounded-xl border border-[var(--line)]">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="sticky top-0 bg-white">
              <tr>
                {headers.map((label) => (
                  <th className="p-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.records.map((row) => (
                <tr className="border-t border-[var(--line)]" key={row.id}>
                  {cells(row).map((value, index) => (
                    <td
                      className="max-w-96 whitespace-pre-wrap p-3"
                      key={index}
                    >
                      {text(value) || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {Math.max(1, Math.ceil((data?.total || 0) / 50))}
          </span>
          <button
            type="button"
            disabled={page * 50 >= (data?.total || 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      </details>
    </details>
  );
}

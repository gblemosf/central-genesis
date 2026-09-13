"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SheetTable } from "@/lib/google/sheets";
import {
  downloadCsv,
  ProjectGrid,
  timestamp,
} from "@/components/project-operations-panel";

export function ProjectLinkedSheet({
  projectId,
  formId,
}: {
  projectId: string;
  formId: string;
}) {
  const [tab, setTab] = useState<number>(),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<SheetTable | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          ...(tab === undefined ? {} : { sheetId: String(tab) }),
        });
        const response = await fetch(
          `/api/projects/${projectId}/forms/${formId}/sheet?${params}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Falha ao consultar a planilha.");
        if (!controller.signal.aborted) {
          setData(body.data);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Falha de conexão.",
          );
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
  }, [projectId, formId, tab, page, revision]);
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-[var(--muted)]">
        Leitura direta da planilha vinculada: cabeçalhos, colunas manuais e
        resultados de fórmulas, na ordem das células. A primeira linha é usada
        como cabeçalho. A planilha continua sendo a fonte desses valores.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {data && (
          <label className="text-xs">
            Aba da planilha
            <select
              className="field mt-1"
              value={tab ?? data.sheetId}
              onChange={(event) => {
                setTab(Number(event.target.value));
                setPage(1);
                setData(null);
              }}
            >
              {data.tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="rounded-lg border p-3"
          aria-label="Atualizar planilha vinculada"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
        <button
          className="rounded-lg border px-4 py-3 text-xs disabled:opacity-40"
          disabled={loading || !data?.rows.length || Boolean(error)}
          onClick={() =>
            data &&
            downloadCsv(
              `planilha-${data.sheetId}-pagina-${page}.csv`,
              data.headers,
              data.rows.map((row) => row.values),
            )
          }
        >
          Exportar página
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">
          {error}
        </p>
      )}
      {loading && !data && (
        <p className="p-6 text-sm">Consultando o Google Sheets…</p>
      )}
      {data && (
        <>
          <p className="text-xs">
            {data.title} • Consultado em {timestamp(data.loadedAt)}
          </p>
          <ProjectGrid
            headers={["Linha", ...data.headers]}
            rows={data.rows.map((row) => ({
              id: String(row.rowNumber),
              cells: [row.rowNumber, ...row.values],
            }))}
            empty="Não há células preenchidas neste intervalo. Avance para consultar as próximas linhas."
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>
              Linhas {2 + (page - 1) * 100} a {1 + page * 100} •{" "}
              {data.headers.length} colunas
            </span>
            <div className="flex gap-2">
              <button
                className="rounded-lg border px-3 py-2 disabled:opacity-40"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setPage(page - 1);
                  setData(null);
                }}
              >
                Anterior
              </button>
              <button
                className="rounded-lg border px-3 py-2 disabled:opacity-40"
                disabled={!data.hasMore || loading}
                onClick={() => {
                  setPage(page + 1);
                  setData(null);
                }}
              >
                Próximas linhas
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

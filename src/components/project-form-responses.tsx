"use client";

import { useEffect, useState } from "react";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { ProjectGoogleForm } from "@/lib/domain";
import { answerText, type FormTableData } from "@/lib/form-table";
import {
  downloadCsv,
  ProjectGrid,
  timestamp,
} from "@/components/project-operations-panel";
import { ProjectLinkedSheet } from "@/components/project-linked-sheet";

export function ProjectFormResponses({
  projectId,
  forms,
}: {
  projectId: string;
  forms: ProjectGoogleForm[];
}) {
  const [selected, setSelected] = useState("");
  const formId = selected || forms[0]?.id || "";
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<FormTableData | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(true),
    [query, setQuery] = useState("");
  const [source, setSource] = useState<"form" | "sheet">("form");
  useEffect(() => {
    if (!formId || source !== "form") return;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/projects/${projectId}/forms/${formId}/responses?page=${page}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Falha ao carregar respostas.");
        if (controller.signal.aborted) return;
        setData(body.data);
        setError("");
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
  }, [projectId, formId, page, revision, source]);
  const columns = (data?.columns ?? []).filter(
    (column) => showArchived || !column.archived,
  );
  const rows = (data?.rows ?? []).filter(
    (row) =>
      !query ||
      [
        row.email,
        ...Object.values(row.answers).map((answer) => answerText(answer.value)),
      ].some((value) =>
        value
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
  );
  const headers = [
    "Carimbo de data/hora",
    "Endereço de e-mail",
    ...columns.map((column) => column.title),
  ];
  return (
    <section className="panel space-y-5 rounded-[24px] p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="eyebrow">Respostas por formulário</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">
            Todas as perguntas, em colunas
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            As colunas acompanham as perguntas do formulário, incluindo grades e
            múltiplas escolhas. Perguntas removidas permanecem disponíveis no
            histórico.
          </p>
        </div>
        <div
          className={source === "form" ? "flex items-start gap-2" : "hidden"}
        >
          <button
            className="rounded-xl border p-3"
            aria-label="Atualizar tabela de respostas"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            className="flex gap-2 rounded-xl bg-[var(--ink)] px-4 py-3 text-xs font-bold text-white disabled:opacity-40"
            disabled={!rows.length || loading || Boolean(error)}
            onClick={() =>
              downloadCsv(
                `respostas-${formId}-pagina-${page}.csv`,
                headers,
                rows.map((row) => [
                  timestamp(row.submittedAt),
                  row.email,
                  ...columns.map((column) =>
                    answerText(row.answers[column.id]?.value),
                  ),
                ]),
              )
            }
          >
            <Download size={15} /> Exportar página
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Formulário
          <select
            className="field mt-1"
            value={formId}
            onChange={(event) => {
              setSelected(event.target.value);
              setPage(1);
              setData(null);
            }}
          >
            <option value="">Selecione um formulário</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.title}
              </option>
            ))}
          </select>
        </label>
        <label className={source === "form" ? "text-xs" : "hidden"}>
          Buscar nesta página
          <input
            className="field mt-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar em todas as respostas exibidas"
          />
        </label>
      </div>
      <div className="flex gap-2" aria-label="Fonte da tabela">
        {(
          [
            ["form", "Respostas do formulário"],
            ["sheet", "Planilha vinculada"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`rounded-xl border px-4 py-2 text-xs ${source === key ? "bg-[var(--ink)] text-white" : ""}`}
            aria-pressed={source === key}
            onClick={() => setSource(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "sheet" && formId ? (
        <ProjectLinkedSheet
          key={formId}
          projectId={projectId}
          formId={formId}
        />
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{" "}
            Incluir perguntas removidas do formulário
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-4 text-sm text-red-900"
            >
              {error}
            </p>
          )}
          {loading && !data ? (
            <div className="flex gap-2 p-6 text-sm">
              <LoaderCircle size={18} className="animate-spin" /> Carregando
              perguntas e respostas…
            </div>
          ) : (
            <ProjectGrid
              headers={[
                ...headers.slice(0, 2),
                ...columns.map((column) => (
                  <span key={column.id}>
                    {column.title}
                    {column.archived && (
                      <span className="mt-1 block text-[10px] font-normal text-amber-800">
                        Pergunta removida
                      </span>
                    )}
                  </span>
                )),
              ]}
              rows={rows.map((row) => ({
                id: row.id,
                cells: [
                  timestamp(row.submittedAt),
                  row.email,
                  ...columns.map((column) => {
                    const answer = row.answers[column.id];
                    return (
                      <span key={column.id}>
                        {answerText(answer?.value) || "—"}
                        {answer?.title && answer.title !== column.title && (
                          <small className="mt-2 block text-[10px] text-[var(--muted)]">
                            Pergunta na resposta: {answer.title}
                          </small>
                        )}
                      </span>
                    );
                  }),
                ],
              }))}
              empty={
                formId
                  ? "Este formulário ainda não possui respostas sincronizadas."
                  : "Vincule um Google Form acima para apresentar suas perguntas e respostas aqui."
              }
            />
          )}
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <span>
                {data.total} respostas • {columns.length} perguntas • Página{" "}
                {page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border px-3 py-2 disabled:opacity-30"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    setData(null);
                    setPage(page - 1);
                  }}
                >
                  Anterior
                </button>
                <button
                  className="rounded-lg border px-3 py-2 disabled:opacity-30"
                  disabled={page * data.pageSize >= data.total || loading}
                  onClick={() => {
                    setData(null);
                    setPage(page + 1);
                  }}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

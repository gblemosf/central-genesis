"use client";
import { useState } from "react";
import { dateInTimezone } from "@/lib/dates";
import { periodPresets, presetPeriod, validAnalysisPeriod, type AnalysisFilter } from "@/lib/analysis-filters";

export function AnalysisFilters({ value, onChange, products }: {
  value: AnalysisFilter; onChange: (value: AnalysisFilter) => void;
  products: { id: string; name: string }[];
}) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ start: value.start, end: value.end });
  const today = dateInTimezone(new Date());
  const ids = value.productIds ?? products.map((product) => product.id);
  return <section className="panel space-y-4 rounded-[20px] p-5" aria-label="Filtros da análise">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-2 text-xs font-bold">Período</span>
      {periodPresets.map(([key, label]) => {
        const period = presetPeriod(key, today);
        const selected = !custom && value.start === period.start && value.end === period.end;
        return <button type="button" key={key} aria-pressed={selected}
          className={`rounded-lg border px-3 py-2 text-xs font-bold ${selected ? "bg-[var(--ink)] text-white" : "border-[var(--line)]"}`}
          onClick={() => { setCustom(false); setDraft(period); onChange({ ...value, ...period }); }}>{label}</button>;
      })}
      <button type="button" aria-pressed={custom} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold"
        onClick={() => { setCustom(true); setDraft({ start: value.start, end: value.end }); }}>Período personalizado</button>
      <details className="relative ml-auto text-xs">
        <summary className="cursor-pointer rounded-lg border border-[var(--line)] px-4 py-3 font-bold">
          {value.productIds === null ? "Todos os produtos" : `${ids.length} produto(s) selecionado(s)`}
        </summary>
        <div className="absolute right-0 z-40 mt-2 max-h-80 w-80 max-w-[85vw] space-y-3 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-xl">
          <div className="flex justify-between font-bold"><button type="button" onClick={() => onChange({ ...value, productIds: null })}>Selecionar todos</button>
            <button type="button" onClick={() => onChange({ ...value, productIds: [] })}>Limpar seleção</button></div>
          {products.map((product) => <label key={product.id} className="flex items-start gap-3 leading-5">
            <input className="mt-1" type="checkbox" checked={ids.includes(product.id)} onChange={(event) => onChange({ ...value,
              productIds: event.target.checked ? [...ids, product.id] : ids.filter((id) => id !== product.id),
            })} />{product.name}
          </label>)}
          {!products.length && <p>Nenhum produto associado ao projeto.</p>}
        </div>
      </details>
    </div>
    {custom && <div className="flex flex-wrap items-end gap-3 text-xs">
      <label>De<input className="field mt-1" type="date" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
      <label>Até<input className="field mt-1" type="date" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
      <button type="button" className="rounded-xl bg-[var(--ink)] px-4 py-3 font-bold text-white disabled:opacity-40"
        disabled={!validAnalysisPeriod(draft.start, draft.end)} onClick={() => onChange({ ...value, ...draft })}>Aplicar período</button>
      {!validAnalysisPeriod(draft.start, draft.end) && <p>Escolha datas válidas, em ordem, com até 366 dias.</p>}
    </div>}
    <p className="text-[10px] text-[var(--muted)]">{value.start.split("-").reverse().join("/")} a {value.end.split("-").reverse().join("/")} · Inclui os dois dias · A seleção é mantida ao trocar entre Resumo, Vendas, Origens, Contatos, Recuperação, Resultados e Métricas.</p>
  </section>;
}

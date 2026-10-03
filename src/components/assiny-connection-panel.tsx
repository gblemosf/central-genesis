"use client";

import { Copy, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

interface Receipt { id: string; state: string; received_at: string; event_name?: string; review_reason?: string }
const states: Record<string, string> = { processed: "Processado", test: "Teste · fora dos resultados", ignored: "Evento sem efeito nas vendas",
  unmapped: "Vincule o produto ao projeto", failed: "Revisão necessária", awaiting_contract: "Aguardando validação do formato" };

export function AssinyConnectionPanel({ connectionId, demoMode }: { connectionId: string; demoMode: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [contractReady, setContractReady] = useState<boolean | null>(null);
  async function requestData(query = "") {
    const response = await fetch(`/api/connections/${connectionId}/assiny${query}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar a Assiny.");
    return data;
  }
  async function act(operation: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await operation(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir a consulta."); }
    finally { setBusy(false); }
  }
  async function copyEndpoint() {
    await act(async () => {
      if (demoMode) { setMessage("A demonstração não gera endereços reais."); return; }
      const data = await requestData("?endpoint=true");
      await navigator.clipboard.writeText(data.endpointUrl);
      setMessage("Endereço protegido copiado. Cadastre-o no webhook da Assiny para enviar os eventos à Central.");
    });
  }
  async function loadEvents() {
    await act(async () => {
      if (demoMode) { setReceipts([]); setMessage("Nenhum evento real na demonstração."); return; }
      const data = await requestData();
      setReceipts(data.receipts);
      setContractReady(data.contractReady === true);
      setMessage(data.contractReady ? "Formato validado. Confira abaixo quais eventos foram processados ou precisam de revisão."
        : "O formato da Assiny ainda precisa ser validado para alimentar os painéis.");
    });
  }
  async function processPending() {
    await act(async () => {
      const response = await fetch(`/api/connections/${connectionId}/assiny`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível processar as pendências.");
      const data = await requestData(); setReceipts(data.receipts);
      setMessage(`${result.processed} processados, ${result.tests} testes, ${result.ignored} sem efeito nas vendas e ${result.pending} pendentes.${result.batchFull ? " Há mais eventos; processe o próximo lote." : ""}`);
    });
  }
  async function downloadReceipt(receipt: Receipt) {
    await act(async () => {
      const data = await requestData(`?receipt=${encodeURIComponent(receipt.id)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.receipt, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `assiny-evento-${receipt.id}.json`; anchor.click(); URL.revokeObjectURL(url);
    });
  }
  return <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
    <p className="text-xs font-bold">Assiny · Recebimento de eventos</p>
    <p className="text-[11px] leading-5 text-[var(--muted)]">O webhook recebe vendas, tentativas, reembolsos e origens. Vincule cada produto ao projeto para que seus eventos alimentem os painéis.</p>
    {contractReady === false && <p className="rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-950">Aguardando validação do formato. Os eventos ficam para conferência e ainda não alteram os resultados do projeto.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={copyEndpoint} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40"><Copy size={13} /> Copiar endereço Assiny</button>
      <button type="button" disabled={busy} onClick={loadEvents} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} Conferir eventos</button>
      {contractReady && <button type="button" disabled={busy || demoMode} onClick={processPending} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40">Processar pendências</button>}
    </div>
    {message && <p role="status" className="text-[11px] leading-5 text-[var(--muted)]">{message}</p>}
    {receipts && <div className="space-y-2">
      {receipts.length === 0 && <p className="text-[11px] text-[var(--muted)]">Nenhum evento recebido.</p>}
      {receipts.map(receipt => <div key={receipt.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/5 p-3">
        <div className="min-w-0"><p className="text-[11px] font-bold">{states[receipt.state] ?? "Revisão necessária"}</p><p className="text-[10px] text-[var(--muted)]">{receipt.event_name ? `${receipt.event_name} · ` : ""}{new Date(receipt.received_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>
        <button type="button" disabled={busy} onClick={() => downloadReceipt(receipt)} aria-label={`Baixar evento Assiny ${receipt.id}`} className="shrink-0 rounded-lg p-2 hover:bg-black/10 disabled:opacity-40"><Download size={14} /></button>
      </div>)}
      {receipts.length === 30 && <p className="text-[10px] text-[var(--muted)]">Mostrando os 30 eventos mais recentes.</p>}
    </div>}
  </div>;
}

"use client";

import { Copy, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

interface Receipt { id: string; event_name: string; state: string; received_at: string; review_reason: string | null; }
const states: Record<string, string> = { awaiting_contract: "Aguardando validação", processed: "Processado", unmapped: "Vincule o produto", failed: "Revisar processamento", test: "Teste recebido" };

export function PaytConnectionPanel({ connectionId, demoMode }: { connectionId: string; demoMode: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [contractReady, setContractReady] = useState(false);
  async function requestData(query = "") {
    const response = await fetch(`/api/connections/${connectionId}/payt${query}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar a Payt.");
    return data;
  }
  async function copyEndpoint() {
    setBusy(true); setMessage("");
    try {
      if (demoMode) { setMessage("A demonstração não gera um endereço para receber vendas reais."); return; }
      const data = await requestData("?endpoint=true");
      await navigator.clipboard.writeText(data.endpointUrl);
      setMessage("Endereço protegido copiado. Cole no postback PayT V1 da Payt.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível copiar o endereço."); }
    finally { setBusy(false); }
  }
  async function loadEvents() {
    setBusy(true); setMessage("");
    try {
      if (demoMode) { setReceipts([]); setMessage("Nenhum evento real na demonstração."); return; }
      const data = await requestData();
      setReceipts(data.receipts);
      setContractReady(data.contractReady);
      setMessage(!data.received ? "Aguardando o primeiro teste da Payt."
        : !data.contractReady ? "Recebimento confirmado. Os campos de vendas e valores aguardam validação com o evento recebido."
        : "Eventos atualizados. Produtos sem vínculo aguardam associação ao projeto.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível consultar os eventos."); }
    finally { setBusy(false); }
  }
  async function processPending() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/connections/${connectionId}/payt`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível processar as pendências.");
      const events = await requestData(); setReceipts(events.receipts);
      setMessage(`${data.processed} evento(s) processado(s); ${data.pending} ainda aguardam revisão ou vínculo de produto.${data.batchFull ? " Há mais eventos para consultar em um próximo lote." : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao processar as pendências."); }
    finally { setBusy(false); }
  }
  async function downloadReceipt(receipt: Receipt) {
    setBusy(true); setMessage("");
    try {
      const data = await requestData(`?receipt=${encodeURIComponent(receipt.id)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.receipt, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `payt-evento-${receipt.id}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível baixar o evento."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
    <p className="text-xs font-bold">Recebimento Payt</p>
    <p className="text-[11px] leading-5 text-[var(--muted)]">Na Payt, cadastre um postback PayT V1 com os produtos e eventos desejados. Cole o endereço protegido e use “Testar URL”.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={copyEndpoint} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40"><Copy size={13} /> Copiar endereço Payt</button>
      <button type="button" disabled={busy} onClick={loadEvents} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} Conferir eventos</button>
      {contractReady && <button type="button" disabled={busy} onClick={processPending} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] font-bold disabled:opacity-40">Processar pendências</button>}
    </div>
    {message && <p role="status" className="text-[11px] leading-5 text-[var(--muted)]">{message}</p>}
    {receipts && <div className="space-y-2">
      {receipts.length === 0 && <p className="text-[11px] text-[var(--muted)]">Nenhum evento recebido.</p>}
      {receipts.map(receipt => <div key={receipt.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/5 p-3">
        <div className="min-w-0"><p className="truncate text-[11px] font-bold" title={receipt.event_name}>{receipt.event_name}</p><p className="text-[10px] text-[var(--muted)]">{states[receipt.state] ?? "Revisar evento"} · {new Date(receipt.received_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>
        <button type="button" disabled={busy} onClick={() => downloadReceipt(receipt)} aria-label={`Baixar evento ${receipt.event_name}`} className="shrink-0 rounded-lg p-2 hover:bg-black/10 disabled:opacity-40"><Download size={14} /></button>
      </div>)}
      {receipts.length === 30 && <p className="text-[10px] text-[var(--muted)]">Mostrando os 30 eventos mais recentes.</p>}
    </div>}
  </div>;
}

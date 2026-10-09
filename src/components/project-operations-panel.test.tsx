// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saleFromRecord } from "@/lib/project-operations";
import { ProjectOperationsPanel } from "./project-operations-panel";

const sale = saleFromRecord({ id: "sale-1", external_transaction_id: "invoice-1", event_at: "2026-10-05T12:00:00Z", gross_amount: 47, currency: "BRL",
  integration_connections: { provider: "hubla" }, payload: { product_name: "Produto principal", contact: { name: "Cliente de teste" }, financial: { platform_fee: 5.18, payout: 19.66 }, attribution: { utm: { source: "instagram" } } } });
const props = { projectId: "project", view: "sales" as const, filter: { start: "2026-10-01", end: "2026-10-08", productIds: null }, products: [] };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { sales: [sale], recovery: [], contacts: [], currency: "BRL", loadedAt: "2026-10-08T12:00:00Z" } }) }));
});
afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens the full sale without losing search, and separates net revenue from payout", async () => {
  render(<ProjectOperationsPanel {...props} />);
  await screen.findByRole("button", { name: "Ver detalhes" });
  const search = screen.getByRole("textbox", { name: "Buscar registros" });
  fireEvent.change(search, { target: { value: "invoice-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
  const dialog = screen.getByRole("dialog", { name: "Detalhes da venda" });
  expect(within(dialog).getByText(/41,82/)).toBeTruthy();
  expect(within(dialog).getByText(/19,66/)).toBeTruthy();
  expect(within(dialog).getByText("instagram")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Fechar detalhes da venda" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((search as HTMLInputElement).value).toBe("invoice-1");
  expect(screen.getByRole("button", { name: "Ver detalhes" })).toBeTruthy();
});

it("keeps full details available while switching column presets", async () => {
  render(<ProjectOperationsPanel {...props} />);
  await screen.findByRole("button", { name: "Ver detalhes" });
  fireEvent.click(screen.getByText(/Colunas da tabela/));
  fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
  expect(screen.getByRole("columnheader", { name: "Recebido pelo produtor" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  expect(screen.queryByRole("columnheader", { name: "Recebido pelo produtor" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "utm_campaign" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
  expect(within(screen.getByRole("dialog")).getByText(/19,66/)).toBeTruthy();
});

it("shows a partial payout and identifies the exact records that need attention", async () => {
  const gap={...sale,id:'gap',transaction:'invoice-gap',provider:'assiny',payout:null,
    payoutIssue:'Há comissões informadas; falta identificar o beneficiário do repasse.'};
  vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({data:{sales:[sale,gap],contacts:[],recovery:[],currency:'BRL'}})} as Response);
  render(<ProjectOperationsPanel {...props} view="results" />);
  const label=await screen.findByText('Repasse informado — parcial');
  expect(within(label.parentElement!).getByText(/19,66/)).toBeTruthy();
  fireEvent.click(screen.getByText(/1 registro\(s\) com repasse pendente/));
  expect(screen.getByText(/falta identificar o beneficiário/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Conferir esta venda'}));
  expect(within(screen.getByRole('dialog')).getByText('invoice-gap')).toBeTruthy();
});

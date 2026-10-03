// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssinyConnectionPanel } from "./assiny-connection-panel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("labels preconfiguration without financial processing controls", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<AssinyConnectionPanel connectionId="demo" demoMode />);
  expect(screen.getByText("Assiny · Recebimento de eventos")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Processar/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copiar endereço Assiny" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("não gera endereços reais"));
  expect(fetchMock).not.toHaveBeenCalled();
});
it("shows actual processing states and only enables reprocessing after contract validation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok:true, json:async()=>({contractReady:true,receipts:[
    {id:'paid',state:'processed',received_at:'2026-10-03T12:00:00Z'},
    {id:'pending',state:'unmapped',received_at:'2026-10-03T12:00:00Z'},
    {id:'test',state:'test',received_at:'2026-10-03T12:00:00Z'}]}) }));
  render(<AssinyConnectionPanel connectionId="example" demoMode={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Conferir eventos'}));
  await waitFor(()=>expect(screen.getByText('Processado')).toBeTruthy());
  expect(screen.getByText('Vincule o produto ao projeto')).toBeTruthy();
  expect(screen.getByText('Teste · fora dos resultados')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Processar pendências'})).toBeTruthy();
});
it("shows received events as awaiting format validation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ receipts: [{ id: "receipt", state: "awaiting_contract", received_at: "2026-10-02T12:00:00Z" }] }) }));
  render(<AssinyConnectionPanel connectionId="example" demoMode={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Conferir eventos" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("ainda precisa ser validado"));
  expect(screen.getByRole("button", { name: "Baixar evento Assiny receipt" })).toBeTruthy();
});

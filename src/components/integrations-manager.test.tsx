// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationConnection } from "@/lib/domain";
import { IntegrationsManager } from "./integrations-manager";

const source: IntegrationConnection = { id: "source-test", name: "Hotmart histórico", provider: "hotmart",
  status: "revoked", productCount: 46, accountCount: 0, lastVerifiedAt: null };
const props = { demoMode: false, googleOAuthConfigured: false };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset(); });

describe("connection list lifecycle", () => {
  it("takes a revoked source out of the main list and restores it without deleting data", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { archivedAt: "2026-10-06T15:00:00Z" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { archivedAt: null } }) });
    render(<IntegrationsManager {...props} initialConnections={[source]} />);
    fireEvent.click(screen.getByRole("button", { name: "Arquivar conexão" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: source.name })).toBeNull());
    expect(fetchMock.mock.calls[0]).toEqual([`/api/connections/${source.id}/archive`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }),
    }]);
    expect(screen.getByRole("status").textContent).toContain("histórico foram preservados");
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar conexões arquivadas/ }));
    const card = within(screen.getByRole("heading", { name: source.name }).closest("article")!);
    expect(card.getByText("Arquivada")).toBeTruthy();
    expect(card.getByRole("button", { name: "Editar" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(card.getByRole("button", { name: "Restaurar na lista" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Mostrar conexões arquivadas/ })).toBeNull());
    expect(screen.getByRole("heading", { name: source.name })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("credencial continua revogada");
  });

  it("retains the card and displays the current-project blocker returned by the server", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Remova os vínculos do projeto ativo." }) });
    render(<IntegrationsManager {...props} initialConnections={[source]} />);
    fireEvent.click(screen.getByRole("button", { name: "Arquivar conexão" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("projeto ativo"));
    expect(screen.getByRole("heading", { name: source.name })).toBeTruthy();
  });

  it("keeps archived sources hidden after a reload but exposes a source whose credential was reconnected", () => {
    render(<IntegrationsManager {...props} initialConnections={[
      { ...source, archivedAt: "2026-10-06T15:00:00Z" },
      { ...source, id: "reconnected", name: "Fonte reconectada", status: "connected", archivedAt: "2026-10-06T15:00:00Z" },
    ]} />);
    expect(screen.queryByRole("heading", { name: source.name })).toBeNull();
    expect(screen.getByRole("heading", { name: "Fonte reconectada" })).toBeTruthy();
  });
});

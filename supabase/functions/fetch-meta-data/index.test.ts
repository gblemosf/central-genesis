import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("jsr:@supabase/functions-js/edge-runtime.d.ts", () => ({}));

let handler: (request: Request) => Promise<Response>;
const rpc = vi.fn();
const fetchMock = vi.fn();
const accounts = ["a", "b"].map((id) => ({
  id,
  organization_id: "org",
  connection_id: `connection-${id}`,
  external_id: `act_${id}`,
  currency: "BRL",
  timezone: "America/Sao_Paulo",
  is_active: true,
}));

beforeEach(async () => {
  vi.resetModules();
  const fixtures: Record<string, unknown[]> = {
    project_accounts: accounts.map((account) => ({
      organization_id: "org", project_id: "project", provider_account_id: account.id,
    })),
    projects: [{
      id: "project", organization_id: "org", currency: "BRL",
      reporting_timezone: "America/Sao_Paulo", deleted_at: null,
    }],
    provider_accounts: accounts,
  };
  createClient.mockReturnValue({
    from: (table: string) => {
      const query = {
        select: () => query,
        in: () => query,
        is: () => query,
        eq: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: fixtures[table], error: null }).then(resolve),
      };
      return query;
    },
    rpc,
  });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "get_connection_secret" ? "test-token" : 2, error: null,
  }));
  fetchMock.mockImplementation(async () => Response.json({ data: [{
    date_start: "2026-09-06", spend: "10", impressions: "100", clicks: "5",
  }] }));
  vi.stubGlobal("fetch", fetchMock);
  const environment: Record<string, string> = {
    META_SYNC_CRON_SECRET: "test-cron-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  };
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => environment[key] },
    serve: (callback: typeof handler) => { handler = callback; },
  });
  await import("./index");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function sync(secret = "test-cron-secret") {
  return handler(new Request("https://example.test/sync", {
    method: "POST", headers: { "x-cron-secret": secret },
  }));
}

function expectNoReplacement() {
  expect(rpc.mock.calls.filter(([name]) => name === "replace_meta_metrics")).toHaveLength(0);
}

describe("automatic Meta sync", () => {
  it("nao consulta dados sem o segredo do agendamento", async () => {
    expect((await sync("wrong-secret")).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([null, "", '{"accessToken":""}'])(
    "preserva o historico inteiro se uma conta nao tiver token valido: %s", async (credential) => {
      rpc.mockImplementation(async (name: string, args: { p_connection_id?: string }) => ({
        data: name === "get_connection_secret"
          ? args.p_connection_id === "connection-b" ? credential : "test-token"
          : 2,
        error: null,
      }));

      expect((await sync()).status).toBe(503);
      expectNoReplacement();
    },
  );

  it("preserva o historico quando a leitura do cofre falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Vault unavailable" } });
    expect((await sync()).status).toBe(503);
    expectNoReplacement();
  });

  it("grava as duas contas somente depois de concluir todas as consultas", async () => {
    expect((await sync()).status).toBe(200);
    const replacement = rpc.mock.calls.find(([name]) => name === "replace_meta_metrics");
    expect(replacement?.[1]).toMatchObject({ p_provider_account_ids: ["a", "b"] });
    expect(replacement?.[1].p_rows).toHaveLength(2);
  });

  it("preserva os dados quando a Meta retorna um corpo inesperado", async () => {
    fetchMock.mockResolvedValue(Response.json({ unexpected: true }));
    expect((await sync()).status).toBe(502);
    expectNoReplacement();
  });

  it("nao envia o token para um dominio de paginacao diferente", async () => {
    fetchMock.mockImplementation(async () => Response.json({
      data: [], paging: { next: "https://unexpected.example/page" },
    }));
    expect((await sync()).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoReplacement();
  });

  it("interrompe paginacao circular sem substituir dados", async () => {
    fetchMock.mockImplementation(async () => Response.json({
      data: [], paging: { next: "https://graph.facebook.com/repeated-page" },
    }));
    expect((await sync()).status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(100);
    expectNoReplacement();
  });

  it("retorna falha controlada quando a consulta expira", async () => {
    fetchMock.mockRejectedValue(new Error("Timeout"));
    expect((await sync()).status).toBe(502);
    expectNoReplacement();
  });
});

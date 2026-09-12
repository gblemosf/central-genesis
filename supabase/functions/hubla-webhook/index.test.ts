import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("jsr:@supabase/functions-js/edge-runtime.d.ts", () => ({}));

let handler: (request: Request) => Promise<Response>;
const rpc = vi.fn();
const connectionId = "00000000-0000-4000-8000-000000000010";

beforeEach(async () => {
  vi.resetModules();
  createClient.mockReturnValue({ rpc });
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({
    data: name === "resolve_hubla_webhook_connection"
      ? args.p_token === "hubla-token-test" ? connectionId : null
      : [{ duplicate: false, mapped: true, normalized: false }],
    error: null,
  }));
  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) => ({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
      })[key],
    },
    serve: (callback: typeof handler) => {
      handler = callback;
    },
  });
  await import("./index");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function abandonedCheckoutRequest(
  token = "hubla-token-test",
  url = "https://example.supabase.co/functions/v1/hubla-webhook",
) {
  return new Request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hubla-token": token,
        "x-hubla-idempotency": "delivery-test",
        "x-hubla-sandbox": "false",
      },
      body: JSON.stringify({
        type: "lead.abandoned_checkout",
        version: "2.0.0",
        event: {
          products: [{
            id: "product-test",
            name: "Produto de teste",
            offers: [{ id: "offer-test", name: "Oferta de teste" }],
          }],
          lead: {
            id: "lead-test",
            fullName: "Pessoa de teste",
            email: "pessoa@example.invalid",
            phone: "+5511999999999",
            currency: "BRL",
            amount: { totalCents: 36_864 },
            createdAt: "2026-09-11T02:41:21.188Z",
            session: {
              url: "https://pay.hub.la/offer-test?utm_source=meta",
              utm: { source: "meta", campaign: "campanha-teste" },
            },
          },
        },
      }),
    },
  );
}

describe("Hubla webhook endpoint", () => {
  it("resolve a conexao pelo token no endpoint geral e encaminha o evento", async () => {
    const response = await handler(abandonedCheckoutRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      mapped: true,
      normalized: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_hubla_webhook_connection",
      { p_token: "hubla-token-test" },
    );
    expect(rpc).toHaveBeenCalledWith(
      "ingest_hubla_webhook",
      expect.objectContaining({
        p_event_type: "lead.abandoned_checkout",
        p_entity_id: "lead-test",
        p_product_external_id: "product-test",
        p_gross_amount: 368.64,
        p_currency: "BRL",
        p_payload: expect.objectContaining({
          contact: expect.objectContaining({ email: "pessoa@example.invalid" }),
          attribution: expect.objectContaining({
            utm: expect.objectContaining({ campaign: "campanha-teste" }),
          }),
        }),
      }),
    );
  });

  it("recusa token incorreto antes de processar o corpo", async () => {
    const response = await handler(abandonedCheckoutRequest("token-incorreto"));

    expect(response.status).toBe(401);
    expect(rpc.mock.calls.filter(([name]) => name === "ingest_hubla_webhook"))
      .toHaveLength(0);
  });

  it("mantem o endpoint antigo por conexao durante a transicao", async () => {
    const response = await handler(abandonedCheckoutRequest(
      "hubla-token-test",
      `https://example.supabase.co/functions/v1/hubla-webhook/${connectionId}`,
    ));

    expect(response.status).toBe(202);
  });

  it("aceita um novo tipo da Hubla para auditoria sem executar regra desconhecida", async () => {
    const response = await handler(new Request(
      "https://example.supabase.co/functions/v1/hubla-webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hubla-token": "hubla-token-test",
          "x-hubla-idempotency": "delivery-new-event",
        },
        body: JSON.stringify({
          type: "customer.profile_updated",
          version: "2.0.0",
          event: {
            user: {
              id: "user-test",
              updatedAt: "2026-09-11T05:00:00.000Z",
              email: "pessoa@example.invalid",
            },
          },
        }),
      },
    ));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      recognized: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "ingest_hubla_webhook",
      expect.objectContaining({
        p_event_type: "customer.profile_updated",
        p_payload: expect.objectContaining({ known_event: false }),
      }),
    );
  });
});

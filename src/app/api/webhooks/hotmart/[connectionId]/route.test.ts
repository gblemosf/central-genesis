import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  readConnectionSecret: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "00000000-0000-4000-8000-000000000010",
              provider: "hotmart",
              revoked_at: null,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}));

vi.mock("@/lib/secret-store", () => ({
  readConnectionSecret: mocks.readConnectionSecret,
}));

vi.mock("@/lib/provider-credentials", () => ({
  decodeProviderCredentials: () => ({ hottok: "hottok-de-teste" }),
}));

import { POST } from "@/app/api/webhooks/hotmart/[connectionId]/route";

const connectionId = "00000000-0000-4000-8000-000000000010";

function purchaseCompleteRequest(hottok = "hottok-de-teste") {
  return new Request(`https://example.test/api/webhooks/hotmart/${connectionId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hotmart-hottok": hottok,
    },
    body: JSON.stringify({
      id: "evento-teste",
      creation_date: 1_788_674_309_438,
      event: "PURCHASE_COMPLETE",
      version: "2.0.0",
      data: {
        product: { id: 1_234_567, name: "Produto de teste" },
        commissions: [
          { currency_value: "BRL", source: "PRODUCER", value: 70 },
        ],
        purchase: {
          approved_date: 1_788_674_299_000,
          transaction: "transacao-teste",
          status: "COMPLETED",
          price: { currency_value: "BRL", value: 100 },
          origin: { sck: "meta-ads|campanha", xcod: "pagina-teste" },
        },
        buyer: { email: "pessoa@example.invalid" },
      },
    }),
  });
}

describe("Hotmart webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConnectionSecret.mockResolvedValue("segredo-armazenado");
    mocks.rpc.mockResolvedValue({
      data: [{ duplicate: false, mapped: true }],
      error: null,
    });
  });

  it("recebe o formato real de compra completa e envia a atribuicao ao banco", async () => {
    const response = await POST(purchaseCompleteRequest(), {
      params: Promise.resolve({ connectionId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
      quarantined: 0,
      ignored: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "ingest_hotmart_sale",
      expect.objectContaining({
        p_event_type: "PURCHASE_COMPLETED",
        p_gross_amount: 100,
        p_net_amount: 70,
        p_currency: "BRL",
        p_payload: expect.objectContaining({
          attribution: expect.objectContaining({
            sck: "meta-ads|campanha",
            xcod: "pagina-teste",
          }),
        }),
      }),
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).toContain("pessoa@example.invalid");
  });

  it("recusa uma assinatura HOTTOK incorreta antes de gravar", async () => {
    const response = await POST(purchaseCompleteRequest("hottok-incorreto"), {
      params: Promise.resolve({ connectionId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

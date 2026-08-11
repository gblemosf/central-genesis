import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderProducts } from "@/lib/provider-verification";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider catalog adapters", () => {
  it("authenticates and normalizes the Kiwify catalog", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "temporary-token" }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: "kiwify-1", name: "Produto Kiwify", price: 49.9, currency: "brl", status: "active" }],
        pagination: { count: 1 },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listProviderProducts("kiwify", JSON.stringify({
      version: 1,
      provider: "kiwify",
      clientId: "client-id",
      clientSecret: "client-secret",
      accountId: "account-id",
    }));

    expect(result).toEqual({
      complete: true,
      products: [expect.objectContaining({
        externalId: "kiwify-1",
        name: "Produto Kiwify",
        price: 49.9,
        currency: "BRL",
        active: true,
      })],
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "x-kiwify-account-id": "account-id" }),
    });
  });

  it("normalizes the paginated Eduzz catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      items: [{
        id: 123,
        name: "Produto Eduzz",
        status: "active",
        payment: { price: { value: 79, currency: "brl" }, type: "one_time" },
      }],
      pages: 1,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listProviderProducts("eduzz", JSON.stringify({
      version: 1,
      provider: "eduzz",
      accessToken: "access-token",
    }));

    expect(result).toEqual({
      complete: true,
      products: [expect.objectContaining({
        externalId: "123",
        name: "Produto Eduzz",
        price: 79,
        currency: "BRL",
        active: true,
      })],
    });
  });
});

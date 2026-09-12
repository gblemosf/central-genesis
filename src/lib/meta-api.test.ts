import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMetaCollection } from "@/lib/meta-api";

afterEach(() => vi.unstubAllGlobals());

describe("Meta collection", () => {
  it("rejeita uma resposta sem dados para nao apagar o periodo sincronizado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: true })));
    await expect(fetchMetaCollection(new URL("https://graph.facebook.com/insights"), "test-token", "Falha Meta"))
      .rejects.toMatchObject({ status: 502 });
  });

  it("aceita uma resposta vazia explicita", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [] })));
    await expect(fetchMetaCollection(new URL("https://graph.facebook.com/insights"), "test-token", "Falha Meta"))
      .resolves.toEqual([]);
  });

  it("preserva todas as paginas retornadas", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 1 }], paging: { next: "https://graph.facebook.com/page2" } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 2 }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMetaCollection(new URL("https://graph.facebook.com/insights"), "test-token", "Falha Meta"))
      .resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });
});

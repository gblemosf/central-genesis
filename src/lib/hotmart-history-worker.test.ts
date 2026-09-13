import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  token: vi.fn(),
  secret: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.secret }));
vi.mock("@/lib/provider-verification", () => ({
  hotmartAccessToken: mocks.token,
}));
vi.mock("@/lib/hotmart-sales-http", () => ({
  requestHotmartSales: mocks.fetch,
}));
import { processHotmartHistoryJob } from "./hotmart-history-worker";
import { POST } from "@/app/api/jobs/hotmart-history/route";
const job = {
  id: "job",
  lease_id: "lease",
  connection_id: "connection",
  product_id: "product",
  attempts: 0,
  cursor: { statusIndex: 0, windowStart: Date.parse("2026-09-01T03:00:00Z") },
  end_at: "2026-09-13T02:59:59.999Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.secret.mockResolvedValue(
    JSON.stringify({
      version: 1,
      provider: "hotmart",
      clientId: "test",
      clientSecret: "test",
      basicToken: "test",
      hottok: "test",
    }),
  );
  mocks.token.mockResolvedValue("test-access-token");
  const updateChain = { eq: vi.fn() };
  updateChain.eq.mockReturnValue(updateChain);
  Object.assign(updateChain, {
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  });
  mocks.update.mockReturnValue(updateChain);
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: {
            external_id: "8304193",
            integration_connections: { provider: "hotmart", revoked_at: null },
          },
          error: null,
        }),
      }),
    }),
    update: mocks.update,
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Hotmart background history worker", () => {
  it("does no external work when there is no queued import", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await processHotmartHistoryJob()).toEqual({
      processed: 0,
      idle: true,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("advances an empty status without declaring the whole period complete", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    mocks.fetch.mockResolvedValue(
      Response.json({ items: [], page_info: { total_results: 0 } }),
    );
    expect(await processHotmartHistoryJob()).toEqual({
      processed: 0,
      complete: false,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "apply_hotmart_history_page",
      expect.objectContaining({
        p_rows: [],
        p_next_cursor: expect.objectContaining({ statusIndex: 1 }),
      }),
    );
  });
  it("retries a rate limit without advancing or exposing the provider response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [job], error: null });
    mocks.fetch.mockResolvedValue(
      Response.json(
        { private: "buyer and token must not appear" },
        { status: 429 },
      ),
    );
    expect(await processHotmartHistoryJob()).toEqual({
      processed: 0,
      failed: false,
      retrying: true,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        attempts: 1,
        lease_id: null,
      }),
    );
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(
      "buyer and token",
    );
  });
  it("stops denied API access with a visible connection error", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [job], error: null });
    mocks.fetch.mockResolvedValue(Response.json({}, { status: 403 }));
    expect(await processHotmartHistoryJob()).toMatchObject({
      failed: true,
      retrying: false,
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("records a useful HTTP failure without logging the provider's private description", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.rpc.mockResolvedValueOnce({ data: [job], error: null });
      mocks.fetch.mockResolvedValue(
        Response.json(
          {
            error: "invalid_parameter",
            error_description: "private buyer and token details",
          },
          { status: 400 },
        ),
      );
      expect(await processHotmartHistoryJob()).toMatchObject({
        retrying: true,
      });
      expect(warn).toHaveBeenCalledWith(
        "Hotmart history request failed",
        expect.objectContaining({
          status: 400,
          errorCode: "invalid_parameter",
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private buyer");
      expect(JSON.stringify(mocks.update.mock.calls)).toContain("HTTP 400");
    } finally {
      warn.mockRestore();
    }
  });
  it("authenticates scheduled calls independently of browser login", async () => {
    expect(
      (
        await POST(
          new Request("https://example.invalid/api/jobs/hotmart-history", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: "expected-token", error: null });
    expect(
      (
        await POST(
          new Request("https://example.invalid/api/jobs/hotmart-history", {
            method: "POST",
            headers: { Authorization: "Bearer wrong" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), readSecret: vi.fn(), connection: null as unknown, receipt: null as unknown }));
vi.mock("@/lib/api-auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.readSecret }));
vi.mock("@/lib/supabase/env", () => ({ getSupabasePublicEnv: () => ({ url: "https://example.supabase.co" }) }));
import { ApiError } from "@/lib/api-auth";
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000090";
const route = { params: Promise.resolve({ connectionId: id }) };
const request = (query = "") => new Request(`https://example.invalid/api/connections/${id}/assiny${query}`);
const eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection = { id, provider: "assiny", revoked_at: null };
  mocks.receipt = { id, state: "awaiting_contract", payload: { arbitrary: "sample" } };
  mocks.readSecret.mockResolvedValue(JSON.stringify({ version: 1, provider: "assiny", webhookToken: "a".repeat(64) }));
  const builder = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), maybeSingle: async () => ({ data: mocks.connection, error: null }),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
  mocks.requireAdmin.mockResolvedValue({ organizationId: "organization-test", supabase: { from: (table: string) => table === "integration_connections" ? builder
    : { ...builder, maybeSingle: async () => ({ data: mocks.receipt, error: null }) } } });
});
describe("Assiny preparation admin controls", () => {
  it("returns a secret endpoint only after tenant scoping and with no caching", async () => {
    const response = await GET(request("?endpoint=true"), route);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(eq).toHaveBeenCalledWith("organization_id", "organization-test");
    expect((await response.json()).endpointUrl).toContain(`/assiny-webhook/${id}?token=`);
  });
  it("keeps receipt reads scoped and independent of credentials", async () => {
    const response = await GET(request(), route);
    expect(await response.json()).toMatchObject({ contractReady: false, processed: false });
    await GET(request(`?receipt=${id}`), route);
    expect(eq).toHaveBeenCalledWith("connection_id", id);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it("rejects other gateways, missing and revoked connections before reading secrets", async () => {
    for (const connection of [null, { provider: "payt" }, { provider: "assiny", revoked_at: "2026-10-01" }]) {
      mocks.connection = connection; expect((await GET(request("?endpoint=true"), route)).status).toBe(404);
    }
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it("requires an administrator", async () => {
    mocks.requireAdmin.mockRejectedValue(new ApiError("Permissão administrativa necessária.", 403));
    expect((await GET(request("?endpoint=true"), route)).status).toBe(403);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
});

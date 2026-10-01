import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), readSecret: vi.fn(), connection: null as unknown,
  receipt: null as unknown, adminRpc: vi.fn() }));
vi.mock("@/lib/api-auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.readSecret }));
vi.mock("@/lib/supabase/env", () => ({ getSupabasePublicEnv: () => ({ url: "https://example.supabase.co" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.adminRpc }) }));
import { ApiError } from "@/lib/api-auth";
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000010";
const route = { params: Promise.resolve({ connectionId: id }) };
function request(query = "") { return new Request(`https://example.invalid/api/connections/${id}/payt${query}`); }
const eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection = { id, provider: "payt", revoked_at: null, metadata: {} };
  mocks.receipt = { id, state: "awaiting_contract", payload: { event: "sample" } };
  mocks.readSecret.mockResolvedValue(JSON.stringify({ version: 1, provider: "payt", webhookToken: "a".repeat(64) }));
  const builder = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), maybeSingle: async () => ({ data: mocks.connection, error: null }),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }), in: vi.fn().mockReturnThis() };
  mocks.requireAdmin.mockResolvedValue({ organizationId: "organization-test", supabase: { from: (table: string) => table === "integration_connections" ? builder
    : { ...builder, maybeSingle: async () => ({ data: mocks.receipt, error: null }) } } });
});
describe("Payt administrative connection controls", () => {
  it("returns a no-store endpoint only after organization scoping", async () => {
    const response = await GET(request("?endpoint=true"), route);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(eq).toHaveBeenCalledWith("organization_id", "organization-test");
    const data = await response.json(); expect(data.endpointUrl).toContain(`/payt-webhook/${id}?token=`);
  });
  it("does not read any credential for normal receipt inspection", async () => {
    expect((await GET(request(), route)).status).toBe(200);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it("prevents another organization or a revoked connection from retrieving a token", async () => {
    mocks.connection = null; expect((await GET(request("?endpoint=true"), route)).status).toBe(404);
    mocks.connection = { provider: "payt", revoked_at: "2026-10-01T00:00:00Z" };
    expect((await GET(request("?endpoint=true"), route)).status).toBe(404);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it("requires an administrator for every operation", async () => {
    mocks.requireAdmin.mockRejectedValue(new ApiError("Permissão administrativa necessária.", 403));
    expect((await GET(request("?endpoint=true"), route)).status).toBe(403);
    expect((await POST(request(), route)).status).toBe(403);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it("cannot process unknown monetary contracts", async () => {
    expect((await POST(request(), route)).status).toBe(422);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

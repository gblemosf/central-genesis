import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), readSecret: vi.fn(), admin:vi.fn(), rpc:vi.fn(), connection: null as unknown, receipt: null as unknown, receipts:[] as unknown[] }));
vi.mock("@/lib/api-auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.readSecret }));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:mocks.admin}));
vi.mock("@/lib/supabase/env", () => ({ getSupabasePublicEnv: () => ({ url: "https://example.supabase.co" }) }));
import { ApiError } from "@/lib/api-auth";
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000090";
const route = { params: Promise.resolve({ connectionId: id }) };
const request = (query = "") => new Request(`https://example.invalid/api/connections/${id}/assiny${query}`);
const eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection = { id, provider: "assiny", revoked_at: null };
  mocks.receipt = { id, state: "awaiting_contract", payload: { arbitrary: "sample" } };
  mocks.receipts=[]; mocks.admin.mockReturnValue({rpc:mocks.rpc}); mocks.rpc.mockResolvedValue({data:{state:'failed'},error:null});
  mocks.readSecret.mockResolvedValue(JSON.stringify({ version: 1, provider: "assiny", webhookToken: "a".repeat(64) }));
  const builder = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), maybeSingle: async () => ({ data: mocks.connection, error: null }),
    in:vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockImplementation(async()=>({ data: mocks.receipts, error: null })) };
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
    expect(await response.json()).toMatchObject({ contractReady: false });
    await GET(request(`?receipt=${id}`), route);
    expect(eq).toHaveBeenCalledWith("connection_id", id);
    expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it('rejects reprocessing outside the organization, without a validated contract or without admin rights',async()=>{
    mocks.connection=null;
    expect((await POST(request(),route)).status).toBe(404);
    mocks.connection={provider:'assiny',metadata:{}};
    expect((await POST(request(),route)).status).toBe(422);
    mocks.requireAdmin.mockRejectedValue(new ApiError('Permissão administrativa necessária.',403));
    expect((await POST(request(),route)).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.readSecret).not.toHaveBeenCalled();
  });
  it('keeps replay tenant scoped and retains the original receipt key',async()=>{
    mocks.connection={provider:'assiny',metadata:{assiny_payload_contract:{version:1,amountUnit:'cents'}}};
    mocks.receipts=[{id:'pending',idempotency_key:'original-key',payload:{event:'unknown_event'}}];
    mocks.rpc.mockResolvedValue({data:{state:'ignored'},error:null});
    const response=await POST(request(),route);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({processed:0,tests:0,ignored:1,pending:0});
    expect(eq).toHaveBeenCalledWith('organization_id','organization-test');
    expect(mocks.rpc).toHaveBeenCalledWith('receive_assiny_normalized',expect.objectContaining({p_connection_id:id,p_idempotency_key:'original-key',p_normalized:null,p_review_reason:'unsupported_event'}));
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

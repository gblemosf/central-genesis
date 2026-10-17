import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), readSecret: vi.fn(), connection: null as unknown,
  receipt: null as unknown, receipts: [] as unknown[], adminRpc: vi.fn() }));
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
  mocks.receipts=[];
  mocks.readSecret.mockResolvedValue(JSON.stringify({ version: 1, provider: "payt", webhookToken: "a".repeat(64) }));
  const builder = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), maybeSingle: async () => ({ data: mocks.connection, error: null }),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockImplementation(async()=>({ data: mocks.receipts, error: null })), in: vi.fn().mockReturnThis() };
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
  it("replays the verified native contract with the original receipt key and counts notifications separately", async () => {
    mocks.connection={id,provider:"payt",metadata:{payt_payload_contract:{version:1,schema:"payt-v1",amountUnit:"cents",currency:"BRL",timezone:"America/Sao_Paulo"}}};
    mocks.receipts=[{id:"receipt",idempotency_key:"original-key",payload:{test:false,status:"refund_requested",transaction:{payment_status:"paid"}}}];
    mocks.adminRpc.mockResolvedValue({data:{state:"ignored",receipt_id:"receipt"},error:null});
    const response=await POST(request(),route);
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({processed:0,pending:0,ignored:1});
    expect(mocks.adminRpc).toHaveBeenCalledWith("receive_payt_postback",expect.objectContaining({p_connection_id:id,p_idempotency_key:"original-key",p_normalized:null,p_review_reason:"non_financial_event"}));
    expect(eq).toHaveBeenCalledWith("organization_id","organization-test");
  });
});

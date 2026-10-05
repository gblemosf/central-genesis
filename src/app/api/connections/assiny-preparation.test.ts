import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), rpc: vi.fn(), readSecret: vi.fn(), connection: null as unknown }));
vi.mock("@/lib/api-auth", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.readSecret }));
import { POST as create } from "./route";
import { POST as verify } from "./[connectionId]/verify/route";
const id = "00000000-0000-4000-8000-000000000090";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection = { id, provider: "assiny", status: "attention", metadata: {}, revoked_at: null };
  mocks.rpc.mockResolvedValue({ data: { id, provider: "assiny", name: "Assiny preparada", status: "attention" }, error: null });
  const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: mocks.connection, error: null }) };
  const products = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: async () => ({ data: [], error: null }) };
  mocks.requireAdmin.mockResolvedValue({ organizationId: "organization-test", supabase: { rpc: mocks.rpc, from: (table: string) => table === "products" ? products : builder } });
});
it("generates a private preparation credential without needing an Assiny account", async () => {
  const response = await create(new Request("https://example.invalid/api/connections", { method: "POST", body: JSON.stringify({ name: "Assiny preparada", provider: "assiny" }) }));
  expect(response.status).toBe(201);
  const secret = JSON.parse(mocks.rpc.mock.calls[0][1].p_credential);
  expect(secret).toMatchObject({ version: 1, provider: "assiny" });
  expect(secret.webhookToken).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(await response.json())).not.toContain(secret.webhookToken);
});
it("never confirms the Assiny contract from the local credential alone", async () => {
  const response = await verify(new Request("https://example.invalid/verify", { method: "POST" }), { params: Promise.resolve({ connectionId: id }) });
  expect(await response.json()).toMatchObject({ confirmed: false, lastVerifiedAt: null, products: [] });
  expect(mocks.readSecret).not.toHaveBeenCalled();
});
it("rejects verification of revoked connections", async () => {
  mocks.connection = { provider: "assiny", revoked_at: "2026-10-02" };
  expect((await verify(new Request("https://example.invalid/verify", { method: "POST" }), { params: Promise.resolve({ connectionId: id }) })).status).toBe(404);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/api-auth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin,
}));
import { DELETE } from "./route";
const id = "00000000-0000-4000-8000-000000000010";
const rpc = vi.fn();
let counts: Record<string, number>;
beforeEach(() => {
  vi.clearAllMocks();
  counts = { products: 46, sales_events: 315, sync_runs: 1, google_forms: 0 };
  mocks.requireAdmin.mockResolvedValue({ organizationId: "org-test", supabase: {
    rpc,
    from(table: string) {
      return {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
        maybeSingle: async () => ({ data: { id, status: "revoked" }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(table === "provider_accounts" ? { data: [], error: null }
            : { count: counts[table], error: null }).then(resolve);
        },
      };
    },
  } });
});
describe("permanent connection deletion", () => {
  it("explains historical blockers and offers archiving after projects were removed", async () => {
    const response = await DELETE(new Request("https://example.invalid", { method: "DELETE" }),
      { params: Promise.resolve({ connectionId: id }) });
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toContain("46 produto(s)"); expect(error).toContain("315 evento(s)");
    expect(error).toContain("1 sincronização(ões)"); expect(error).toContain("Arquivar conexão");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("also protects linked forms before reaching the permanent-delete function", async () => {
    counts = { products: 0, sales_events: 0, sync_runs: 0, google_forms: 1 };
    const response = await DELETE(new Request("https://example.invalid", { method: "DELETE" }),
      { params: Promise.resolve({ connectionId: id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("1 formulário(s)");
    expect(rpc).not.toHaveBeenCalled();
  });
});

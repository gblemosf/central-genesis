import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collection: vi.fn(), secret: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/meta-api", () => ({ fetchMetaCollection: mocks.collection }));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.secret }));
import { syncProjectMeta } from "./meta-sync";

let accounts: { id: string; external_id: string; connection_id: string; currency: string; timezone: string }[];
const context = {
  organizationId: "org",
  supabase: {
    from(table: string) {
      const result = table === "projects"
        ? { id: "project", reporting_timezone: "America/Sao_Paulo" }
        : table === "project_accounts"
          ? [{ provider_account_id: "new" }, { provider_account_id: "previous" }]
          : accounts;
      const query = {
        select: () => query, eq: () => query, is: () => query, in: () => query,
        maybeSingle: async () => ({ data: result, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
      };
      return query;
    },
    rpc: mocks.rpc,
  },
} as unknown as Parameters<typeof syncProjectMeta>[0];
beforeEach(() => {
  vi.resetAllMocks();
  accounts = [
    { id: "new", external_id: "act_new", connection_id: "connection", currency: "BRL", timezone: "Brazil/East" },
    { id: "previous", external_id: "act_previous", connection_id: "connection", currency: "BRL", timezone: "America/Sao_Paulo" },
  ];
  mocks.secret.mockResolvedValue("private-token");
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  mocks.collection.mockImplementation(async (url: URL) => [{ date_start: "2026-10-01", spend: url.pathname.includes("act_new") ? "10.20" : "20.30" }]);
});
describe("multiple Meta accounts", () => {
  it("keeps each account's daily spend separately and replaces the complete selected period atomically", async () => {
    expect(await syncProjectMeta(context, "project", { since: "2026-10-01", until: "2026-10-01" })).toEqual({ processed: 2 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("replace_meta_metrics", expect.objectContaining({
      p_provider_account_ids: ["new", "previous"],
      p_rows: [
        expect.objectContaining({ provider_account_id: "new", investment: 10.2 }),
        expect.objectContaining({ provider_account_id: "previous", investment: 20.3 }),
      ],
    }));
  });
  it("does not erase previous account data when fetching another account fails", async () => {
    mocks.collection.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Meta unavailable"));
    await expect(syncProjectMeta(context, "project")).rejects.toThrow("Meta unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses different or unknown reporting zones before retrieving credentials", async () => {
    for (const timezone of ["America/Manaus", "Unknown/Zone"]) {
      accounts[0].timezone = timezone;
      await expect(syncProjectMeta(context, "project")).rejects.toMatchObject({ status: 422 });
    }
    expect(mocks.secret).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

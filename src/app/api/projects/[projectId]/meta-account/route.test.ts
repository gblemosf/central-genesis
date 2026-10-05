import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-auth")>()),
  requireAdmin: mocks.admin,
}));
import { ApiError } from "@/lib/api-auth";
import { PUT } from "./route";

const ids = ["74990300-5d70-408c-a8cd-72d7d742ee0a", "24172efd-75ef-4d47-afa7-c6173c631da4"];
const route = { params: Promise.resolve({ projectId: "project" }) };
const request = (body: unknown) => new Request("https://example.invalid/api/projects/project/meta-account", {
  method: "PUT", body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: mocks.project };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
  mocks.project.mockResolvedValue({ data: { id: "project" }, error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.admin.mockResolvedValue({ organizationId: "organization", supabase: { from: () => query, rpc: mocks.rpc } });
});
describe("project Meta selection", () => {
  it("saves both accounts in one call with the principal first", async () => {
    expect((await PUT(request({ providerAccountIds: ids }), route)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_project_meta_accounts", {
      p_organization_id: "organization", p_project_id: "project", p_provider_account_ids: ids,
    });
  });
  it("allows disconnecting all accounts and retains old single-account clients", async () => {
    expect((await PUT(request({ providerAccountIds: [] }), route)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_project_meta_accounts", expect.objectContaining({ p_provider_account_ids: [] }));
    expect((await PUT(request({ providerAccountId: ids[0] }), route)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_project_meta_account", expect.objectContaining({ p_provider_account_id: ids[0] }));
  });
  it("rejects repeated IDs, invalid IDs and ambiguous inputs before mutation", async () => {
    for (const body of [{ providerAccountIds: [ids[0], ids[0]] }, { providerAccountIds: ["invalid"] }, { providerAccountIds: ids, providerAccountId: ids[0] }]) {
      expect((await PUT(request(body), route)).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not write for missing projects or unauthorized sessions", async () => {
    mocks.project.mockResolvedValue({ data: null, error: null });
    expect((await PUT(request({ providerAccountIds: ids }), route)).status).toBe(404);
    mocks.admin.mockRejectedValue(new ApiError("Sem acesso", 403));
    expect((await PUT(request({ providerAccountIds: ids }), route)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports an account claimed by another project without a second destructive call", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "23505" } });
    expect((await PUT(request({ providerAccountIds: ids }), route)).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

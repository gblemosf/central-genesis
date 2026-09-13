import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc,
  from: () => ({ update: mocks.update }) }) }));
vi.mock("@/lib/meta-sync", () => ({ syncProjectMeta: mocks.sync }));
import { POST } from "./route";
const request = (token?: string) => new Request("https://example.invalid/api/jobs/meta", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_meta_sync_job_token" ? "job-token" : {
    projectId: "project", organizationId: "org", runId: "run", initial: true, timezone: "America/Sao_Paulo",
  }, error: null }));
  const query = { eq: vi.fn() }; query.eq.mockReturnValue(query); mocks.update.mockReturnValue(query);
  mocks.sync.mockResolvedValue({ processed: 10 });
});
describe("automatic Meta job", () => {
  it("requires its dedicated token before claiming or fetching account data", async () => {
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await POST(request("wrong-token"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalledWith("claim_meta_sync_job");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("uses the leased project and first six months without browser authentication", async () => {
    const response = await POST(request("job-token"));
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org" }), "project",
      expect.objectContaining({ since: expect.any(String), until: expect.any(String) }), "run");
    expect(mocks.update).not.toHaveBeenCalled(); // SQL commit owns completion.
  });
  it("retains a safe failure record for a later retry", async () => {
    mocks.sync.mockRejectedValue(new Error("private-provider-response"));
    const response = await POST(request("job-token"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private-provider");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});

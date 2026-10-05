import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  secret: vi.fn(),
  collection: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-auth")>()),
  requireAdmin: mocks.admin,
}));
vi.mock("@/lib/secret-store", () => ({ readConnectionSecret: mocks.secret }));
vi.mock("@/lib/meta-api", () => ({ fetchMetaCollection: mocks.collection }));
import { ApiError } from "@/lib/api-auth";
import { POST } from "./route";

const route = { params: Promise.resolve({ connectionId: "connection" }) };
const request = () =>
  new Request("https://example.invalid/api/connections/connection/accounts", {
    method: "POST",
  });
beforeEach(() => {
  vi.resetAllMocks();
  const connectionQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mocks.maybeSingle,
  };
  connectionQuery.select.mockReturnValue(connectionQuery);
  connectionQuery.eq.mockReturnValue(connectionQuery);
  mocks.maybeSingle.mockResolvedValue({
    data: {
      id: "connection",
      provider: "meta",
      business_id: "business",
      system_user_id: "unresolvable-business-user-id",
    },
    error: null,
  });
  mocks.admin.mockResolvedValue({
    organizationId: "organization",
    supabase: {
      from: (table: string) =>
        table === "integration_connections"
          ? connectionQuery
          : {
              select: () => ({ eq: async () => ({ data: [], error: null }) }),
              upsert: mocks.upsert,
              update: mocks.update,
            },
    },
  });
  mocks.secret.mockResolvedValue("private-meta-token");
  mocks.upsert.mockResolvedValue({ error: null });
});

describe("Meta account discovery", () => {
  it("stores the canonical reporting zone while retaining Meta's original alias", async () => {
    mocks.collection.mockResolvedValue([{ id: "act_alias", timezone_name: "Brazil/East", account_status: 1 }]);
    expect((await POST(request(), route)).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        timezone: "America/Sao_Paulo",
        metadata: { account_status: 1, reported_timezone: "Brazil/East" },
      }),
    ], expect.anything());
  });
  it("discovers owned and shared accounts through the token even with an unusable stored system-user ID", async () => {
    const accessible = [
      { id: "act_owned", name: "Owned", account_status: 1 },
      { id: "act_shared", name: "Partner", account_status: 1 },
    ];
    mocks.collection.mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith("/me/adaccounts")) return accessible;
      if (url.pathname.endsWith("/client_ad_accounts")) return [accessible[1]];
      if (url.pathname.endsWith("/owned_ad_accounts")) return [accessible[0]];
      throw new Error(
        "The stored ID must not be used as the token's Graph identity",
      );
    });
    const response = await POST(request(), route);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accounts: 2,
      unassignedAccounts: 0,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          external_id: "act_owned",
          connection_id: "connection",
          organization_id: "organization",
        }),
        expect.objectContaining({
          external_id: "act_shared",
          connection_id: "connection",
          organization_id: "organization",
        }),
      ],
      { onConflict: "connection_id,external_id" },
    );
    expect(mocks.collection.mock.calls[0][0].toString()).not.toContain(
      "private-meta-token",
    );
  });
  it("does not deactivate saved accounts when Meta discovery fails", async () => {
    mocks.collection.mockRejectedValue(
      new ApiError("Listagem indisponível", 502),
    );
    expect((await POST(request(), route)).status).toBe(502);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not retrieve credentials for a connection outside the administrator's organization", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await POST(request(), route)).status).toBe(404);
    expect(mocks.secret).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});

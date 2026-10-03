import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  requireAdmin: vi.fn(),
  parseState: vi.fn(),
  exchangeCode: vi.fn(),
  readSecret: vi.fn(),
  storeSecret: vi.fn(),
  serialize: vi.fn(),
  deleteCookie: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/google/oauth", () => ({
  parseGoogleOAuthState: mocks.parseState,
  exchangeGoogleAuthorizationCode: mocks.exchangeCode,
  serializeGoogleCredential: mocks.serialize,
  getRefreshTokenFromGoogleCredential: () => "previous-refresh-token",
}));
vi.mock("@/lib/secret-store", () => ({
  readConnectionSecret: mocks.readSecret,
  storeConnectionSecret: mocks.storeSecret,
}));
import { ApiError } from "@/lib/api-auth";
import { GET } from "./route";

const request = (query = "code=private-code&state=current-state") =>
  new Request(`https://example.invalid/api/connections/google/callback?${query}`);
const status = (response: Response) =>
  new URL(response.headers.get("location")!).searchParams.get("googleForms");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({
    get: () => ({ value: "current-state" }),
    delete: mocks.deleteCookie,
  });
  mocks.parseState.mockReturnValue({
    userId: "user",
    organizationId: "organization",
    issuedAt: Date.now(),
  });
  const lookup = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "connection" }, error: null }),
    update: mocks.update,
  };
  const update = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => resolve({ error: null }) };
  mocks.update.mockReturnValue(update);
  mocks.requireAdmin.mockResolvedValue({
    userId: "user",
    organizationId: "organization",
    supabase: { from: () => lookup },
  });
  mocks.exchangeCode.mockResolvedValue({ access_token: "private-access-token", scope: "read-only" });
  mocks.readSecret.mockResolvedValue("previous-credential");
  mocks.serialize.mockReturnValue("new-private-credential");
});

it("requires a new authorization when the state cookie expired, without exchanging or changing credentials", async () => {
  mocks.cookies.mockResolvedValue({ get: () => undefined, delete: mocks.deleteCookie });
  expect(status(await GET(request()))).toBe("session_expired");
  expect(mocks.exchangeCode).not.toHaveBeenCalled();
  expect(mocks.storeSecret).not.toHaveBeenCalled();
});

it("rejects an older signed-in attempt even if its cookie still exists", async () => {
  mocks.parseState.mockReturnValue({ userId: "user", organizationId: "organization", issuedAt: Date.now() - 601_000 });
  expect(status(await GET(request()))).toBe("session_expired");
  expect(mocks.exchangeCode).not.toHaveBeenCalled();
});

it("rejects a mismatched state before reading saved credentials", async () => {
  expect(status(await GET(request("code=private-code&state=wrong-state")))).toBe("invalid_response");
  expect(mocks.requireAdmin).not.toHaveBeenCalled();
  expect(mocks.readSecret).not.toHaveBeenCalled();
});

it("does not transfer authorization to another Central user", async () => {
  mocks.parseState.mockReturnValue({ userId: "other-user", organizationId: "organization", issuedAt: Date.now() });
  expect(status(await GET(request()))).toBe("session_mismatch");
  expect(mocks.exchangeCode).not.toHaveBeenCalled();
  expect(mocks.storeSecret).not.toHaveBeenCalled();
});

it("preserves existing credentials when Google authorization is cancelled", async () => {
  expect(status(await GET(request("error=access_denied")))).toBe("cancelled");
  expect(mocks.storeSecret).not.toHaveBeenCalled();
  expect(mocks.deleteCookie).toHaveBeenCalledWith("genesis_google_oauth_state");
});

it("keeps token-exchange failures generic and never puts credentials or Google errors in the redirect", async () => {
  mocks.exchangeCode.mockRejectedValue(new ApiError("private-google-response", 422));
  const response = await GET(request());
  expect(status(response)).toBe("error");
  expect(response.headers.get("location")).not.toMatch(/private-code|private-google-response/);
  expect(mocks.storeSecret).not.toHaveBeenCalled();
});

it("updates the existing connection only after a valid authorization for the current user and organization", async () => {
  const response = await GET(request());
  expect(status(response)).toBe("connected");
  expect(mocks.storeSecret).toHaveBeenCalledWith("connection", "new-private-credential");
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "connected", last_error: null }));
  expect(response.headers.get("location")).not.toContain("private");
});

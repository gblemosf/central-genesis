import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
vi.mock("@/components/reset-password-form", () => ({ ResetPasswordForm: () => null }));
import ResetPasswordPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
});

describe("password reset page", () => {
  it("uses the user verified by Auth as the target of the form", async () => {
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({}) });
    expect(page.props.userId).toBe("verified-user");
  });

  it("does not let an old logged-in session mask a failed recovery link", async () => {
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({ error: "invalid_link" }) });
    expect(page.props.userId).toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("does not allow password changes when Auth is unavailable", async () => {
    auth.getUser.mockRejectedValue(new Error("offline"));
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({}) });
    expect(page.props.userId).toBeNull();
  });
});

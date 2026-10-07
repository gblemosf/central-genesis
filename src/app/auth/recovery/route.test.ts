import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: { id: "user" } }, error: null });
});

describe("recovery callback", () => {
  it("exchanges the PKCE code and removes credentials and untrusted redirects from the URL", async () => {
    const response = await GET(new Request("https://app.example/auth/recovery?code=one-time&next=https://evil.example"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-time");
    expect(response.headers.get("location")).toBe("https://app.example/auth/reset-password");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["", "?error=access_denied", "?code=test&error=expired"])("rejects missing or failed callback parameters", async query => {
    const response = await GET(new Request(`https://app.example/auth/recovery${query}`));
    expect(response.headers.get("location")).toBe("https://app.example/auth/reset-password?error=invalid_link");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects an expired code or missing browser verifier without treating an existing session as recovery", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null }, error: { code: "flow_state_expired" } });
    const response = await GET(new Request("https://app.example/auth/recovery?code=expired"));
    expect(response.headers.get("location")).toContain("error=invalid_link");
  });

  it("handles provider/network errors without exposing raw details", async () => {
    auth.exchangeCodeForSession.mockRejectedValue(new Error("sensitive provider details"));
    const response = await GET(new Request("https://app.example/auth/recovery?code=test"));
    expect(response.headers.get("location")).toBe("https://app.example/auth/reset-password?error=invalid_link");
  });
});

import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/google/sync", () => ({ syncProjectGoogleForm: vi.fn() }));
const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: admin }));
import { POST } from "./route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("does not run the Google import without its dedicated job token", async () => {
  vi.stubEnv("GOOGLE_FORMS_SYNC_SECRET", "test-job-secret");
  const response = await POST(
    new Request("https://example.invalid/api/jobs/google-forms", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    }),
  );
  expect(response.status).toBe(401);
  expect(admin).not.toHaveBeenCalled();
});

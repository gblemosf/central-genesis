import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  active: vi.fn(),
  from: vi.fn(),
  filters: [] as unknown[][],
}));
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-auth")>()),
  requireAdmin: mocks.admin,
  requireActiveProject: mocks.active,
}));
import { ApiError } from "@/lib/api-auth";
import { GET } from "./route";
const projectId = "00000000-0000-4000-8000-000000000001",
  formId = "00000000-0000-4000-8000-000000000002",
  organizationId = "org";
const route = { params: Promise.resolve({ projectId, formId }) };

function database(formFound = true) {
  const columns = Array.from({ length: 20 }, (_, i) => ({
    id: `q${i}`,
    external_question_id: `e${i}`,
    title: i < 2 ? "Mesmo título" : `Pergunta ${i}`,
    position: i,
    archived_at: i === 19 ? "2026-09-01" : null,
  }));
  const responses = Array.from({ length: 100 }, (_, i) => ({
    id: `r${i}`,
    last_submitted_at: "2026-09-02T12:00:00Z",
    respondent_email: "example@example.invalid",
  }));
  const answers = responses.flatMap((r) =>
    columns.map((q) => ({
      google_form_response_id: r.id,
      google_form_question_id: q.id,
      value: [`${r.id}:${q.id}`],
      question_title_snapshot: q.title,
    })),
  );
  mocks.from.mockImplementation((table: string) => {
    const values =
      table === "google_form_questions"
        ? columns
        : table === "google_form_responses"
          ? responses
          : answers;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        mocks.filters.push([table, column, value]);
        return builder;
      },
      is: () => builder,
      gte: (column: string, value: unknown) => { mocks.filters.push([table, ">=", column, value]); return builder; },
      lt: (column: string, value: unknown) => { mocks.filters.push([table, "<", column, value]); return builder; },
      in: () => builder,
      order: () => builder,
      maybeSingle: async () => ({
        data: formFound ? { id: formId } : null,
        error: null,
      }),
      range: async (from: number, to: number) => ({
        data: values.slice(from, to + 1),
        count: responses.length,
        error: null,
      }),
    };
    return builder;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters.length = 0;
  mocks.admin.mockResolvedValue({
    supabase: { from: mocks.from },
    organizationId,
    userId: "owner",
  });
  mocks.active.mockResolvedValue(undefined);
});

describe("form responses endpoint", () => {
  it("filters before pagination, including the last day in Brasilia time", async () => {
    database();
    const response = await GET(new Request("https://example.invalid?start=2026-09-01&end=2026-09-13"), route);
    expect(response.status).toBe(200);
    expect(mocks.filters).toContainEqual(["google_form_responses", ">=", "last_submitted_at", "2026-09-01T00:00:00-03:00"]);
    expect(mocks.filters).toContainEqual(["google_form_responses", "<", "last_submitted_at", "2026-09-14T00:00:00-03:00"]);
  });
  it.each(["start=2026-09-01", "start=2026-09-13&end=2026-09-01", "start=2025-01-01&end=2026-09-01", "start=2026-02-30&end=2026-03-01"])("rejects invalid filter %s before reading rows", async (query) => {
    database();
    expect((await GET(new Request(`https://example.invalid?${query}`), route)).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("loads all 2,000 cells and keeps duplicate and removed question columns", async () => {
    database();
    const response = await GET(
      new Request("https://example.invalid? page=1".replace("? ", "?")),
      route,
    );
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.columns).toHaveLength(20);
    expect(data.rows).toHaveLength(100);
    expect(data.rows[99].answers.q19.value).toEqual(["r99:q19"]);
    expect(data.columns[19].archived).toBe(true);
    for (const table of [
      "google_forms",
      "google_form_questions",
      "google_form_responses",
      "google_form_answers",
    ]) {
      expect(mocks.filters).toContainEqual([
        table,
        "organization_id",
        organizationId,
      ]);
      expect(mocks.filters).toContainEqual([table, "project_id", projectId]);
    }
  });
  it("rejects a form that is outside the requested project before reading responses", async () => {
    database(false);
    const response = await GET(new Request("https://example.invalid"), route);
    expect(response.status).toBe(404);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("rejects an unauthenticated request without consulting the database", async () => {
    mocks.admin.mockRejectedValue(new ApiError("Sessão inválida.", 401));
    expect(
      (await GET(new Request("https://example.invalid"), route)).status,
    ).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

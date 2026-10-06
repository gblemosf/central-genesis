import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/api-auth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(), requireAdmin: mocks.requireAdmin,
}));
import { ApiError } from "@/lib/api-auth";
import { PATCH } from "./route";

const id = "00000000-0000-4000-8000-000000000010";
const route = { params: Promise.resolve({ connectionId: id }) };
const metadata = { payt_payload_contract: { version: 1 }, note: "preserve history" };
let connection: Record<string, unknown> | null;
let counts: Record<string, number | null>;
let queryError: unknown;
let saved: Record<string, unknown> | null;
let filters: { table: string; method: string; field: string; value: unknown }[];
const update = vi.fn();
const rpc = vi.fn();
const from = vi.fn();

function request(value: unknown = { archived: true }) {
  return new Request(`https://example.invalid/api/connections/${id}/archive`, {
    method: "PATCH", body: JSON.stringify(value),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  connection = { id, status: "revoked", revoked_at: "2026-10-06T12:00:00Z", metadata };
  counts = { project_accounts: 0, product_mappings: 0, google_forms: 0 };
  queryError = null; saved = { id }; filters = [];
  from.mockImplementation((table: string) => {
    let editing = false;
    const query = {
      select: vi.fn().mockReturnThis(),
      eq(field: string, value: unknown) { filters.push({ table, method: "eq", field, value }); return this; },
      is(field: string, value: unknown) { filters.push({ table, method: "is", field, value }); return this; },
      update(value: unknown) { editing = true; update(value); return this; },
      maybeSingle: async () => ({ data: editing ? saved : connection, error: null }),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ count: counts[table], error: queryError }).then(resolve); },
    };
    return query;
  });
  mocks.requireAdmin.mockResolvedValue({ organizationId: "org-test", supabase: { from, rpc } });
});

describe("revoked connection archiving", () => {
  it("archives without deleting history, replacing other metadata, or changing credentials", async () => {
    const response = await PATCH(request(), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(update).toHaveBeenCalledWith({ metadata: { ...metadata, genesis_archived_at: body.data.archivedAt } });
    expect(rpc).not.toHaveBeenCalled();
    expect(from.mock.calls.map(([table]) => table)).not.toContain("sales_events");
    expect(filters).toContainEqual({ table: "integration_connections", method: "eq", field: "organization_id", value: "org-test" });
    expect(filters).toContainEqual({ table: "integration_connections", method: "eq", field: "metadata", value: JSON.stringify(metadata) });
    for (const table of ["project_accounts", "product_mappings", "google_forms"]) {
      expect(filters).toContainEqual({ table, method: "is", field: "projects.deleted_at", value: null });
      expect(filters).toContainEqual({ table, method: "eq", field: "organization_id", value: "org-test" });
    }
    expect(filters).toContainEqual({ table: "product_mappings", method: "is", field: "effective_to", value: null });
    expect(filters).toContainEqual({ table: "google_forms", method: "is", field: "archived_at", value: null });
  });

  it.each(["project_accounts", "product_mappings", "google_forms"])("keeps a source configured through %s in the list", async table => {
    counts[table] = 1;
    expect((await PATCH(request(), route)).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("fails closed when checking current assignments fails or returns no count", async () => {
    queryError = { message: "database unavailable" };
    expect((await PATCH(request(), route)).status).toBe(503);
    queryError = null; counts.product_mappings = null;
    expect((await PATCH(request(), route)).status).toBe(503);
    expect(update).not.toHaveBeenCalled();
  });

  it("requires an administrator and prevents access to another organization's source", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new ApiError("Admin required", 403));
    expect((await PATCH(request(), route)).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    connection = null;
    expect((await PATCH(request(), route)).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("never archives an active or inconsistently revoked credential", async () => {
    connection = { id, status: "connected", revoked_at: null, metadata };
    expect((await PATCH(request(), route)).status).toBe(409);
    connection.status = "revoked";
    expect((await PATCH(request(), route)).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("restores visibility without reactivating credentials or removing other settings", async () => {
    connection!.metadata = { ...metadata, genesis_archived_at: "2026-10-06T12:00:00Z" };
    const response = await PATCH(request({ archived: false }), route);
    expect(response.status).toBe(200);
    expect((await response.json()).data.archivedAt).toBeNull();
    expect(update).toHaveBeenCalledWith({ metadata });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["integration_connections", "integration_connections"]);
  });

  it("rejects unsupported fields and refuses an update after a concurrent metadata change", async () => {
    expect((await PATCH(request({ archived: true, role: "owner" }), route)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    saved = null;
    expect((await PATCH(request(), route)).status).toBe(409);
  });
});

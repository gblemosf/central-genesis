import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("jsr:@supabase/functions-js/edge-runtime.d.ts", () => ({}));
const connectionId = "00000000-0000-4000-8000-000000000010";
const token = "a".repeat(64);
let handler: (request: Request) => Promise<Response>;
const rpc = vi.fn();
beforeEach(async () => {
  vi.resetModules(); createClient.mockReturnValue({ rpc });
  rpc.mockImplementation(async (name, args) => ({ data: name === "resolve_payt_webhook_connection" ? args.p_token === token ? connectionId : null
    : name === "get_payt_webhook_contract" ? null : { duplicate: false, state: "awaiting_contract", mapped: false }, error: null }));
  vi.stubGlobal("Deno", { env: { get: () => "configured" }, serve: (callback: typeof handler) => { handler = callback; } });
  await import("./index");
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const request = (body: unknown = { event: "new_vendor_event", token: "vendor-secret", buyer: { email: "buyer@example.invalid", cpf: "private" } }, deliveryToken = token, id = connectionId) =>
  new Request(`https://example.supabase.co/functions/v1/payt-webhook/${id}?token=${deliveryToken}`, { method: "POST", body: JSON.stringify(body) });
describe("Payt authenticated durable receiver", () => {
  it("acknowledges an unknown event only after durable persistence", async () => {
    const response = await handler(request()); expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("receive_payt_postback", expect.objectContaining({ p_connection_id: connectionId,
      p_payload: { event: "new_vendor_event", buyer: { email: "buyer@example.invalid" } }, p_normalized: null, p_review_reason: "awaiting_contract" }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("vendor-secret");
  });
  it("rejects missing or mismatching tokens before saving data", async () => {
    expect((await handler(request({}, ""))).status).toBe(401);
    expect((await handler(request({}, "b".repeat(64)))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalledWith("receive_payt_postback", expect.anything());
  });
  it("cannot route one connection's token to another connection", async () => {
    expect((await handler(request({}, token, "00000000-0000-4000-8000-000000000011"))).status).toBe(401);
  });
  it("rejects invalid JSON shapes and oversized bodies", async () => {
    expect((await handler(request([]))).status).toBe(400);
    expect((await handler(request({}))).status).toBe(400);
    expect((await handler(request({ data: "x".repeat(1_000_001) }))).status).toBe(413);
  });
  it("returns a retryable failure when storage fails", async () => {
    rpc.mockImplementation(async name => ({ data: name === "resolve_payt_webhook_connection" ? connectionId : null,
      error: name === "receive_payt_postback" ? { message: "failure" } : null }));
    expect((await handler(request())).status).toBe(500);
  });
});

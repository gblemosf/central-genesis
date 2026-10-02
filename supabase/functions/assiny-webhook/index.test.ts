import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assinyDeliveryKey, prepareAssinyPayload } from "./payload";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("jsr:@supabase/functions-js/edge-runtime.d.ts", () => ({}));
const connectionId = "00000000-0000-4000-8000-000000000090";
const token = "a".repeat(64);
let handler: (request: Request) => Promise<Response>;
const rpc = vi.fn();
beforeEach(async () => {
  vi.resetModules(); createClient.mockReturnValue({ rpc });
  rpc.mockImplementation(async (name, args) => ({ data: name === "resolve_assiny_webhook_connection"
    ? args.p_token === token && args.p_connection_id === connectionId ? connectionId : null
    : { receipt_id: "receipt", duplicate: false, state: "awaiting_contract" }, error: null }));
  vi.stubGlobal("Deno", { env: { get: () => "configured" }, serve: (callback: typeof handler) => { handler = callback; } });
  await import("./index");
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const request = (body: unknown = { arbitrary: "not-an-official-schema", client_secret: "private", buyer: { email: "test@example.invalid", cpf: "private" } }, deliveryToken = token, id = connectionId) =>
  new Request(`https://example.supabase.co/functions/v1/assiny-webhook/${id}?token=${deliveryToken}`, { method: "POST", body: JSON.stringify(body) });

describe("Assiny preparation transport", () => {
  it("stores an uninterpreted receipt and explicitly never claims financial processing", async () => {
    const response = await handler(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, state: "awaiting_contract", processed: false });
    expect(rpc).toHaveBeenCalledWith("receive_assiny_webhook", expect.objectContaining({ p_connection_id: connectionId, p_token: token,
      p_payload: { arbitrary: "not-an-official-schema", buyer: { email: "test@example.invalid" } } }));
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["resolve_assiny_webhook_connection", "receive_assiny_webhook"]);
  });
  it("denies wrong/missing tokens and a token directed at another connection", async () => {
    expect((await handler(request({}, ""))).status).toBe(401);
    expect((await handler(request({}, "b".repeat(64)))).status).toBe(401);
    expect((await handler(request({}, token, "00000000-0000-4000-8000-000000000091"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalledWith("receive_assiny_webhook", expect.anything());
  });
  it("rejects malformed, empty, array, too deeply nested and oversized payloads", async () => {
    expect((await handler(request([]))).status).toBe(400);
    expect((await handler(request({}))).status).toBe(400);
    expect((await handler(request({ token: "only-private" }))).status).toBe(400);
    expect((await handler(request({ data: "x".repeat(1_000_001) }))).status).toBe(413);
    let deep: unknown = "value"; for (let i = 0; i < 34; i++) deep = { child: deep };
    expect((await handler(request(deep))).status).toBe(400);
    const malformed = new Request(`https://example.supabase.co/functions/v1/assiny-webhook/${connectionId}?token=${token}`, { method: "POST", body: "{" });
    expect((await handler(malformed)).status).toBe(400);
  });
  it("does not acknowledge success when persistence fails", async () => {
    rpc.mockImplementation(async name => ({ data: name === "resolve_assiny_webhook_connection" ? connectionId : null,
      error: name === "receive_assiny_webhook" ? { message: "failure" } : null }));
    expect((await handler(request())).status).toBe(500);
  });
  it("deduplicates equivalent JSON without merging distinct redacted originals", async () => {
    const first = prepareAssinyPayload({ a: 1, token: "secret-one", nested: { b: 2, c: 3 } });
    const reordered = prepareAssinyPayload({ nested: { c: 3, b: 2 }, token: "secret-one", a: 1 });
    const changed = prepareAssinyPayload({ a: 1, token: "secret-two", nested: { b: 2, c: 3 } });
    expect(first.payload).toEqual(changed.payload);
    expect(await assinyDeliveryKey(first.canonical)).toBe(await assinyDeliveryKey(reordered.canonical));
    expect(await assinyDeliveryKey(first.canonical)).not.toBe(await assinyDeliveryKey(changed.canonical));
  });
  it("strips conventional nested secrets and credentials embedded in URLs", () => {
    const prepared = prepareAssinyPayload({ details: [{ card_number: "private", accessToken: "private", url: "https://example.invalid/?token=private&x=1" }], note: "keep" });
    expect(prepared.payload).toEqual({ details: [{ url: "https://example.invalid/?token=[redacted]&x=1" }], note: "keep" });
  });
});

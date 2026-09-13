import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mockRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: mockRequest }));
import { requestHotmartSales } from "./hotmart-sales-http";

beforeEach(() => vi.clearAllMocks());
describe("Hotmart sales HTTP transport", () => {
  function respond(status: number, body: string) {
    mockRequest.mockImplementation((_url, _options, callback) => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
      req.end.mockImplementation(() => {
        const res = Object.assign(new EventEmitter(), { statusCode: status, headers: { "content-type": "application/json" } });
        callback(res);
        res.emit("data", Buffer.from(body));
        res.emit("end");
      });
      return req;
    });
  }
  it("preserves filters and bearer authentication with a bounded native request", async () => {
    respond(200, '{"items":[]}');
    const query = new URLSearchParams({ product_id: "8304193", page_token: "a+b==" });
    const result = await requestHotmartSales("private-token", "history", query);
    const [url, options] = mockRequest.mock.calls[0];
    expect(url.origin).toBe("https://developers.hotmart.com");
    expect(url.pathname).toBe("/payments/api/v1/sales/history");
    expect(url.searchParams.get("page_token")).toBe("a+b==");
    expect(url.search).not.toContain("private-token");
    expect(options.headers.Authorization).toBe("Bearer private-token");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(await result.json()).toEqual({ items: [] });
  });
  it("preserves HTTP errors and does not follow redirects with the credential", async () => {
    respond(400, '{"error":"invalid_parameter"}');
    expect((await requestHotmartSales("secret", "users", new URLSearchParams())).status).toBe(400);
    respond(302, "");
    expect((await requestHotmartSales("secret", "history", new URLSearchParams())).status).toBe(302);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
  it("propagates network failures so the durable worker can retry", async () => {
    mockRequest.mockImplementation(() => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn() });
      req.end.mockImplementation(() => req.emit("error", new Error("network unavailable")));
      return req;
    });
    await expect(requestHotmartSales("secret", "history", new URLSearchParams())).rejects.toThrow("network unavailable");
  });
});

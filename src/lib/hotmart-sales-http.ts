import "server-only";
import { request } from "node:https";

// Use Node's HTTP transport for this provider, independently of fetch patches
// installed by the framework or hosting runtime. Never forward redirects.
export function requestHotmartSales(
  token: string,
  endpoint: "history" | "commissions" | "users",
  query: URLSearchParams,
): Promise<Response> {
  const url = new URL(
    `https://developers.hotmart.com/payments/api/v1/sales/${endpoint}`,
  );
  url.search = query.toString();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            req.destroy(new Error("Hotmart response exceeded the size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 502;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              {
                status,
                headers: {
                  "Content-Type":
                    res.headers["content-type"] ?? "application/json",
                },
              },
            ),
          );
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { normalizePaytPayload, objectValue, paytPayloadKey, sanitizePaytPayload } from "./normalize.ts";

const maxBodyBytes = 1_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Payt can deliver to a configured URL without a custom Authorization header.
// JWT verification is replaced by the connection's 256-bit delivery token.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const connectionId = segments.at(-1) ?? "";
  if (!uuidPattern.test(connectionId) || segments.at(-2) !== "payt-webhook") return new Response("Endpoint not found", { status: 404 });
  const token = request.headers.get("x-genesis-payt-token") ?? url.searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > maxBodyBytes) return new Response("Payload too large", { status: 413 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return new Response("Service unavailable", { status: 503 });
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const resolved = await supabase.rpc("resolve_payt_webhook_connection", { p_connection_id: connectionId, p_token: token });
    if (resolved.error) return new Response("Service unavailable", { status: 503 });
    if (resolved.data !== connectionId) return new Response("Unauthorized", { status: 401 });
    let payload: Record<string, unknown>;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = request.body?.getReader();
      if (!reader) return new Response("Invalid JSON", { status: 400 });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) return new Response("JSON object required", { status: 400 });
      payload = objectValue(sanitizePaytPayload(body));
      if (Object.keys(payload).length === 0) return new Response("Event data required", { status: 400 });
    } catch { return new Response("Invalid JSON", { status: 400 }); }
    const contract = await supabase.rpc("get_payt_webhook_contract", { p_connection_id: connectionId });
    if (contract.error) return new Response("Service unavailable", { status: 503 });
    const normalized = normalizePaytPayload(payload, contract.data);
    const received = await supabase.rpc("receive_payt_postback", {
      p_connection_id: connectionId, p_idempotency_key: await paytPayloadKey(payload),
      p_payload: payload, p_normalized: normalized.value ?? null,
      p_review_reason: normalized.reason ?? null,
    });
    if (received.error) return new Response("Persistence failed", { status: 500 });
    const result = objectValue(Array.isArray(received.data) ? received.data[0] : received.data);
    return Response.json({ accepted: true, duplicate: Boolean(result.duplicate), state: result.state, mapped: Boolean(result.mapped) }, { status: 202 });
  } catch { return new Response("Service unavailable", { status: 503 }); }
});

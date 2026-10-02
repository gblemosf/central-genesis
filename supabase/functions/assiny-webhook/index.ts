import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { assinyDeliveryKey, prepareAssinyPayload } from "./payload.ts";

const maxBodyBytes = 1_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Genesis-generated protection for a preparation receiver. This does not
// implement or claim Assiny's vendor authentication, pending official docs.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const connectionId = segments.at(-1) ?? "";
  if (!uuidPattern.test(connectionId) || segments.at(-2) !== "assiny-webhook") return new Response("Endpoint not found", { status: 404 });
  const token = request.headers.get("x-genesis-assiny-token") ?? url.searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > maxBodyBytes) return new Response("Payload too large", { status: 413 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return new Response("Service unavailable", { status: 503 });
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const resolved = await supabase.rpc("resolve_assiny_webhook_connection", { p_connection_id: connectionId, p_token: token });
    if (resolved.error) return new Response("Service unavailable", { status: 503 });
    if (resolved.data !== connectionId) return new Response("Unauthorized", { status: 401 });
    let prepared: ReturnType<typeof prepareAssinyPayload>;
    try {
      const reader = request.body?.getReader();
      if (!reader) return new Response("Invalid JSON", { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
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
      prepared = prepareAssinyPayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch { return new Response("Invalid JSON", { status: 400 }); }
    const received = await supabase.rpc("receive_assiny_webhook", {
      p_connection_id: connectionId, p_token: token,
      p_idempotency_key: await assinyDeliveryKey(prepared.canonical), p_payload: prepared.payload,
    });
    if (received.error || !received.data?.receipt_id) return new Response("Persistence failed", { status: 500 });
    return Response.json({ accepted: true, duplicate: Boolean(received.data.duplicate), receiptId: received.data.receipt_id,
      state: "awaiting_contract", processed: false }, { status: 202 });
  } catch { return new Response("Service unavailable", { status: 503 }); }
});

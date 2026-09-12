import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeHublaWebhookPayload,
  objectValue,
} from "./normalize.ts";

const maxBodyBytes = 1_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return new Response("Payload too large", { status: 413 });

  const pathSegment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  const requestedConnectionId = uuidPattern.test(pathSegment) ? pathSegment : null;
  if (!requestedConnectionId && pathSegment !== "hubla-webhook") {
    return new Response("Endpoint not found", { status: 404 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return new Response("Service unavailable", { status: 503 });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const receivedToken = request.headers.get("x-hubla-token") ?? "";
  if (receivedToken.length < 8 || receivedToken.length > 1024) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { data: resolvedConnectionId, error: resolutionError } = await supabase.rpc(
    "resolve_hubla_webhook_connection",
    { p_token: receivedToken },
  );
  if (resolutionError) return new Response("Service unavailable", { status: 503 });
  if (
    typeof resolvedConnectionId !== "string" ||
    !uuidPattern.test(resolvedConnectionId) ||
    (requestedConnectionId && resolvedConnectionId !== requestedConnectionId)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const connectionId = resolvedConnectionId;

  const idempotencyKey = request.headers.get("x-hubla-idempotency")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return new Response("Idempotency key required", { status: 400 });
  }

  let payload;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > maxBodyBytes) {
      return new Response("Payload too large", { status: 413 });
    }
    payload = objectValue(JSON.parse(rawBody));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const normalized = normalizeHublaWebhookPayload(payload);
  if (normalized.error === "unsupported") {
    return new Response("Unsupported Hubla event", { status: 422 });
  }
  const event = normalized.value;
  if (
    (event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.refunded") &&
    !event.entityId
  ) {
    return new Response("Stable entity identifier required", { status: 400 });
  }
  const sandbox = (request.headers.get("x-hubla-sandbox") ?? "false").toLowerCase() === "true";

  const { data, error } = await supabase.rpc("ingest_hubla_webhook", {
    p_connection_id: connectionId,
    p_idempotency_key: idempotencyKey,
    p_event_type: event.type,
    p_contract_version: event.contractVersion,
    p_event_at: event.eventAt,
    p_entity_id: event.entityId,
    p_entity_version: event.entityVersion,
    p_product_external_id: event.productExternalId,
    p_product_name: event.productName,
    p_gross_amount: event.grossAmount,
    p_net_amount: event.netAmount,
    p_currency: event.currency,
    p_sandbox: sandbox,
    p_payload: event.payload,
  });
  if (error) return new Response("Persistence failed", { status: 500 });

  const result = Array.isArray(data) ? data[0] : data;
  return Response.json(
    {
      accepted: true,
      duplicate: Boolean(result?.duplicate),
      mapped: Boolean(result?.mapped),
      normalized: Boolean(result?.normalized),
      recognized: event.knownEvent,
      sandbox,
    },
    { status: 202 },
  );
});

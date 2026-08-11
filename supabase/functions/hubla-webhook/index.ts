import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const maxBodyBytes = 1_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptedEvents = new Set([
  "lead.abandoned_checkout",
  "customer.member_added",
  "customer.member_removed",
  "subscription.created",
  "subscription.activated",
  "subscription.expiring",
  "subscription.deactivated",
  "subscription.renewal_disabled",
  "subscription.renewal_enabled",
  "invoice.created",
  "invoice.status_updated",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.expired",
  "invoice.refunded",
  "smart_installment.created",
  "smart_installment.aborted",
  "smart_installment.on_schedule",
  "smart_installment.off_schedule",
  "smart_installment.canceled",
  "smart_installment.completed",
  "refund_request.created",
  "refund_request.accepted",
  "refund_request.canceled",
  "refund_request.rejected",
]);

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function constantTimeEqual(received: string, expected: string) {
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function webhookToken(raw: string) {
  try {
    const parsed = objectValue(JSON.parse(raw));
    if (parsed.version === 1 && parsed.provider === "hubla") {
      return stringValue(parsed.webhookToken);
    }
  } catch {
    // Legacy Hubla secrets were stored as the raw webhook token.
  }
  return raw;
}

function statusTimestamp(invoice: JsonObject, status: string) {
  const match = arrayValue(invoice.statusAt)
    .map(objectValue)
    .find((entry) => stringValue(entry.status) === status);
  return stringValue(match?.when);
}

function eventTimestamp(type: string, event: JsonObject) {
  const invoice = objectValue(event.invoice);
  const subscription = objectValue(event.subscription);
  const lead = objectValue(event.lead);
  const byType: Record<string, string> = {
    "invoice.payment_succeeded": statusTimestamp(invoice, "paid"),
    "invoice.payment_failed": statusTimestamp(invoice, "overdue"),
    "invoice.refunded": statusTimestamp(invoice, "refunded"),
    "subscription.created": stringValue(subscription.createdAt),
    "subscription.activated": stringValue(subscription.activatedAt),
    "subscription.deactivated": stringValue(subscription.inactivatedAt),
    "subscription.renewal_disabled": stringValue(subscription.deactivatedAutoRenewAt),
    "lead.abandoned_checkout": stringValue(lead.createdAt),
  };
  const candidate = byType[type]
    || stringValue(invoice.modifiedAt || invoice.createdAt)
    || stringValue(subscription.modifiedAt || subscription.createdAt)
    || stringValue(lead.createdAt);
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return new Response("Payload too large", { status: 413 });

  const connectionId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!uuidPattern.test(connectionId)) return new Response("Endpoint not found", { status: 404 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return new Response("Service unavailable", { status: 503 });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: connection, error: connectionError } = await supabase
    .from("integration_connections")
    .select("id,provider,revoked_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError) return new Response("Service unavailable", { status: 503 });
  if (!connection || connection.provider !== "hubla" || connection.revoked_at) {
    return new Response("Endpoint not found", { status: 404 });
  }

  const { data: storedSecret, error: secretError } = await supabase.rpc(
    "get_connection_secret",
    { p_connection_id: connectionId },
  );
  if (secretError || typeof storedSecret !== "string") {
    return new Response("Webhook token not configured", { status: 409 });
  }
  const expectedToken = webhookToken(storedSecret);
  const receivedToken = request.headers.get("x-hubla-token") ?? "";
  if (!expectedToken || !constantTimeEqual(receivedToken, expectedToken)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const idempotencyKey = request.headers.get("x-hubla-idempotency")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return new Response("Idempotency key required", { status: 400 });
  }

  let payload: JsonObject;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > maxBodyBytes) {
      return new Response("Payload too large", { status: 413 });
    }
    payload = objectValue(JSON.parse(rawBody));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const type = stringValue(payload.type);
  const event = objectValue(payload.event);
  if (!acceptedEvents.has(type) || Object.keys(event).length === 0) {
    return new Response("Unsupported Hubla event", { status: 422 });
  }
  const timestamp = eventTimestamp(type, event);
  if (!timestamp) return new Response("Invalid event timestamp", { status: 400 });

  const invoice = objectValue(event.invoice);
  const subscription = objectValue(event.subscription);
  const lead = objectValue(event.lead);
  const product = Object.keys(objectValue(event.product)).length > 0
    ? objectValue(event.product)
    : objectValue(arrayValue(event.products)[0]);
  const amount = objectValue(
    Object.keys(invoice).length > 0
      ? invoice.amount
      : objectValue(subscription.lastInvoice).amount,
  );
  const grossAmount = numberValue(amount.totalCents) / 100;
  const seller = arrayValue(invoice.receivers)
    .map(objectValue)
    .find((receiver) => stringValue(receiver.role) === "seller");
  const netAmount = seller ? numberValue(seller.totalCents) / 100 : grossAmount;
  const entity = Object.keys(invoice).length > 0
    ? invoice
    : Object.keys(subscription).length > 0
      ? subscription
      : lead;
  const entityId = stringValue(entity.id);
  if ((type === "invoice.payment_succeeded" || type === "invoice.refunded") && !entityId) {
    return new Response("Stable entity identifier required", { status: 400 });
  }
  const currency = stringValue(
    invoice.currency || objectValue(subscription.lastInvoice).currency,
  ).toUpperCase() || "BRL";
  const sandbox = (request.headers.get("x-hubla-sandbox") ?? "false").toLowerCase() === "true";

  const { data, error } = await supabase.rpc("ingest_hubla_webhook", {
    p_connection_id: connectionId,
    p_idempotency_key: idempotencyKey,
    p_event_type: type,
    p_contract_version: stringValue(payload.version) || null,
    p_event_at: timestamp,
    p_entity_id: entityId || null,
    p_entity_version: Number.isInteger(Number(entity.version)) ? Number(entity.version) : null,
    p_product_external_id: stringValue(product.id) || null,
    p_product_name: stringValue(product.name) || null,
    p_gross_amount: grossAmount,
    p_net_amount: netAmount,
    p_currency: currency,
    p_sandbox: sandbox,
    p_payload: {
      type,
      version: stringValue(payload.version) || null,
      entity: {
        id: stringValue(entity.id) || null,
        version: Number.isInteger(Number(entity.version)) ? Number(entity.version) : null,
      },
      product: {
        id: stringValue(product.id) || null,
        name: stringValue(product.name) || null,
      },
    },
  });
  if (error) return new Response("Persistence failed", { status: 500 });

  const result = Array.isArray(data) ? data[0] : data;
  return Response.json(
    {
      accepted: true,
      duplicate: Boolean(result?.duplicate),
      mapped: Boolean(result?.mapped),
      normalized: Boolean(result?.normalized),
      sandbox,
    },
    { status: 202 },
  );
});

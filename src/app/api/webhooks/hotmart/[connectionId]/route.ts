import { timingSafeEqual } from "node:crypto";
import {
  normalizeHotmartWebhookEvent,
  parseHotmartWebhookPayload,
} from "@/lib/hotmart-webhook";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConnectionSecret } from "@/lib/secret-store";

const maxBodyBytes = 1_000_000;

function equalSecret(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(
  request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await route.params;
  const admin = createSupabaseAdminClient();
  if (!admin) return new Response("Server not configured", { status: 503 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) {
    return new Response("Payload too large", { status: 413 });
  }

  const { data: connection, error: connectionError } = await admin
    .from("integration_connections")
    .select("id,provider,revoked_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError) return new Response("Service unavailable", { status: 503 });
  if (!connection || connection.provider !== "hotmart" || connection.revoked_at) {
    return new Response("Connection not found", { status: 404 });
  }

  let expected: string;
  try {
    const stored = await readConnectionSecret(connectionId);
    expected = decodeProviderCredentials("hotmart", stored).hottok ?? "";
  } catch {
    return new Response("Service unavailable", { status: 503 });
  }
  const hottok = request.headers.get("x-hotmart-hottok") ?? "";
  if (!expected || !hottok || !equalSecret(hottok, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsedBody: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > maxBodyBytes) {
      return new Response("Payload too large", { status: 413 });
    }
    parsedBody = JSON.parse(body);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  let events;
  try {
    events = parseHotmartWebhookPayload(parsedBody);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const results: { duplicate: boolean; mapped: boolean }[] = [];

  for (const envelope of events) {
    let event;
    try {
      event = normalizeHotmartWebhookEvent(envelope);
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }
    if (!event) continue;

    const { data, error } = event.eventType === "PURCHASE_REFUNDED"
      ? await admin.rpc("ingest_hotmart_refund", {
          p_connection_id: connectionId,
          p_external_event_id: event.externalEventId,
          p_external_transaction_id: event.externalTransactionId,
          p_event_at: event.eventAt,
          p_gross_amount: event.grossAmount,
          p_net_amount: event.netAmount,
          p_currency: event.currency,
          p_payload: event.payload,
        })
      : await admin.rpc("ingest_hotmart_sale", {
          p_connection_id: connectionId,
          p_external_event_id: event.externalEventId,
          p_external_transaction_id: event.externalTransactionId,
          p_event_type: event.eventType,
          p_event_at: event.eventAt,
          p_product_external_id: event.productExternalId,
          p_product_name: event.productName,
          p_gross_amount: event.grossAmount,
          p_net_amount: event.netAmount,
          p_currency: event.currency,
          p_payload: event.payload,
        });
    if (error) return new Response("Persistence failed", { status: 500 });

    const result = Array.isArray(data) ? data[0] : data;
    results.push({
      duplicate: Boolean(result?.duplicate),
      mapped: Boolean(result?.mapped),
    });
  }

  return Response.json({
    accepted: results.length,
    duplicates: results.filter((result) => result.duplicate).length,
    quarantined: results.filter((result) => !result.mapped).length,
    ignored: events.length - results.length,
  });
}

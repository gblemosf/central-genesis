import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConnectionSecret } from "@/lib/secret-store";

const maxBodyBytes = 1_000_000;
const handledEvents = new Set([
  "PURCHASE_APPROVED",
  "PURCHASE_COMPLETED",
  "PURCHASE_REFUNDED",
]);
const stringOrNumber = z.union([z.string(), z.number()]);
const hotmartEnvelopeSchema = z.object({ event: z.string() }).passthrough();
const hotmartEventSchema = z
  .object({
    id: stringOrNumber.optional(),
    event: z.string(),
    creation_date: stringOrNumber.optional(),
    data: z
      .object({
        product: z
          .object({
            id: stringOrNumber,
            name: z.string().optional(),
          })
          .passthrough(),
        purchase: z
          .object({
            transaction: z.string().trim().min(1),
            approved_date: stringOrNumber.optional(),
            price: z
              .object({
                value: z.number().finite().nonnegative(),
                currency_code: z.string().trim().length(3).optional(),
              })
              .passthrough(),
            hotmart_fee: z
              .object({ total: z.number().finite().nonnegative() })
              .passthrough(),
            commission_as: z.number().finite().nonnegative().optional(),
          })
          .passthrough(),
        commissions: z
          .array(
            z
              .object({ value: z.number().finite().nonnegative().optional() })
              .passthrough(),
          )
          .max(100)
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
const hotmartPayloadSchema = z.union([
  hotmartEnvelopeSchema,
  z.array(hotmartEnvelopeSchema).min(1).max(20),
]);

function equalSecret(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function eventDate(value: string | number | undefined) {
  if (value === undefined) throw new Error("missing date");
  const numeric = typeof value === "number" || /^\d+$/.test(value);
  const timestamp = numeric ? Number(value) : value;
  const normalized =
    typeof timestamp === "number" && timestamp < 1_000_000_000_000
      ? timestamp * 1000
      : timestamp;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  return date.toISOString();
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

  const parsed = hotmartPayloadSchema.safeParse(parsedBody);
  if (!parsed.success) return new Response("Invalid payload", { status: 400 });
  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const results: { duplicate: boolean; mapped: boolean }[] = [];

  for (const envelope of events) {
    if (!handledEvents.has(envelope.event)) continue;
    const eventResult = hotmartEventSchema.safeParse(envelope);
    if (!eventResult.success) return new Response("Invalid payload", { status: 400 });
    const event = eventResult.data;

    const transaction = event.data.purchase.transaction;
    if (!transaction) {
      return new Response("Stable transaction identifier required", { status: 400 });
    }
    const externalEventId = event.id
      ? String(event.id)
      : `${event.event}:${transaction}`;

    let eventAt: string;
    try {
      eventAt = eventDate(
        event.event === "PURCHASE_REFUNDED"
          ? event.creation_date ?? event.data.purchase.approved_date
          : event.data.purchase.approved_date,
      );
    } catch {
      return new Response("Invalid event date", { status: 400 });
    }

    const productExternalId = String(event.data.product.id);
    const gross = event.data.purchase.price.value;
    const fee = event.data.purchase.hotmart_fee.total;
    const commissions = (event.data.commissions ?? []).reduce(
      (sum, commission) => sum + (commission.value ?? 0),
      0,
    );
    const netAfterFee = gross - fee;
    const net = netAfterFee > 0
      ? netAfterFee
      : event.data.purchase.commission_as ?? commissions;
    const currency = event.data.purchase.price?.currency_code?.toUpperCase() ?? "BRL";
    const { data, error } = event.event === "PURCHASE_REFUNDED"
      ? await admin.rpc("ingest_hotmart_refund", {
          p_connection_id: connectionId,
          p_external_event_id: externalEventId,
          p_external_transaction_id: transaction,
          p_event_at: eventAt,
          p_gross_amount: gross,
          p_net_amount: net,
          p_currency: currency,
          p_payload: { product_external_id: productExternalId },
        })
      : await admin.rpc("ingest_hotmart_sale", {
          p_connection_id: connectionId,
          p_external_event_id: externalEventId,
          p_external_transaction_id: transaction,
          p_event_type: event.event,
          p_event_at: eventAt,
          p_product_external_id: productExternalId,
          p_product_name: event.data.product.name ?? productExternalId,
          p_gross_amount: gross,
          p_net_amount: net,
          p_currency: currency,
          p_payload: { product_external_id: productExternalId },
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

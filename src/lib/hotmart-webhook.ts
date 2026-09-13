import { z } from "zod";
import { record, text, saleAttribution } from "@/lib/sales-attribution";

const stringOrNumber = z.union([z.string(), z.number()]);
const currencyCode = z.string().trim().length(3).optional();
const optionalText = (max: number) => z.string().trim().max(max).optional();

const hotmartEnvelopeSchema = z
  .object({ event: z.string().trim().min(1) })
  .passthrough();

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
            name: optionalText(500),
            ucode: optionalText(200),
          })
          .passthrough(),
        purchase: z
          .object({
            transaction: z.string().trim().min(1).max(300),
            status: optionalText(100),
            approved_date: stringOrNumber.optional(),
            order_date: stringOrNumber.optional(),
            price: z
              .object({
                value: z.number().finite().nonnegative(),
                currency_code: currencyCode,
                currency_value: currencyCode,
              })
              .passthrough(),
            hotmart_fee: z
              .object({ total: z.number().finite().nonnegative() })
              .passthrough()
              .optional(),
            origin: z
              .object({
                sck: optionalText(4_000),
                xcod: optionalText(500),
              })
              .passthrough()
              .optional(),
            offer: z
              .object({
                code: optionalText(200),
                name: optionalText(500),
              })
              .passthrough()
              .optional(),
            order_bump: z
              .object({ is_order_bump: z.boolean().optional() })
              .passthrough()
              .optional(),
          })
          .passthrough(),
        commissions: z
          .array(
            z
              .object({
                value: z.number().finite().nonnegative().optional(),
                source: optionalText(100),
                currency_code: currencyCode,
                currency_value: currencyCode,
              })
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

const normalizedEventTypes = {
  PURCHASE_APPROVED: "PURCHASE_APPROVED",
  PURCHASE_COMPLETE: "PURCHASE_COMPLETED",
  PURCHASE_COMPLETED: "PURCHASE_COMPLETED",
  PURCHASE_REFUNDED: "PURCHASE_REFUNDED",
} as const;

export type HotmartWebhookEnvelope = z.infer<typeof hotmartEnvelopeSchema>;

export type NormalizedHotmartWebhookEvent = {
  externalEventId: string;
  externalTransactionId: string;
  eventType:
    | "PURCHASE_APPROVED"
    | "PURCHASE_COMPLETED"
    | "PURCHASE_REFUNDED";
  eventAt: string;
  productExternalId: string;
  productName: string;
  grossAmount: number;
  netAmount: number;
  currency: string;
  payload: Record<string, unknown>;
};

function eventDate(value: string | number | undefined) {
  if (value === undefined) throw new Error("missing date");
  const numeric = typeof value === "number" || /^\d+$/.test(value);
  const timestamp = numeric ? Number(value) : value;
  const normalized =
    typeof timestamp === "number" && timestamp < 1_000_000_000_000
      ? timestamp * 1_000
      : timestamp;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  return date.toISOString();
}

export function parseHotmartWebhookPayload(input: unknown) {
  const parsed = hotmartPayloadSchema.parse(input);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function normalizeHotmartWebhookEvent(
  envelope: HotmartWebhookEnvelope,
): NormalizedHotmartWebhookEvent | null {
  const eventType =
    normalizedEventTypes[
      envelope.event as keyof typeof normalizedEventTypes
    ];
  if (!eventType) return null;

  const event = hotmartEventSchema.parse(envelope);
  const purchase = event.data.purchase;
  const transaction = purchase.transaction;
  const externalEventId = event.id
    ? String(event.id)
    : `${event.event}:${transaction}`;
  const eventAt = eventDate(
    eventType === "PURCHASE_REFUNDED"
      ? event.creation_date ?? purchase.approved_date ?? purchase.order_date
      : purchase.approved_date ?? purchase.order_date ?? event.creation_date,
  );

  const currency = (purchase.price.currency_code ?? purchase.price.currency_value ?? "BRL").toUpperCase();
  const matchingCommissions = (event.data.commissions ?? []).filter(commission =>
    (commission.currency_code ?? commission.currency_value ?? currency).toUpperCase() === currency);
  const producerCommissions = matchingCommissions.filter(
    (commission) => commission.source?.toUpperCase() === "PRODUCER",
  );
  const hasProducerCommission = producerCommissions.some(
    (commission) => commission.value !== undefined,
  );
  const producerNet = producerCommissions.reduce(
    (sum, commission) => sum + (commission.value ?? 0),
    0,
  );
  const grossAmount = purchase.price.value;
  const netAfterFee = purchase.hotmart_fee
    ? Math.max(grossAmount - purchase.hotmart_fee.total, 0)
    : null;
  const netAmount = hasProducerCommission
    ? producerNet
    : netAfterFee ?? grossAmount;
  const netAmountSource = hasProducerCommission
    ? "producer_commission"
    : netAfterFee !== null
      ? "gross_minus_hotmart_fee"
      : "gross_fallback";

  const payload: Record<string, unknown> = {
    product_external_id: String(event.data.product.id),
    source_event_type: event.event,
    net_amount_source: netAmountSource,
    product_name: event.data.product.name ?? String(event.data.product.id),
  };
  const buyer = record(event.data.buyer);
  const contact = {
    name: text(buyer.name || [buyer.first_name, buyer.last_name].filter(Boolean).join(" ")).slice(0, 300),
    email: text(buyer.email).toLowerCase().slice(0, 254),
    phone: text(buyer.checkout_phone || buyer.phone).replace(/[^\d+]/g, "").slice(0, 40),
  };
  if (contact.name || contact.email || contact.phone) payload.contact = contact;
  const platformCommissions = matchingCommissions.filter(commission =>
    ["MARKETPLACE", "HOTMART"].includes(commission.source?.toUpperCase() ?? "") && commission.value !== undefined);
  const fee = purchase.hotmart_fee?.total ?? (platformCommissions.length
    ? platformCommissions.reduce((sum, item) => sum + (item.value ?? 0), 0) : null);
  payload.financial = {
    gross: grossAmount, platform_fee: fee,
    net_after_fees: fee === null ? null : Math.round((grossAmount - fee) * 100) / 100,
    payout: hasProducerCommission ? netAmount : null,
    payout_source: netAmountSource,
    commissions: (event.data.commissions ?? []).map(item => ({
      source: item.source, value: item.value, currency: item.currency_code ?? item.currency_value ?? currency,
    })),
  };
  const payment = record(purchase.payment);
  payload.payment = { type: text(payment.type), installments: payment.installments_number ?? null };
  if (event.data.product.ucode) {
    payload.product_ucode = event.data.product.ucode;
  }
  if (purchase.status) payload.purchase_status = purchase.status;
  if (purchase.offer?.code || purchase.offer?.name) {
    payload.offer = {
      ...(purchase.offer.code ? { code: purchase.offer.code } : {}),
      ...(purchase.offer.name ? { name: purchase.offer.name } : {}),
    };
  }
  if (purchase.order_bump?.is_order_bump !== undefined) {
    payload.is_order_bump = purchase.order_bump.is_order_bump;
  }
  if (purchase.origin) {
    const attribution = saleAttribution(purchase.origin, String(event.data.product.id));
    payload.attribution = {
      ...(purchase.origin.sck ? { sck: purchase.origin.sck } : {}),
      ...(purchase.origin.xcod ? { xcod: purchase.origin.xcod } : {}),
      utm: { source: attribution.source, medium: attribution.medium, campaign: attribution.campaign,
        content: attribution.content, term: attribution.term, id: attribution.id },
      ...(attribution.page ? { landing_url: attribution.page } : {}),
    };
  }

  return {
    externalEventId,
    externalTransactionId: transaction,
    eventType,
    eventAt,
    productExternalId: String(event.data.product.id),
    productName: event.data.product.name ?? String(event.data.product.id),
    grossAmount,
    netAmount,
    currency,
    payload,
  };
}

export type JsonObject = Record<string, unknown>;

export const acceptedHublaEvents = new Set([
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

export function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown, maxLength = 10_000) {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return text.slice(0, maxLength);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function statusTimestamp(invoice: JsonObject, status: string) {
  const match = arrayValue(invoice.statusAt)
    .map(objectValue)
    .find((entry) => stringValue(entry.status, 120) === status);
  return stringValue(match?.when, 100);
}

function eventTimestamp(type: string, event: JsonObject) {
  const invoice = objectValue(event.invoice);
  const subscription = objectValue(event.subscription);
  const lead = objectValue(event.lead);
  const byType: Record<string, string> = {
    "invoice.payment_succeeded": statusTimestamp(invoice, "paid"),
    "invoice.payment_failed": statusTimestamp(invoice, "overdue"),
    "invoice.refunded": statusTimestamp(invoice, "refunded"),
    "subscription.created": stringValue(subscription.createdAt, 100),
    "subscription.activated": stringValue(subscription.activatedAt, 100),
    "subscription.deactivated": stringValue(subscription.inactivatedAt, 100),
    "subscription.renewal_disabled": stringValue(
      subscription.deactivatedAutoRenewAt,
      100,
    ),
    "lead.abandoned_checkout": stringValue(lead.createdAt, 100),
  };
  const nestedCandidates = Object.values(event).flatMap((value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((entry) => {
      const object = objectValue(entry);
      return [object.occurredAt, object.modifiedAt, object.updatedAt, object.createdAt];
    });
  });
  const candidates = [
    byType[type],
    invoice.modifiedAt,
    invoice.createdAt,
    subscription.modifiedAt,
    subscription.createdAt,
    lead.createdAt,
    event.occurredAt,
    event.modifiedAt,
    event.updatedAt,
    event.createdAt,
    ...nestedCandidates,
  ];
  for (const value of candidates) {
    const candidate = stringValue(value, 100);
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function safeUrl(value: unknown) {
  const raw = stringValue(value, 8_192);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function contactPayload(source: JsonObject) {
  const firstName = stringValue(source.firstName, 150);
  const lastName = stringValue(source.lastName, 150);
  const fullName = stringValue(source.fullName, 300)
    || [firstName, lastName].filter(Boolean).join(" ");
  const email = stringValue(source.email, 254).toLowerCase();
  const phone = stringValue(source.phone, 40);
  const externalId = stringValue(source.id, 300);
  if (!fullName && !email && !phone && !externalId) return null;
  return {
    ...(externalId ? { external_id: externalId } : {}),
    ...(fullName ? { name: fullName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function attributionPayload(session: JsonObject) {
  const sessionUtm = objectValue(session.utm);
  const landingUrl = safeUrl(session.url);
  let url: URL | null = null;
  try {
    url = landingUrl ? new URL(landingUrl) : null;
  } catch {
    url = null;
  }
  const utm = {
    source: stringValue(
      sessionUtm.source || url?.searchParams.get("utm_source"),
      500,
    ),
    medium: stringValue(
      sessionUtm.medium || url?.searchParams.get("utm_medium"),
      1_000,
    ),
    campaign: stringValue(
      sessionUtm.campaign || url?.searchParams.get("utm_campaign"),
      2_000,
    ),
    content: stringValue(
      sessionUtm.content || url?.searchParams.get("utm_content"),
      4_000,
    ),
    term: stringValue(
      sessionUtm.term || url?.searchParams.get("utm_term"),
      1_000,
    ),
    id: stringValue(url?.searchParams.get("utm_id"), 500),
  };
  const cookies = objectValue(session.cookies);
  const identifiers = {
    hb_id: stringValue(cookies.hbId, 300),
    fbp: stringValue(cookies.fbp, 500),
    fbclid: stringValue(cookies.fbclid, 2_000),
    src: stringValue(url?.searchParams.get("src"), 1_000),
  };
  if (
    !landingUrl &&
    !Object.values(utm).some(Boolean) &&
    !Object.values(identifiers).some(Boolean)
  ) {
    return null;
  }
  return {
    ...(landingUrl ? { landing_url: landingUrl } : {}),
    utm: Object.fromEntries(Object.entries(utm).filter(([, value]) => value)),
    identifiers: Object.fromEntries(
      Object.entries(identifiers).filter(([, value]) => value),
    ),
  };
}

export function normalizeHublaWebhookPayload(payload: JsonObject) {
  const type = stringValue(payload.type, 120);
  const event = objectValue(payload.event);
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(type) || Object.keys(event).length === 0) {
    return { error: "unsupported" as const };
  }

  const parsedEventAt = eventTimestamp(type, event);
  const eventAt = parsedEventAt ?? new Date().toISOString();
  const knownEvent = acceptedHublaEvents.has(type);

  const invoice = objectValue(event.invoice);
  const subscription = objectValue(event.subscription);
  const lead = objectValue(event.lead);
  const user = objectValue(event.user);
  const product = Object.keys(objectValue(event.product)).length > 0
    ? objectValue(event.product)
    : objectValue(arrayValue(event.products)[0]);
  const lastInvoice = objectValue(subscription.lastInvoice);
  const amount = objectValue(
    Object.keys(invoice).length > 0
      ? invoice.amount
      : Object.keys(lastInvoice).length > 0
        ? lastInvoice.amount
        : lead.amount,
  );
  const grossAmount = numberValue(amount.totalCents) / 100;
  const seller = arrayValue(invoice.receivers)
    .map(objectValue)
    .find((receiver) => stringValue(receiver.role, 100).toLowerCase() === "seller");
  const netAmount = seller ? numberValue(seller.totalCents) / 100 : grossAmount;
  const entity = Object.keys(invoice).length > 0
    ? invoice
    : Object.keys(subscription).length > 0
      ? subscription
      : Object.keys(lead).length > 0
        ? lead
        : user;
  const entityId = stringValue(entity.id, 300);
  const currency = stringValue(
    invoice.currency || lastInvoice.currency || lead.currency,
    3,
  ).toUpperCase() || "BRL";
  const contactSource = Object.keys(lead).length > 0
    ? lead
    : Object.keys(user).length > 0
      ? user
      : objectValue(invoice.payer || subscription.payer);
  const session = Object.keys(objectValue(lead.session)).length > 0
    ? objectValue(lead.session)
    : Object.keys(objectValue(invoice.paymentSession)).length > 0
      ? objectValue(invoice.paymentSession)
      : objectValue(subscription.firstPaymentSession);
  const contact = contactPayload(contactSource);
  const attribution = attributionPayload(session);
  const firstOffer = objectValue(arrayValue(product.offers)[0]);
  const status = stringValue(
    invoice.status || subscription.status || lead.status,
    120,
  );
  const entityVersion = Number(entity.version);

  return {
    value: {
      type,
      knownEvent,
      contractVersion: stringValue(payload.version, 40) || null,
      eventAt,
      entityId: entityId || null,
      entityVersion: Number.isInteger(entityVersion) ? entityVersion : null,
      productExternalId: stringValue(product.id, 300) || null,
      productName: stringValue(product.name, 500) || null,
      grossAmount,
      netAmount,
      currency,
      payload: {
        type,
        known_event: knownEvent,
        event_time_inferred: !parsedEventAt,
        ...(status ? { status } : {}),
        entity: {
          id: entityId || null,
          version: Number.isInteger(entityVersion) ? entityVersion : null,
        },
        product: {
          id: stringValue(product.id, 300) || null,
          name: stringValue(product.name, 500) || null,
        },
        ...(firstOffer.id || firstOffer.name
          ? {
              offer: {
                id: stringValue(firstOffer.id, 300) || null,
                name: stringValue(firstOffer.name, 500) || null,
              },
            }
          : {}),
        ...(contact ? { contact } : {}),
        ...(attribution ? { attribution } : {}),
      },
    },
  };
}

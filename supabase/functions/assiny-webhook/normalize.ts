type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const cents = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < 100_000_000_000_000 ? Number(value) : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Assiny's documented envelope and item amounts. This is independent of other gateways.
// Units must be confirmed on the connection; never guess them from magnitude.
export function normalizeAssinyPayload(payload: ObjectValue, input: unknown) {
  const contract = object(input);
  if (contract.version !== 1 || contract.amountUnit !== "cents") return { reason: "awaiting_contract" };
  const data = object(payload.data), transaction = object(data.transaction), offer = object(data.offer);
  const eventName = text(payload.event, 120);
  const statuses: Record<string, string> = { approved_purchase: "paid", refunded_purchase: "refunded", chargeback_purchase: "chargeback",
    abandoned_checkout: "abandoned", abandoned_purchase: "abandoned", pending_purchase: "pending", denied_purchase: "failed", expired_purchase: "expired" };
  const status = statuses[eventName];
  if (!status) return { reason: "unsupported_event" };
  if ((status === "paid" && transaction.status !== "paid") || (status === "refunded" && transaction.status !== "refunded")) return { reason: "status_mismatch" };
  const sourceProject = text(object(transaction.project).id || offer.project_id);
  if (contract.sourceProjectId && sourceProject && sourceProject !== contract.sourceProjectId) return { reason: "source_project_mismatch" };
  const currency = text(transaction.currency || (status === "abandoned" ? "BRL" : ""));
  if (!/^[A-Z]{3}$/.test(currency)) return { reason: "invalid_currency" };
  const financialEvent = ["paid", "refunded", "chargeback"].includes(status);
  const rawTime = transaction.updated_at || transaction.created_at || data.created_at;
  const dateString = typeof rawTime === "string" ? rawTime : object(rawTime).Valid === true ? text(object(rawTime).Time) : "";
  const time = typeof dateString === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateString) ? Date.parse(dateString) : NaN;
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 86_400_000) return { reason: "invalid_timestamp" };
  if (offer.order_bumps != null && !Array.isArray(offer.order_bumps)) return { reason: "invalid_items" };
  const sourceItems = [offer, ...(Array.isArray(offer.order_bumps) ? offer.order_bumps : [])];
  if (sourceItems.length > 50) return { reason: "invalid_items" };
  const reportedGross = cents(transaction.amount);
  const chargedTotals = sourceItems.map(value=>cents(object(value).amount_with_tax));
  const useChargedAmounts = financialEvent && chargedTotals.every(value=>value!==null) &&
    chargedTotals.reduce<number>((sum,value)=>sum+value!,0)===reportedGross;
  const items = sourceItems.map((value, index) => {
    const item = object(value), product = object(item.product);
    const base = cents(index === 0 ? item.amount : item.product_price ?? item.amount);
    const gross = useChargedAmounts ? chargedTotals[index] : base;
    const fee = cents(item.amount_assiny), net = cents(item.amount_client);
    return { product_external_id: text(product.id), product_name: text(product.name), quantity: 1,
      gross, base, fee, net, is_order_bump: index > 0, offer_id: text(item.id), offer_name: text(item.name) };
  });
  if (items.some(item => !uuid.test(item.product_external_id) || !item.product_name || item.gross === null) ||
    new Set(items.map(item => item.product_external_id)).size !== items.length) return { reason: "invalid_items" };
  const gross = financialEvent ? cents(transaction.amount) : items.reduce((sum, item) => sum + item.gross!, 0);
  const fee = cents(transaction.fee_amount), net = cents(transaction.net_amount);
  if (gross === null || gross !== items.reduce((sum, item) => sum + item.gross!, 0)) return { reason: "item_total_mismatch" };
  // No proportional allocation of invoice fees or payouts to items.
  if (financialEvent && (fee === null || net === null || fee + net !== gross || items.some(item =>
    item.fee === null || item.net === null || item.fee + item.net !== item.gross) ||
    items.reduce((sum, item) => sum + item.fee!, 0) !== fee || items.reduce((sum, item) => sum + item.net!, 0) !== net)) return { reason: "financial_reconciliation_failed" };
  const client = object(data.client), metadata = object(data.metadata), params = object(metadata.url_parameters);
  let transactionId = text(transaction.id, 300), externalKind = "invoice";
  if (!transactionId && status === "abandoned") {
    const identity = text(client.id) || text(client.email, 254).toLowerCase() || text(client.phone, 40);
    if (!identity || !uuid.test(text(offer.id))) return { reason: "missing_checkout_identity" };
    transactionId = `lead:${text(offer.id)}:${identity}:${new Date(time).toISOString()}`;
    externalKind = "lead";
  } else if (!uuid.test(transactionId)) return { reason: "invalid_transaction" };
  if (transactionId.length > 300) return { reason: "invalid_transaction" };
  const utm = Object.fromEntries(["source", "medium", "campaign", "content", "term", "id"].map(key =>
    [key, text(metadata[`utm_${key}`], 4000) || text(params[`utm_${key}`], 4000)]).filter(([, value]) => value));
  const identifiers = Object.fromEntries(["fbclid", "fbp", "trk_ad", "trk_adgp", "trk_cpg", "trk_src"].map(key =>
    [key, text(metadata[key], 2000) || text(params[key], 2000)]).filter(([, value]) => value));
  const cleanUrl = (value: unknown) => { try { const url = new URL(text(value, 8192)); if (!/^https?:$/.test(url.protocol)) return undefined;
    url.username = ""; url.password = ""; url.hash = ""; return url.toString(); } catch { return undefined; } };
  const commissions = Array.isArray(transaction.commissions) ? transaction.commissions.map(value => {
    const commission = object(value); return { recipient: text(commission.user), type: text(commission.type), amount: cents(commission.amount) }; }) : [];
  const payout = text(contract.payoutRecipient) ? commissions.filter(c=>c.recipient===contract.payoutRecipient).reduce((sum,c)=>sum+(c.amount ?? 0),0) : null;
  const reportedPayout = payout !== null && commissions.some(c=>c.recipient===contract.payoutRecipient) ? payout : null;
  return { value: { provider: "assiny", contract_version: 1, sandbox: payload.test === true, source_event: eventName, status,
    transaction_id: transactionId, external_kind: externalKind, occurred_at: new Date(time).toISOString(), currency,
    product_external_id: items[0].product_external_id, product_name: items[0].product_name,
    financial: { gross: gross / 100, platform_fee: financialEvent ? fee! / 100 : null, net_after_fees: financialEvent ? net! / 100 : null,
      payout: reportedPayout === null ? null : reportedPayout / 100, payout_source: reportedPayout === null ? "unknown" : "seller_receiver",
      commissions: commissions.map(c=>({...c, amount:c.amount===null?null:c.amount/100})) },
    items: items.map(item => ({ product_external_id: item.product_external_id, product_name: item.product_name, quantity: 1,
      is_order_bump: item.is_order_bump, offer_id: item.offer_id, offer_name: item.offer_name,
      financial: { gross: item.gross! / 100, listed_price: item.base===null?null:item.base/100, platform_fee: financialEvent ? item.fee! / 100 : null, net_after_fees: financialEvent ? item.net! / 100 : null, payout: null, payout_source: "unknown" } })),
    contact: { name: text(client.full_name), email: text(client.email,254).toLowerCase(), phone: text(client.phone,40) },
    // Assiny's event_source_url is the checkout URL, not proof of a landing-page visit.
    attribution: { utm, identifiers, ...(cleanUrl(params.page_url) ? { landing_url: cleanUrl(params.page_url) } : {}) },
    checkout_url: cleanUrl(metadata.event_source_url), offer: { id: text(offer.id), name: text(offer.name) },
    payment: { type: text(transaction.payment_type), installments: object(transaction.smart_installment).total_installments ?? transaction.installments ?? null } } };
}

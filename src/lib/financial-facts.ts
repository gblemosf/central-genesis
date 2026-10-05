import { record, text } from "@/lib/sales-attribution";

export interface FinancialRecord {
  gross_amount?: unknown;
  net_amount?: unknown;
  payload?: unknown;
  event_type?: unknown;
}

export type FinancialEvent = FinancialRecord;

export interface FinancialItemRecord {
  product_id?: unknown;
  gross_amount?: unknown;
  net_amount?: unknown;
  products?: unknown;
}

export interface FinancialFacts {
  gross: number | null;
  fee: number | null;
  afterFees: number | null;
  payout: number | null;
  payoutSource: string;
}

const payoutSources = new Set([
  "producer_commission",
  "seller_receiver",
  "payt_reported",
]);

function supplied(value: unknown) {
  return value !== null && value !== undefined &&
    !(typeof value === "string" && value.trim() === "");
}

// Compare cents, so an ordinary floating-point subtraction cannot create a
// reconciliation error. A negative ledger amount is valid only for a reversal.
function cents(value: unknown, reversal: boolean): number | null {
  if (!supplied(value) || (typeof value !== "number" && typeof value !== "string")) return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (!reversal && number < 0)) return null;
  const rounded = Math.round((Math.abs(number) + Number.EPSILON) * 100);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

export function financialFacts(event: FinancialRecord): FinancialFacts {
  const payload = record(event.payload);
  const financial = record(payload.financial);
  const reversal = event.event_type === "PURCHASE_REFUNDED" || event.event_type === "PURCHASE_CHARGEBACK";
  const sign = reversal ? -1 : 1;
  const signed = (value: number | null) => value === null ? null : value === 0 ? 0 : sign * value / 100;
  const payoutSource = text(financial.payout_source || payload.net_amount_source);
  const ledgerGross = cents(event.gross_amount, reversal);
  const reportedGross = cents(financial.gross, reversal);
  let gross = supplied(event.gross_amount) ? ledgerGross : reportedGross;
  const grossConflict = (supplied(event.gross_amount) && ledgerGross === null) ||
    (supplied(financial.gross) && reportedGross === null) ||
    (ledgerGross !== null && reportedGross !== null && ledgerGross !== reportedGross);
  if (grossConflict) gross = null;

  let fee = cents(financial.platform_fee, reversal);
  const reportedNet = cents(financial.net_after_fees, reversal);
  let afterFees = supplied(financial.net_after_fees)
    ? reportedNet
    : gross !== null && fee !== null ? gross - fee : null;
  const financialConflict = grossConflict ||
    (supplied(financial.platform_fee) && fee === null) ||
    (supplied(financial.net_after_fees) && reportedNet === null) ||
    (gross !== null && fee !== null && fee > gross) ||
    (gross !== null && reportedNet !== null && reportedNet > gross) ||
    (gross !== null && fee !== null && reportedNet !== null && gross - fee !== reportedNet);
  if (financialConflict) {
    fee = null;
    afterFees = null;
  }

  // net_amount historically meant producer payout for some gateways and
  // post-fee revenue for others. It is never an implicit net revenue source.
  let payout = payoutSource === "gross_fallback" ? null : supplied(financial.payout)
    ? cents(financial.payout, reversal)
    : payoutSources.has(payoutSource) ? cents(event.net_amount, reversal) : null;
  if (grossConflict || (payout !== null && gross !== null && payout > gross) ||
    (payout !== null && afterFees !== null && payout > afterFees)) payout = null;

  return {
    gross: signed(gross),
    fee: signed(fee),
    afterFees: signed(afterFees),
    payout: signed(payout),
    payoutSource,
  };
}

function externalId(item: FinancialItemRecord) {
  const product = record(Array.isArray(item.products) ? item.products[0] : item.products);
  return text(product.external_id);
}

export function itemFinancialFacts(
  event: FinancialRecord,
  item: FinancialItemRecord,
  allItems: readonly FinancialItemRecord[],
): FinancialFacts {
  const payload = record(event.payload);
  const unknown = financialFacts({ event_type: event.event_type, gross_amount: item.gross_amount });
  if (allItems.length === 1 && !Array.isArray(payload.items)) return financialFacts(event);
  if (payload.contract_version !== 1 || !Array.isArray(payload.items) ||
    !allItems.length || payload.items.length !== allItems.length) return unknown;

  const normalized = payload.items.map(record);
  const storedIds = allItems.map(externalId);
  const catalogIds = allItems.map(value => text(value.product_id));
  const normalizedIds = normalized.map(value => text(value.product_external_id));
  const id = externalId(item);
  // Require a complete one-to-one match. Never assign the first product's
  // amounts to an unmatched bump, or duplicate an invoice total across items.
  if (!id || storedIds.some(value => !value) || catalogIds.some(value => !value) ||
    new Set(storedIds).size !== allItems.length || new Set(catalogIds).size !== allItems.length ||
    new Set(normalizedIds).size !== allItems.length ||
    normalizedIds.some(value => !value || !storedIds.includes(value)) ||
    !allItems.some(value => text(value.product_id) === text(item.product_id) && externalId(value) === id)) return unknown;

  const match = normalized.find(value => text(value.product_external_id) === id)!;
  return financialFacts({
    event_type: event.event_type,
    gross_amount: item.gross_amount,
    net_amount: item.net_amount,
    payload: { financial: match.financial },
  });
}

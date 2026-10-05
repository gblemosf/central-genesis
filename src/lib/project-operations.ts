import {
  record,
  safeWebUrl,
  saleAttribution,
  text,
  type SaleAttribution,
} from "@/lib/sales-attribution";
import { financialFacts } from "@/lib/financial-facts";

export interface SaleRow {
  catalogProductId?: string;
  id: string;
  transaction: string;
  connectionId: string;
  provider: string;
  productId: string;
  product: string;
  occurredAt: string;
  receivedAt: string;
  status: "paid" | "refunded" | "reversed" | "partial_refund";
  contactId: string | null;
  name: string;
  email: string;
  phone: string;
  currency: string;
  gross: number;
  fee: number | null;
  afterFees: number | null;
  payout: number | null;
  payoutSource: string;
  orderBump: boolean;
  paymentMethod: string;
  installments: string;
  offer: string;
  attribution: SaleAttribution;
}

export interface OperationContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  createdAt: string;
  lastSeenAt: string;
}
export interface RecoveryRow {
  catalogProductId?: string;
  id: string;
  contactId: string | null;
  name: string;
  email: string;
  phone: string;
  provider: string;
  product: string;
  status: string;
  amount: number;
  currency: string;
  source: string;
  campaign: string;
  checkoutUrl: string | null;
  lastSeenAt: string;
}
export interface ProjectOperations {
  sales: SaleRow[];
  contacts: OperationContact[];
  recovery: RecoveryRow[];
  currency: string;
  loadedAt: string;
}

function relation(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value);
}
function amount(value: unknown): number | null {
  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

export function saleFromRecord(row: Record<string, unknown>): SaleRow {
  const payload = record(row.payload);
  const facts = financialFacts(row);
  const contact = { ...record(payload.contact), ...relation(row.contacts) };
  const connection = relation(row.integration_connections);
  const item = relation(row.sales_event_items);
  const productId = text(
    payload.product_external_id || record(payload.product).id,
  );
  const isRefund = row.event_type === "PURCHASE_REFUNDED";
  return {
    id: text(row.id),
    catalogProductId: text(item.product_id || row.product_id),
    transaction: text(row.external_transaction_id || row.external_event_id),
    connectionId: text(row.connection_id),
    provider: text(connection.provider),
    productId,
    product:
      text(
        item.product_name_snapshot ||
          payload.product_name ||
          record(payload.product).name ||
          productId,
      ) || "Produto não identificado",
    occurredAt: text(row.event_at),
    receivedAt: text(row.created_at),
    status: isRefund ? "refunded" : "paid",
    contactId: text(row.contact_id) || null,
    name: text(contact.name),
    email: text(contact.email),
    phone: text(contact.phone),
    currency: text(row.currency) || "BRL",
    gross: facts.gross ?? 0,
    fee: facts.fee,
    afterFees: facts.afterFees,
    payout: facts.payout,
    payoutSource: facts.payoutSource,
    orderBump:
      payload.is_order_bump === true ||
      item.stage_type_snapshot === "order_bump",
    paymentMethod: text(record(payload.payment).type),
    installments: text(record(payload.payment).installments),
    offer: text(
      record(payload.offer).name ||
        record(payload.offer).code ||
        record(payload.offer).id,
    ),
    attribution: saleAttribution({
      ...record(payload.attribution),
      checkout_url: payload.checkout_url ?? record(payload.attribution).checkout_url,
    }, productId),
  };
}

// Validated gateway invoices have exact amounts per product. Legacy invoices
// stay as one row because splitting their totals would invent an allocation.
export function saleRowsFromRecord(row: Record<string, unknown>): SaleRow[] {
  const payload = record(row.payload);
  if (!['assiny', 'payt'].includes(text(payload.provider)) || payload.contract_version !== 1 || !Array.isArray(payload.items)) {
    return [saleFromRecord(row)];
  }
  const storedItems = Array.isArray(row.sales_event_items) ? row.sales_event_items.map(record) : [];
  if (storedItems.length !== payload.items.length || !storedItems.length) return [saleFromRecord(row)];
  const items = payload.items.map(record);
  const matches = items.map(item => storedItems.find(stored => text(relation(stored.products).external_id) === text(item.product_external_id)));
  if (matches.some(item => !item) || new Set(matches.map(item => item?.product_id)).size !== items.length) return [saleFromRecord(row)];
  return items.map((item, index) => {
    const stored = matches[index]!;
    const financial = record(item.financial);
    const sale = saleFromRecord({ ...row, gross_amount: stored.gross_amount, net_amount: stored.net_amount, sales_event_items: stored,
      payload: { ...payload, product_external_id: item.product_external_id, product_name: item.product_name,
        is_order_bump: item.is_order_bump, financial, offer: { id: item.offer_id, name: item.offer_name } } });
    return { ...sale, id: `${sale.id}:${text(stored.product_id)}` };
  });
}

export function recoveryFromRecord(row: Record<string, unknown>): RecoveryRow {
  const metadata = record(row.metadata);
  const contact = { ...record(metadata.contact), ...relation(row.contacts) },
    campaign = relation(row.utm_campaigns);
  return {
    id: text(row.id),
    catalogProductId: text(row.product_id),
    contactId: text(row.contact_id) || null,
    name: text(contact.name),
    email: text(contact.email),
    phone: text(contact.phone),
    provider: text(relation(row.integration_connections).provider),
    product: text(relation(row.products).name),
    status: text(row.status),
    amount: amount(row.amount) ?? 0,
    currency: text(row.currency),
    source: text(
      campaign.utm_source || record(record(metadata.attribution).utm).source,
    ),
    campaign: text(
      campaign.utm_campaign ||
        record(record(metadata.attribution).utm).campaign,
    ),
    checkoutUrl: safeWebUrl(row.checkout_url),
    lastSeenAt: text(row.last_seen_at),
  };
}

export function summarizeSales(sales: SaleRow[], currency: string) {
  const partialUnknown = sales.some(
    (sale) => sale.currency === currency && sale.status === "partial_refund",
  );
  const rows = sales.filter(
    (sale) =>
      sale.currency === currency && ["paid", "refunded"].includes(sale.status),
  );
  const paid = rows.filter((sale) => sale.status === "paid");
  const refundedTransactions = new Set(
    rows
      .filter((sale) => sale.status === "refunded")
      .map((sale) => `${sale.connectionId}:${sale.transaction}`),
  );
  const buyers = new Set(
    paid
      .filter(
        (sale) =>
          !refundedTransactions.has(`${sale.connectionId}:${sale.transaction}`),
      )
      .map((sale) => sale.contactId)
      .filter(Boolean),
  );
  const knownTotal = (key: "fee" | "afterFees" | "payout") =>
    !partialUnknown && rows.every((sale) => sale[key] !== null)
      ? Math.round(
          rows.reduce((sum, sale) => sum + (sale[key] ?? 0), 0) * 100,
        ) / 100
      : null;
  return {
    transactions: new Set(
      paid.map((sale) => `${sale.connectionId}:${sale.transaction}`),
    ).size,
    refunds: refundedTransactions.size,
    gross: paid.reduce((sum, sale) => sum + sale.gross, 0),
    refunded: -rows
      .filter((sale) => sale.status === "refunded")
      .reduce((sum, sale) => sum + sale.gross, 0),
    fee: knownTotal("fee"),
    afterFees: knownTotal("afterFees"),
    payout: knownTotal("payout"),
    buyers: buyers.size,
    unknownFinancial: rows.filter(
      (sale) => sale.afterFees === null || sale.payout === null,
    ).length,
  };
}

export function csvDocument(headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    const original = value === null || value === undefined ? "" : String(value);
    // Spreadsheet programs must not interpret user answers as formulas.
    const safe =
      typeof value === "string" && /^[\s]*[=+\-@]/.test(original)
        ? `'${original}`
        : original;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")
  );
}

import { cents, object, paytTime, paytTracking, text, type PaytObject } from "./v1-data.ts";

function eventStatus(root: string, payment: string) {
  if (["refunded", "one_click_buy_refunded"].includes(payment)) return "refunded";
  if (payment === "chargeback") return "chargeback";
  if (["refunded_partial", "one_click_buy_refunded_partial"].includes(payment)) return "partial_refund";
  if (root === "refund_requested" || ["peding_refund", "pending_refund", "chargeback_presented"].includes(payment)) return "notification";
  if (root === "lost_cart") return "abandoned";
  if (root === "expired" || payment === "expired") return "expired";
  if (root === "canceled" || ["refused", "canceled", "one_click_buy_refused"].includes(payment)) return "failed";
  if (payment === "paid" && ["paid", "billed", "separation", "collected", "shipping", "shipped", "subscription_renewed"].includes(root)) return "paid";
  if (root === "waiting_payment" && payment === "waiting_payment") return "pending";
  return null;
}

// PayT V1, independently verified against its linked postback specification and
// account deliveries. Product codes identify products; bump codes identify offers.
export function normalizePaytV1(payload: PaytObject, config: PaytObject) {
  if (config.amountUnit !== "cents" || config.timezone !== "America/Sao_Paulo" || config.currency !== "BRL") return { reason: "awaiting_contract" };
  if (typeof payload.test !== "boolean") return { reason: "invalid_test_flag" };
  const transaction = object(payload.transaction), sourceStatus = text(payload.status, 120);
  const status = eventStatus(sourceStatus, text(transaction.payment_status, 120));
  if (status === "notification") return { reason: "non_financial_event" };
  if (status === "partial_refund") return { reason: "partial_refund_requires_review" };
  if (!status) return { reason: "unknown_status" };
  const financialEvent = ["paid", "refunded", "chargeback"].includes(status);
  const transactionId = text(payload.transaction_id, 301) || (status === "abandoned" ? text(payload.cart_id, 301) : "");
  if (!transactionId || transactionId.length > 300) return { reason: "invalid_transaction" };
  const occurredAt = paytTime(payload.updated_at, config.timezone);
  if (!occurredAt) return { reason: "invalid_timestamp" };
  if (payload.order_bumps != null && !Array.isArray(payload.order_bumps)) return { reason: "invalid_items" };
  const bumpOffers = Array.isArray(payload.order_bumps) ? payload.order_bumps.map(object) : [];
  const sourceItems = [object(payload.product), ...bumpOffers.map(bump => object(bump.product))];
  if (sourceItems.length > 50) return { reason: "invalid_items" };
  const items = sourceItems.map((item, index) => ({ product_external_id: text(item.code, 301), product_name: text(item.name),
    quantity: item.quantity, price: cents(item.price), is_order_bump: index > 0,
    offer_id: index > 0 ? text(bumpOffers[index - 1].code) : "", offer_name: index > 0 ? text(bumpOffers[index - 1].name) : text(object(payload.link).title) }));
  if (items.some(item => !item.product_external_id || item.product_external_id.length > 300 || !item.product_name || item.price === null || item.quantity !== 1) ||
    new Set(items.map(item => item.product_external_id)).size !== items.length) return { reason: "invalid_items" };
  const listedTotal = items.reduce((sum, item) => sum + item.price!, 0);
  const gross = financialEvent ? cents(transaction.total_price) : cents(transaction.total_price) ?? listedTotal;
  if (gross === null) return { reason: "invalid_amount" };
  const commissions = Array.isArray(payload.commission) ? payload.commission.map(value => {
    const c = object(value); return { type: text(c.type), recipient: text(c.name), amount: cents(c.amount) };
  }) : [];
  const financialOrigin = ["refunded", "chargeback"].includes(status) && gross === 0 ? "original_sale" : "reported";
  if (financialEvent && financialOrigin === "reported" && !payload.test && (!commissions.length || commissions.some(c => c.amount === null ||
    !["platform", "producer", "coproducer", "affiliate", "affiliation"].includes(c.type)) ||
    !commissions.some(c => c.type === "platform") || commissions.reduce((sum, c) => sum + c.amount!, 0) !== gross)) return { reason: "commission_total_mismatch" };
  const fee = financialEvent ? commissions.filter(c => c.type === "platform").reduce((sum, c) => sum + (c.amount ?? 0), 0) : null;
  if (fee !== null && fee > gross) return { reason: "invalid_financial_detail" };
  const net = fee === null ? null : gross - fee;
  const payout = financialEvent && financialOrigin === "reported" && config.payoutScope === "producer_group"
    ? commissions.filter(c => ["producer", "coproducer"].includes(c.type)).reduce((sum, c) => sum + (c.amount ?? 0), 0) : null;
  const invoiceOnly = items.length > 1;
  const tracking = paytTracking(payload), customer = object(payload.customer);
  return { value: { provider: "payt", contract_version: 1, source_schema: "payt-v1", sandbox: payload.test,
    source_event: sourceStatus, source_status: sourceStatus, status, transaction_id: transactionId,
    external_kind: status === "abandoned" && !payload.transaction_id ? "lead" : "invoice", occurred_at: occurredAt, currency: "BRL",
    product_external_id: items[0].product_external_id, product_name: items[0].product_name,
    financial_origin: financialOrigin, financial_scope: invoiceOnly ? "invoice" : "items",
    financial: { gross: gross / 100, platform_fee: fee === null ? null : fee / 100, net_after_fees: net === null ? null : net / 100,
      payout: payout === null ? null : payout / 100, payout_source: payout === null ? "unknown" : "producer_group_commission", payout_scope: "producer_group",
      commissions: commissions.map(c => ({ ...c, amount: c.amount === null ? null : c.amount / 100 })),
      ...(invoiceOnly ? { reconciliation: { kind: "invoice_only", gross_delta: (gross - listedTotal) / 100 } } : {}) },
    items: items.map(item => ({ ...item, quantity: 1, price: undefined,
      financial: { gross: (invoiceOnly ? item.price! : gross) / 100, listed_price: item.price! / 100,
        platform_fee: invoiceOnly || fee === null ? null : fee / 100, net_after_fees: invoiceOnly || net === null ? null : net / 100, payout: null, payout_source: "unknown" } })),
    contact: { name: text(customer.name), email: customer.fake_email === true ? "" : text(customer.email, 254).toLowerCase(), phone: text(customer.phone, 40) },
    attribution: tracking.attribution, checkout_url: tracking.checkout, offer: { id: "", name: text(object(payload.link).title) },
    payment: { type: text(transaction.payment_method, 100), installments: typeof transaction.installments === "number" ? transaction.installments : null },
  } };
}

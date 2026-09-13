import { z } from "zod";
import { normalizeHotmartWebhookEvent } from "@/lib/hotmart-webhook";
import { record, text } from "@/lib/sales-attribution";

export const historyStatuses = [
  "APPROVED",
  "COMPLETE",
  "REFUNDED",
  "CHARGEBACK",
  "PARTIALLY_REFUNDED",
  "STARTED",
  "PRINTED_BILLET",
  "WAITING_PAYMENT",
  "UNDER_ANALISYS",
  "CANCELLED",
  "PROTESTED",
  "BLOCKED",
  "OVERDUE",
  "EXPIRED",
] as const;
export const historyStatusLabels: Record<string, string> = {
  APPROVED: "Aprovada",
  COMPLETE: "Concluída",
  REFUNDED: "Reembolsada",
  CHARGEBACK: "Chargeback",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  STARTED: "Iniciada",
  PRINTED_BILLET: "Boleto gerado",
  WAITING_PAYMENT: "Aguardando pagamento",
  UNDER_ANALISYS: "Em análise",
  CANCELLED: "Cancelada",
  PROTESTED: "Contestada",
  BLOCKED: "Bloqueada",
  OVERDUE: "Vencida",
  EXPIRED: "Expirada",
};
export const historyRequestSchema = z
  .object({
    productId: z.uuid(),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((v) => v.start <= v.end, "A data inicial deve ser anterior à final.")
  .refine(
    (v) =>
      v.end <=
      new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
    "Não selecione datas futuras.",
  );

export type HistoryCursor = {
  statusIndex: number;
  windowStart: number;
  pageToken?: string;
};
export function historyWindow(cursor: HistoryCursor, end: number) {
  return {
    start: cursor.windowStart,
    end: Math.min(end, cursor.windowStart + 30 * 86400_000 - 1),
  };
}
export function nextHistoryCursor(
  cursor: HistoryCursor,
  end: number,
  token?: string,
): HistoryCursor | null {
  if (token) {
    if (token === cursor.pageToken)
      throw new Error(
        "A Hotmart repetiu a página; a importação foi interrompida para evitar um ciclo.",
      );
    return { ...cursor, pageToken: token };
  }
  if (cursor.statusIndex + 1 < historyStatuses.length)
    return {
      ...cursor,
      statusIndex: cursor.statusIndex + 1,
      pageToken: undefined,
    };
  const window = historyWindow(cursor, end);
  return window.end < end
    ? { statusIndex: 0, windowStart: window.end + 1 }
    : null;
}

const purchaseSchema = z
  .object({
    product: z.object({
      id: z.union([z.number(), z.string()]),
      name: z.string(),
    }),
    purchase: z
      .object({
        transaction: z.string().min(1).max(300),
        status: z.enum(historyStatuses),
        order_date: z.number().positive(),
        approved_date: z.number().optional(),
        price: z.object({
          value: z.number().nonnegative(),
          currency_code: z.string().length(3),
        }),
      })
      .passthrough(),
  })
  .passthrough();

// Both API and webhooks use the same finance / attribution parser. Keep only the
// operational fields: documents, addresses and API response headers are discarded.
export function normalizeHistoryPurchase(
  input: unknown,
  commissions: unknown,
  participants: unknown,
) {
  const parsed = purchaseSchema.parse(input);
  const purchase = parsed.purchase;
  const tracking = record(purchase.tracking);
  const users = record(participants).users;
  const buyerUser = Array.isArray(users)
    ? record(users.find((u) => record(u).role === "BUYER"))
    : {};
  const buyer = { ...record(parsed.buyer), ...record(buyerUser.user) };
  const rawCommissions = record(commissions).commissions;
  const normalizedCommissions = Array.isArray(rawCommissions)
    ? rawCommissions.map((item) => {
        const entry = record(item),
          amount = record(entry.commission);
        return {
          source: entry.source,
          value: amount.value,
          currency_value: amount.currency_code || amount.currency_value,
        };
      })
    : undefined;
  const payment = record(purchase.payment);
  const event = normalizeHotmartWebhookEvent({
    event:
      purchase.status === "COMPLETE"
        ? "PURCHASE_COMPLETE"
        : "PURCHASE_APPROVED",
    id: `history:${purchase.transaction}`,
    data: {
      product: parsed.product,
      buyer: {
        name: buyer.name,
        email: buyer.email,
        phone: buyer.cellphone || buyer.phone,
      },
      commissions: normalizedCommissions,
      purchase: {
        ...purchase,
        payment: { ...payment, type: payment.type || payment.method },
        origin: {
          sck: text(tracking.source_sck),
          xcod: text(tracking.external_code),
        },
      },
    },
  });
  if (!event) throw new Error("Compra inválida.");
  event.payload.import_source = "hotmart_api";
  event.payload.tracking_source = text(tracking.source);
  event.payload.purchase_status = purchase.status;
  event.payload.order_at = new Date(purchase.order_date).toISOString();
  return {
    status: purchase.status,
    orderedAt: new Date(purchase.order_date).toISOString(),
    approvedAt: purchase.approved_date
      ? new Date(purchase.approved_date).toISOString()
      : null,
    sale: event,
  };
}
export type HistoryPurchase = ReturnType<typeof normalizeHistoryPurchase>;

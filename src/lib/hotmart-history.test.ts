import { describe, expect, it } from "vitest";
import {
  historyRequestSchema,
  historyStatuses,
  historyWindow,
  nextHistoryCursor,
  normalizeHistoryPurchase,
} from "./hotmart-history";
import { saleFromRecord, summarizeSales } from "./project-operations";

const purchase = {
  product: { id: 8304193, name: "Produto teste" },
  buyer: { name: "Pessoa teste", email: "test@example.invalid" },
  purchase: {
    transaction: "HP-test",
    status: "APPROVED",
    order_date: 1788674143000,
    approved_date: 1788674299000,
    price: { value: 47, currency_code: "BRL" },
    hotmart_fee: { total: 5.18, currency_code: "BRL" },
    tracking: {
      external_code: "dpaf6860",
      source_sck: "instagram|organic|bio|{{adset.name}}",
      source: "raw-campaign-code",
    },
    payment: { method: "PIX" },
  },
};
describe("Hotmart historical import", () => {
  it("keeps producer payout separate from fees and preserves raw source and attribution", () => {
    const row = normalizeHistoryPurchase(
      purchase,
      {
        commissions: [
          {
            source: "PRODUCER",
            commission: { value: 19.66, currency_code: "BRL" },
          },
          {
            source: "COPRODUCER",
            commission: { value: 22.16, currency_value: "BRL" },
          },
        ],
      },
      {
        users: [
          {
            role: "BUYER",
            user: {
              phone: "+5511999999999",
              documents: [{ doc: "private" }],
              address: { city: "private" },
            },
          },
        ],
      },
    );
    expect(row.sale.payload.financial).toMatchObject({
      gross: 47,
      platform_fee: 5.18,
      net_after_fees: 41.82,
      payout: 19.66,
    });
    expect(row.sale.payload.attribution).toMatchObject({
      xcod: "dpaf6860",
      utm: { source: "instagram" },
    });
    expect(row.sale.payload.tracking_source).toBe("raw-campaign-code");
    expect(row.sale.payload.payment).toMatchObject({ type: "PIX" });
    expect(JSON.stringify(row)).not.toContain("private");
  });
  it("does not subtract foreign currency fees or use other receivers as the producer", () => {
    const row = normalizeHistoryPurchase(
      {
        ...purchase,
        purchase: {
          ...purchase.purchase,
          hotmart_fee: { total: 5, currency_code: "USD" },
        },
      },
      {
        commissions: [
          {
            source: "PRODUCER",
            commission: { value: 10, currency_value: "USD" },
          },
          {
            source: "COPRODUCER",
            commission: { value: 20, currency_value: "BRL" },
          },
        ],
      },
      null,
    );
    expect(row.sale.payload.financial).toMatchObject({
      platform_fee: null,
      net_after_fees: null,
      payout: null,
    });
  });
  it("keeps nonpaid states out of the paid ledger contract and does not invent refund amounts", () => {
    const row = normalizeHistoryPurchase(
      {
        ...purchase,
        purchase: { ...purchase.purchase, status: "PARTIALLY_REFUNDED" },
      },
      null,
      null,
    );
    expect(row.status).toBe("PARTIALLY_REFUNDED");
    expect(row.sale.payload.financial).toMatchObject({ payout: null });
    expect(row.sale.payload).not.toHaveProperty("refund_amount");
  });
  it("covers adjacent windows without skipping the last millisecond and retains page tokens", () => {
    const end = 31 * 86400_000,
      cursor = { statusIndex: 0, windowStart: 0 };
    expect(historyWindow(cursor, end).end).toBe(30 * 86400_000 - 1);
    expect(nextHistoryCursor(cursor, end, "next")).toEqual({
      ...cursor,
      pageToken: "next",
    });
    expect(
      nextHistoryCursor(
        { ...cursor, statusIndex: historyStatuses.length - 1 },
        end,
      ),
    ).toEqual({ statusIndex: 0, windowStart: 30 * 86400_000 });
    expect(
      nextHistoryCursor(
        {
          statusIndex: historyStatuses.length - 1,
          windowStart: 30 * 86400_000,
        },
        end,
      ),
    ).toBeNull();
    expect(() =>
      nextHistoryCursor({ ...cursor, pageToken: "same" }, end, "same"),
    ).toThrow();
  });
  it("rejects inverted periods and invalid calendar dates", () => {
    const productId = "8503ccc5-956c-4200-b867-b6d398ebe280";
    expect(
      historyRequestSchema.safeParse({
        productId,
        start: "2026-09-10",
        end: "2026-09-01",
      }).success,
    ).toBe(false);
    expect(
      historyRequestSchema.safeParse({
        productId,
        start: "2026-02-30",
        end: "2026-09-01",
      }).success,
    ).toBe(false);
  });
  it("does not count currently reversed purchases as approved revenue or total unknown partial refunds", () => {
    const row = saleFromRecord({
      id: "a",
      gross_amount: 47,
      currency: "BRL",
      payload: { financial: { platform_fee: 5, payout: 20 } },
    });
    expect(summarizeSales([{ ...row, status: "reversed" }], "BRL").gross).toBe(
      0,
    );
    expect(
      summarizeSales([{ ...row, status: "partial_refund" }], "BRL").payout,
    ).toBeNull();
  });
});

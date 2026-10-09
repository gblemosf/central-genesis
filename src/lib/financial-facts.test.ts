import { describe, expect, it } from "vitest";
import { financialFacts, itemFinancialFacts } from "./financial-facts";

const hubla = {
  gross_amount: 297,
  net_amount: 138.36,
  event_type: "PURCHASE_COMPLETED",
  payload: { financial: { gross: 297, platform_fee: 20.28, net_after_fees: 276.72,
    payout: 138.36, payout_source: "seller_receiver" } },
};
const assiny = {
  gross_amount: 344,
  net_amount: 323.28,
  event_type: "PURCHASE_APPROVED",
  payload: { financial: { gross: 344, platform_fee: 20.72, net_after_fees: 323.28,
    payout: null, payout_source: "unknown" } },
};
const multiItem = {
  ...assiny,
  payload: { ...assiny.payload, provider: "assiny", contract_version: 1, items: [
    { product_external_id: "main", financial: { gross: 297, platform_fee: 17.72, net_after_fees: 279.28 } },
    { product_external_id: "bump", financial: { gross: 47, platform_fee: 3, net_after_fees: 44 } },
  ] },
};
const storedItems = [
  { product_id: "catalog-main", gross_amount: 297, net_amount: 279.28, products: { external_id: "main" } },
  { product_id: "catalog-bump", gross_amount: 47, net_amount: 44, products: { external_id: "bump" } },
];

describe("financial facts", () => {
  it("keeps comparable post-fee revenue separate from differently defined gateway net_amount", () => {
    const first = financialFacts(hubla), second = financialFacts(assiny);
    expect(first).toEqual({ gross: 297, fee: 20.28, afterFees: 276.72, payout: 138.36, payoutSource: "seller_receiver" });
    expect(second).toEqual({ gross: 344, fee: 20.72, afterFees: 323.28, payout: null, payoutSource: "unknown" });
    expect(Math.round((first.afterFees! + second.afterFees!) * 100)).toBe(60000);
  });

  it("uses an explicit net without inventing a fee and derives net only from a known gross and fee", () => {
    expect(financialFacts({ gross_amount: 47, payload: { financial: { net_after_fees: 41.82 } } }))
      .toMatchObject({ gross: 47, fee: null, afterFees: 41.82, payout: null });
    expect(financialFacts({ gross_amount: "47.00", payload: { financial: { platform_fee: "5.18" } } }))
      .toMatchObject({ fee: 5.18, afterFees: 41.82 });
    expect(financialFacts({ payload: { financial: { net_after_fees: 41.82 } } }))
      .toMatchObject({ gross: null, fee: null, afterFees: 41.82 });
  });

  it("never interprets legacy net_amount or a gross fallback as post-fee revenue", () => {
    expect(financialFacts({ gross_amount: 47, net_amount: 47, payload: { net_amount_source: "gross_fallback" } }))
      .toMatchObject({ gross: 47, afterFees: null, fee: null, payout: null });
    expect(financialFacts({ gross_amount: 47, net_amount: 41.82, payload: { net_amount_source: "gross_minus_hotmart_fee" } }).afterFees).toBeNull();
    expect(financialFacts({ gross_amount: 47, net_amount: 19.66, payload: { net_amount_source: "producer_commission" } }))
      .toMatchObject({ afterFees: null, payout: 19.66 });
    expect(financialFacts({ gross_amount: 47, payload: { financial: { payout: 47, payout_source: "gross_fallback" } } }).payout).toBeNull();
  });

  it("preserves explicit zeros and signs refunds exactly once", () => {
    expect(financialFacts({ gross_amount: 0, payload: { financial: { platform_fee: 0, net_after_fees: 0, payout: 0 } } }))
      .toMatchObject({ gross: 0, fee: 0, afterFees: 0, payout: 0 });
    expect(financialFacts({ ...hubla, event_type: "PURCHASE_REFUNDED", gross_amount: -297, net_amount: -138.36 }))
      .toEqual({ gross: -297, fee: -20.28, afterFees: -276.72, payout: -138.36, payoutSource: "seller_receiver" });
    expect(financialFacts({ event_type: "PURCHASE_REFUNDED", gross_amount: -47,
      payload: { financial: { gross: -47, platform_fee: -5.18, net_after_fees: -41.82 } } }).afterFees).toBe(-41.82);
  });

  it("makes inconsistent financial fields unavailable instead of selecting a convenient source", () => {
    expect(financialFacts({ gross_amount: 47, payload: { financial: { platform_fee: 5.18, net_after_fees: 47 } } }))
      .toMatchObject({ gross: 47, fee: null, afterFees: null });
    expect(financialFacts({ gross_amount: 47, payload: { financial: { gross: 100, platform_fee: 5.18 } } }))
      .toMatchObject({ gross: null, afterFees: null, fee: null });
    expect(financialFacts({ gross_amount: 47, payload: { financial: { platform_fee: 50, net_after_fees: 0 } } }))
      .toMatchObject({ afterFees: null, fee: null });
    expect(financialFacts({ gross_amount: 47, payload: { financial: { payout: 50 } } }).payout).toBeNull();
  });

  it("rejects invalid values instead of coercing them to zero and reconciles in cents", () => {
    expect(financialFacts({ gross_amount: true, net_amount: false })).toMatchObject({ gross: null, afterFees: null, payout: null });
    expect(financialFacts({ gross_amount: 47, payload: { financial: { platform_fee: "bad", net_after_fees: 41.82 } } }).afterFees).toBeNull();
    expect(financialFacts({ gross_amount: -47, payload: { financial: { platform_fee: 5.18 } } }).afterFees).toBeNull();
    expect(financialFacts({ gross_amount: 0.3, payload: { financial: { platform_fee: 0.1, net_after_fees: 0.2 } } }).afterFees).toBe(0.2);
    expect(financialFacts({ gross_amount: 19.90, payload: { financial: { platform_fee: 2.77 } } }).afterFees).toBe(17.13);
  });
});

describe("item financial facts", () => {
  it("inherits an owner-group payout only when the single item is the entire reconciled invoice", () => {
    const row = { gross_amount: 297, payload: { provider: "assiny", contract_version: 1,
      financial: { gross: 297, net_after_fees: 279.28, payout: 250, payout_source: "producer_group_commission" },
      items: [{ product_external_id: "main", financial: { gross: 297, net_after_fees: 279.28, payout: null } }] } };
    expect(itemFinancialFacts(row, storedItems[0], [storedItems[0]]).payout).toBe(250);
    expect(itemFinancialFacts({ ...row, event_type: "PURCHASE_REFUNDED" }, storedItems[0], [storedItems[0]]).payout).toBe(-250);
    const conflict = { ...row, payload: { ...row.payload, financial: { ...row.payload.financial, net_after_fees: 280 } } };
    expect(itemFinancialFacts(conflict, storedItems[0], [storedItems[0]]).payout).toBeNull();
  });
  it("does not assign an entire multi-product contract to its only persisted item", () => {
    expect(itemFinancialFacts(multiItem, storedItems[0], [storedItems[0]]).afterFees).toBeNull();
  });
  it("matches exact Assiny item values by external ID regardless of item order", () => {
    expect(itemFinancialFacts(multiItem, storedItems[1], [...storedItems].reverse()))
      .toMatchObject({ gross: 47, fee: 3, afterFees: 44, payout: null });
    expect(itemFinancialFacts(multiItem, storedItems[0], storedItems))
      .toMatchObject({ gross: 297, fee: 17.72, afterFees: 279.28 });
    expect(itemFinancialFacts({ ...multiItem, event_type: "PURCHASE_REFUNDED" }, storedItems[1], storedItems))
      .toMatchObject({ gross: -47, fee: -3, afterFees: -44 });
  });

  it("uses the event facts for a single-item legacy purchase", () => {
    expect(itemFinancialFacts(hubla, storedItems[0], [storedItems[0]])).toEqual(financialFacts(hubla));
  });

  it("does not allocate a multi-item invoice total without an exact verified item match", () => {
    expect(itemFinancialFacts(assiny, storedItems[1], storedItems))
      .toMatchObject({ gross: 47, fee: null, afterFees: null, payout: null });
    const unmatched = [{ ...storedItems[0], products: { external_id: "other" } }, storedItems[1]];
    expect(itemFinancialFacts(multiItem, unmatched[1], unmatched).afterFees).toBeNull();
    const duplicated = [storedItems[0], storedItems[0]];
    expect(itemFinancialFacts(multiItem, duplicated[0], duplicated).afterFees).toBeNull();
    const unversioned = { ...multiItem, payload: { ...multiItem.payload, contract_version: 2 } };
    expect(itemFinancialFacts(unversioned, storedItems[1], storedItems).afterFees).toBeNull();
  });

  it("reconciles the exact item against the stored item gross", () => {
    const inconsistent = [{ ...storedItems[0], gross_amount: 296 }, storedItems[1]];
    expect(itemFinancialFacts(multiItem, inconsistent[0], inconsistent))
      .toMatchObject({ gross: null, fee: null, afterFees: null });
  });
});

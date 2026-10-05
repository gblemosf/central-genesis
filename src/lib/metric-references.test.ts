import { describe, expect, it } from "vitest";
import { observedSaleFromEvent, resolveMetricReferences, usesAutomaticMetric } from "./metric-references";
import { calculateProjectionScenario, defaultProjectMetricConfig, normalizeProjectMetricConfig } from "./project-metrics";
import type { ObservedProductSale, ProjectDailyMetric, ProjectFunnelStage, ProjectProduct } from "./domain";

const config = defaultProjectMetricConfig("2026-09-13");
const stages: ProjectFunnelStage[] = [{ id: "core", type: "core", name: "Core", position: 1, color: null, archivedAt: null }];
const products: ProjectProduct[] = [{ id: "p", name: "P", price: 999, currency: "BRL", externalId: "1", connectionId: "c", stageId: "core", mappedProjectId: "project", source: "provider", archivedAt: null }];
const sale = (overrides: Partial<ObservedProductSale> = {}): ObservedProductSale => ({ date: "2026-09-02", productId: "p", quantity: 1, payout: 20, afterFees: 40, refunded: false, ...overrides });
const daily: ProjectDailyMetric[] = [{ date: "2026-09-02", investment: 100, revenue: 60, coreSales: 3, clicks: 10, impressions: 100, pageViews: 5, checkouts: 4, productMetrics: [] }];
describe("automatic metric references", () => {
  it("weights post-fee unit revenue, preserving zero and excluding refunds and other periods", () => {
    const result = resolveMetricReferences(config, products, stages, [sale(), sale({ quantity: 2, afterFees: 60 }), sale({ afterFees: 0 }), sale({ refunded: true, afterFees: -40 }), sale({ date: "2025-01-01", afterFees: 900 })], daily, true);
    expect(result.references.ticketNetPrice.value).toBe(25);
    expect(result.effective.historicalTicketSales).toBe(4);
    expect(result.effective.baseCpa).toBe(25);
    expect(result.formationId).toBeNull();
  });
  it("does not mix post-fee revenue with producer payouts or substitute catalog gross", () => {
    const mixed = resolveMetricReferences(config, products, stages, [sale(), sale({ payout: null, afterFees: 100 })], daily, true);
    expect(mixed.references.ticketNetPrice.value).toBe(70);
    expect(mixed.references.ticketNetPrice.detail).toContain("após taxas da plataforma");
    const absent = resolveMetricReferences(config, products, stages, [sale({ payout: null, afterFees: null })], daily, true);
    expect(absent.references.ticketNetPrice.value).toBeNull();
    expect(absent.effective.ticketNetPrice).toBe(0);
  });
  it("requires a click for ambiguous products and refuses to allocate account spend", () => {
    const two = [...products, { ...products[0], id: "p2" }];
    expect(resolveMetricReferences(config, two, stages, [sale()], daily, true).ticketId).toBeNull();
    const chosen = resolveMetricReferences({ ...config, ticketProductId: "p" }, two, stages, [sale()], daily, true);
    expect(chosen.effective.ticketNetPrice).toBe(40);
    expect(chosen.references.baseCpa.value).toBeNull();
  });
  it("preserves saved overrides including explicit zero, and resumes automatic calculation on request", () => {
    const manual = normalizeProjectMetricConfig({ ...config, ticketNetPrice: 11 }, "2026-09-13");
    expect(usesAutomaticMetric(manual, "ticketNetPrice")).toBe(false);
    expect(resolveMetricReferences(manual, products, stages, [sale()], daily, true).effective.ticketNetPrice).toBe(11);
    const auto = { ...manual, automaticMetrics: { ticketNetPrice: true } };
    expect(resolveMetricReferences(auto, products, stages, [sale()], daily, true).effective.ticketNetPrice).toBe(40);
    expect(usesAutomaticMetric({ ...config, automaticMetrics: { ticketNetPrice: false } }, "ticketNetPrice")).toBe(false);
  });
  it("rejects gross fallbacks, foreign currency, and ambiguous multi-product prices", () => {
    const event = { currency: "BRL", event_type: "PURCHASE_APPROVED", net_amount: 47, payload: { net_amount_source: "gross_fallback" }, sales_event_items: [{ product_id: "p", quantity: 1 }] };
    expect(observedSaleFromEvent(event, "2026-09-01")[0].payout).toBeNull();
    expect(observedSaleFromEvent({ ...event, currency: "USD" }, "2026-09-01")).toEqual([]);
    expect(observedSaleFromEvent({ ...event, payload: { financial: { payout: 10 } }, sales_event_items: [...event.sales_event_items, { product_id: "p2", quantity: 1 }] }, "2026-09-01")[0].payout).toBeNull();
  });
  it("does not invent costs, CPA or company share on a new project", () => {
    expect([config.baseCpa, config.idealCpa, config.trafficFeePercent, config.companySharePercent]).toEqual([0, 0, 0, 0]);
  });

  it("does not average only known transactions or use payout when post-fee revenue is missing", () => {
    const partial = resolveMetricReferences(config, products, stages, [sale(), sale({ afterFees: null, payout: 80 })], daily, true);
    expect(partial.references.ticketNetPrice.value).toBeNull();
    expect(partial.references.ticketNetPrice.detail).toContain("1 venda(s) sem líquido");
    expect(resolveMetricReferences(config, products, stages, [sale()], daily, false).references.ticketNetPrice.value).toBeNull();
  });

  it("uses media-only CPA and reproduces historical acquisitions with the same budget", () => {
    const referenceConfig = { ...config, trafficFeePercent: 10, ticketBudget: 100 };
    const result = resolveMetricReferences(referenceConfig, products, stages, [sale(), sale(), sale({ refunded: true })], daily, true);
    expect(result.references.historicalTicketSales.value).toBe(2);
    expect(result.references.baseCpa.value).toBe(50);
    expect(calculateProjectionScenario(result.effective.baseCpa, result.effective, 40, 0).ticketSales).toBe(2);
    for (const unavailable of [{ trafficAvailable: false }, { salesAvailable: false }, { comparisonAvailable: false }]) {
      expect(resolveMetricReferences(referenceConfig, products, stages, [sale()], [{ ...daily[0], ...unavailable }], true).references.baseCpa.value).toBeNull();
    }
  });

  it("não fornece referências automáticas de vendas enquanto a fonte está pendente", () => {
    const result = resolveMetricReferences(config, products, stages, [sale()], daily, false);
    expect(Object.values(result.references).every((reference) => reference.value === null)).toBe(true);
  });

  it("uses the same after-fee basis for entrance and formation", () => {
    const allStages: ProjectFunnelStage[] = [...stages, { ...stages[0], id: "up", type: "upsell", position: 2 }];
    const allProducts = [...products, { ...products[0], id: "p2", stageId: "up" }];
    const result = resolveMetricReferences(config, allProducts, allStages, [sale({ payout: 20, afterFees: 40 }), sale({ productId: "p2", payout: null, afterFees: 100 })], daily, true);
    expect(result.references.ticketNetPrice.value).toBe(40);
    expect(result.references.formationNetPrice.value).toBe(100);
  });

  it("extracts explicit per-product financial facts without copying the invoice amount", () => {
    const event = { currency: "BRL", event_type: "PURCHASE_APPROVED", gross_amount: 147, net_amount: 100,
      payload: { contract_version: 1, financial: { gross: 147, net_after_fees: 130 }, items: [
        { product_external_id: "main", financial: { gross: 100, platform_fee: 10, net_after_fees: 90 } },
        { product_external_id: "bump", financial: { gross: 47, platform_fee: 7, net_after_fees: 40 } },
      ] }, sales_event_items: [
        { product_id: "p", quantity: 1, gross_amount: 100, products: { external_id: "main" } },
        { product_id: "p2", quantity: 1, gross_amount: 47, products: { external_id: "bump" } },
      ] };
    expect(observedSaleFromEvent(event, "2026-09-02").map((value) => value.afterFees)).toEqual([90, 40]);
    expect(observedSaleFromEvent({ ...event, event_type: "CHECKOUT_ABANDONED" }, "2026-09-02")).toEqual([]);
    expect(observedSaleFromEvent({ ...event, event_type: "PURCHASE_REFUNDED" }, "2026-09-02").map((value) => [value.afterFees, value.refunded])).toEqual([[-90, true], [-40, true]]);
  });
});

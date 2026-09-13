import { describe, expect, it } from "vitest";
import { observedSaleFromEvent, resolveMetricReferences, usesAutomaticMetric } from "./metric-references";
import { defaultProjectMetricConfig, normalizeProjectMetricConfig } from "./project-metrics";
import type { ObservedProductSale, ProjectDailyMetric, ProjectFunnelStage, ProjectProduct } from "./domain";

const config = defaultProjectMetricConfig("2026-09-13");
const stages: ProjectFunnelStage[] = [{ id: "core", type: "core", name: "Core", position: 1, color: null, archivedAt: null }];
const products: ProjectProduct[] = [{ id: "p", name: "P", price: 999, currency: "BRL", externalId: "1", connectionId: "c", stageId: "core", mappedProjectId: "project", source: "provider", archivedAt: null }];
const sale = (overrides: Partial<ObservedProductSale> = {}): ObservedProductSale => ({ date: "2026-09-02", productId: "p", quantity: 1, payout: 20, afterFees: 40, refunded: false, ...overrides });
const daily: ProjectDailyMetric[] = [{ date: "2026-09-02", investment: 100, revenue: 60, coreSales: 3, clicks: 10, impressions: 100, pageViews: 5, checkouts: 4, productMetrics: [] }];
describe("automatic metric references", () => {
  it("weights actual unit payouts, preserving zero and excluding refunds and other periods", () => {
    const result = resolveMetricReferences(config, products, stages, [sale(), sale({ quantity: 2, payout: 30 }), sale({ payout: 0 }), sale({ refunded: true, payout: -20 }), sale({ date: "2025-01-01", payout: 900 })], daily, true);
    expect(result.references.ticketNetPrice.value).toBe(12.5);
    expect(result.effective.historicalTicketSales).toBe(3);
    expect(result.effective.baseCpa).toBeCloseTo(100 / 3);
    expect(result.formationId).toBeNull();
  });
  it("does not mix post-fee revenue with producer payouts or substitute catalog gross", () => {
    const mixed = resolveMetricReferences(config, products, stages, [sale(), sale({ payout: null, afterFees: 100 })], daily, true);
    expect(mixed.references.ticketNetPrice.value).toBe(20);
    expect(mixed.references.ticketNetPrice.detail).toContain("1 de 2");
    const absent = resolveMetricReferences(config, products, stages, [sale({ payout: null, afterFees: null })], daily, true);
    expect(absent.references.ticketNetPrice.value).toBeNull();
    expect(absent.effective.ticketNetPrice).toBe(0);
  });
  it("requires a click for ambiguous products and refuses to allocate account spend", () => {
    const two = [...products, { ...products[0], id: "p2" }];
    expect(resolveMetricReferences(config, two, stages, [sale()], daily, true).ticketId).toBeNull();
    const chosen = resolveMetricReferences({ ...config, ticketProductId: "p" }, two, stages, [sale()], daily, true);
    expect(chosen.effective.ticketNetPrice).toBe(20);
    expect(chosen.references.baseCpa.value).toBeNull();
  });
  it("preserves saved overrides including explicit zero, and resumes automatic calculation on request", () => {
    const manual = normalizeProjectMetricConfig({ ...config, ticketNetPrice: 11 }, "2026-09-13");
    expect(usesAutomaticMetric(manual, "ticketNetPrice")).toBe(false);
    expect(resolveMetricReferences(manual, products, stages, [sale()], daily, true).effective.ticketNetPrice).toBe(11);
    const auto = { ...manual, automaticMetrics: { ticketNetPrice: true } };
    expect(resolveMetricReferences(auto, products, stages, [sale()], daily, true).effective.ticketNetPrice).toBe(20);
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
});

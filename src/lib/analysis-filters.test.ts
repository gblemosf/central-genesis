import { describe, expect, it } from "vitest";
import { filterProductMetrics, presetPeriod, validAnalysisPeriod } from "./analysis-filters";
import type { ProjectDailyMetric } from "./domain";

describe("analysis filters", () => {
  it("retains exact invoice totals when all recorded products are selected, without allocating them to a subset", () => {
    const row: ProjectDailyMetric = { date:"2026-10-03",investment:100,revenue:344.84,coreSales:1,clicks:0,impressions:0,pageViews:0,checkouts:0,
      hasInvoiceAdjustments:true,revenueAvailable:true,salesAvailable:true,productMetrics:[
        {productId:"core",stageId:"core",stageType:"core",productName:"Principal",quantity:1,revenue:0,revenueAvailable:false},
        {productId:"bump",stageId:"bump",stageType:"order_bump",productName:"Adicional",quantity:1,revenue:0,revenueAvailable:false}]};
    expect(filterProductMetrics([row],["core","bump"])[0]).toMatchObject({revenue:344.84,revenueAvailable:true});
    expect(filterProductMetrics([row],["bump"])[0]).toMatchObject({revenue:0,revenueAvailable:false});
    expect(filterProductMetrics([row],[])[0].revenue).toBe(0);
  });
  it("does not manufacture known zero revenue from an unknown product allocation", () => {
    const row: ProjectDailyMetric = { date: "2026-10-02", investment: 0, revenue: 0, coreSales: 2, clicks: 0, impressions: 0, pageViews: 0, checkouts: 0, productMetrics: [], salesAvailable: true, revenueAvailable: false };
    expect(filterProductMetrics([row], ["unidentified"])[0].revenueAvailable).toBe(false);
  });
  it.each([7, 15, 30, 60])("includes exactly %i calendar days across months", (days) => {
    const period = presetPeriod(String(days), "2026-03-03");
    expect((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000 + 1).toBe(days);
  });
  it("uses calendar months, clamping month ends and handling leap years", () => {
    expect(presetPeriod("3m", "2026-05-31").start).toBe("2026-03-01");
    expect(presetPeriod("6m", "2024-08-31").start).toBe("2024-03-01");
    expect(presetPeriod("3m", "2026-09-13").start).toBe("2026-06-14");
  });
  it("validates custom ranges including single-day queries", () => {
    expect(validAnalysisPeriod("2026-01-01", "2026-01-01")).toBe(true);
    expect(validAnalysisPeriod("2026-01-02", "2026-01-01")).toBe(false);
    expect(validAnalysisPeriod("2026-02-30", "2026-03-04")).toBe(false);
    expect(validAnalysisPeriod("2024-01-01", "2026-01-01")).toBe(false);
  });
  it("filters by stable product IDs, preserves full account traffic and distinguishes none/all", () => {
    const row: ProjectDailyMetric = { date: "2026-09-01", investment: 80, revenue: 30, coreSales: 2, clicks: 10, impressions: 100, pageViews: 4, checkouts: 2, productMetrics: [
      { productId: "a", stageId: "s", stageType: "core", productName: "Same", quantity: 1, revenue: 10 },
      { productId: "b", stageId: "s2", stageType: "core", productName: "Same", quantity: 1, revenue: 20 },
    ] };
    expect(filterProductMetrics([row], ["a"])[0]).toMatchObject({ investment: 80, revenue: 10, coreSales: 1 });
    expect(filterProductMetrics([row], ["a", "b"])[0].revenue).toBe(30);
    expect(filterProductMetrics([row], [])[0].revenue).toBe(0);
    expect(filterProductMetrics([row], null)[0]).toBe(row);
  });
});

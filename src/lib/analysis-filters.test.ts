import { describe, expect, it } from "vitest";
import { filterProductMetrics, presetPeriod, validAnalysisPeriod } from "./analysis-filters";
import type { ProjectDailyMetric } from "./domain";

describe("analysis filters", () => {
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

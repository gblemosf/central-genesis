import { describe, expect, it } from "vitest";
import type { DailyMetric, FunnelStage } from "@/lib/domain";
import { calculateFunnel, calculatePerformance, calculateRecordedComparison } from "@/lib/metrics";

describe("calculatePerformance", () => {
  it("calcula indicadores reais sem misturar estimativas de produto", () => {
    const rows: DailyMetric[] = [
      {
        date: "2026-07-01",
        investment: 100,
        revenue: 300,
        impressions: 1000,
        clicks: 50,
        pageViews: 40,
        checkouts: 10,
        coreSales: 2,
      },
    ];

    expect(calculatePerformance(rows, 50)).toEqual({
      investment: 100,
      revenue: 300,
      profit: 150,
      margin: 50,
      roas: 3,
      cpa: 50,
      aov: 150,
      ctr: 5,
      connectRate: 80,
      checkoutRate: 25,
      coreSales: 2,
    });
  });

  it("não inventa resultado nem taxas quando não há dados ou denominador", () => {
    const result = calculatePerformance([]);
    expect(result).toMatchObject({ profit: null, roas: null, margin: null, cpa: null, aov: null, ctr: null });
  });

  it("preserva zero confirmado e bloqueia derivados de uma base parcial", () => {
    const row: DailyMetric = { date: "2026-10-05", investment: 100, revenue: 0,
      impressions: 100, clicks: 0, pageViews: 0, checkouts: 0, coreSales: 0,
      revenueAvailable: true, trafficAvailable: true, salesAvailable: true };
    expect(calculatePerformance([row])).toMatchObject({ profit: -100, roas: 0, ctr: 0, cpa: null, aov: null, margin: null });
    const partial = calculatePerformance([row, { ...row, revenue: 200, revenueAvailable: false, trafficAvailable: false, salesAvailable: false }]);
    expect(partial).toMatchObject({ revenue: 200, investment: 200, profit: null, roas: null, margin: null, cpa: null, aov: null, ctr: null });
  });

  it("calcula CTR pelas somas ponderadas e CPA com aquisições aprovadas", () => {
    const rows: DailyMetric[] = [
      { date: "2026-10-04", investment: 10, revenue: 0, impressions: 100, clicks: 20, pageViews: 10, checkouts: 2, coreSales: 1 },
      { date: "2026-10-05", investment: 90, revenue: 300, impressions: 900, clicks: 30, pageViews: 20, checkouts: 3, coreSales: 3 },
    ];
    expect(calculatePerformance(rows)).toMatchObject({ ctr: 5, cpa: 25, roas: 3 });
    expect(calculatePerformance(rows.map((row) => ({ ...row, comparisonAvailable: false })))).toMatchObject({
      revenue: 300, investment: 100, ctr: 5, profit: null, margin: null, roas: null, cpa: null, aov: null,
    });
  });
});

describe("recorded comparisons", () => {
  const row: DailyMetric = { date: "2026-10-08", investment: 21201.56, revenue: 8036.45,
    impressions: 0, clicks: 0, pageViews: 0, checkouts: 0, coreSales: 0,
    revenueAvailable: true, trafficAvailable: true, comparisonAvailable: false };

  it("shows the recorded balance and ROAS as partial without enabling reconciled metrics", () => {
    const result = calculateRecordedComparison([row]);
    expect(result.partial).toBe(true);
    expect(result.balance).toBeCloseTo(-13165.11);
    expect(result.roas).toBeCloseTo(0.37905);
    expect(calculatePerformance([row])).toMatchObject({ profit: null, roas: null, cpa: null });
    expect(calculateRecordedComparison([{ ...row, comparisonAvailable: true }]).partial).toBe(false);
  });

  it("uses combined totals rather than averaging project ROAS, and includes registered costs only in balance", () => {
    const result = calculateRecordedComparison([
      { ...row, revenue: 300, investment: 100, comparisonAvailable: true },
      { ...row, revenue: 900, investment: 900 },
    ], 50);
    expect(result).toEqual({ balance: 150, roas: 1.2, partial: true });
  });

  it("does not turn missing sources into zero or divide by zero", () => {
    expect(calculateRecordedComparison([])).toEqual({ balance: null, roas: null, partial: false });
    for (const missing of [{ revenueAvailable: false }, { trafficAvailable: false }]) {
      expect(calculateRecordedComparison([row, { ...row, ...missing }]))
        .toEqual({ balance: null, roas: null, partial: false });
    }
    expect(calculateRecordedComparison([{ ...row, revenue: 0, investment: 100 }]))
      .toEqual({ balance: -100, roas: 0, partial: true });
    expect(calculateRecordedComparison([{ ...row, revenue: 100, investment: 0 }]))
      .toEqual({ balance: 100, roas: null, partial: true });
  });
});

describe("calculateFunnel", () => {
  const stages: FunnelStage[] = [
    {
      id: "base",
      name: "Base",
      type: "low_ticket",
      position: 1,
      price: 10,
      quantity: 100,
      conversionRate: 0,
    },
    {
      id: "middle",
      name: "Middle",
      type: "front_end",
      position: 2,
      price: 20,
      quantity: 0,
      conversionRate: 50,
    },
    {
      id: "back",
      name: "Back",
      type: "back_end",
      position: 3,
      price: 100,
      quantity: 0,
      conversionRate: 20,
    },
  ];

  it("calcula conversao em cascata", () => {
    const result = calculateFunnel(stages, "cascade");
    expect(result.map((stage) => stage.quantity)).toEqual([100, 50, 10]);
    expect(result[2].revenue).toBe(1000);
  });

  it("calcula todas as etapas a partir da base", () => {
    const result = calculateFunnel(stages, "base");
    expect(result.map((stage) => stage.quantity)).toEqual([100, 50, 20]);
  });

  it("zera as vendas com conversao zero mesmo quando existe quantidade anterior", () => {
    const input = stages.map((stage, index) => index === 1
      ? { ...stage, quantity: 50, conversionRate: 0 }
      : stage);

    expect(calculateFunnel(input, "cascade").map((stage) => stage.quantity))
      .toEqual([100, 0, 0]);
    expect(calculateFunnel(input, "base").map((stage) => stage.quantity))
      .toEqual([100, 0, 20]);
  });
});

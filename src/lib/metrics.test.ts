import { describe, expect, it } from "vitest";
import type { DailyMetric, FunnelStage } from "@/lib/domain";
import { calculateFunnel, calculatePerformance } from "@/lib/metrics";

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

  it("retorna taxas zeradas quando nao ha denominador", () => {
    const result = calculatePerformance([]);
    expect(result.roas).toBe(0);
    expect(result.margin).toBe(0);
    expect(result.cpa).toBe(0);
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

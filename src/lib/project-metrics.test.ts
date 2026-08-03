import { describe, expect, it } from "vitest";
import type { ProjectDailyMetric } from "@/lib/domain";
import {
  calculateDailyPerformance,
  calculateFinancialSummary,
  calculateProjectionScenario,
  defaultProjectMetricConfig,
} from "@/lib/project-metrics";

const dailyMetric: ProjectDailyMetric = {
  date: "2026-07-26",
  investment: 298.26,
  revenue: 97.32,
  impressions: 10_000,
  clicks: 147,
  pageViews: 88.2,
  checkouts: 5.333333,
  coreSales: 4,
  productMetrics: [
    {
      productId: "core",
      stageId: "core-stage",
      productName: "Core",
      stageType: "core",
      quantity: 4,
      revenue: 64.88,
    },
    {
      productId: "ob-1",
      stageId: "ob-stage-1",
      productName: "OB1",
      stageType: "order_bump",
      quantity: 1,
      revenue: 16.22,
    },
    {
      productId: "ob-2",
      stageId: "ob-stage-2",
      productName: "OB2",
      stageType: "order_bump",
      quantity: 1,
      revenue: 16.22,
    },
  ],
};

describe("project metrics", () => {
  it("reproduz a linha diaria sem preservar erros da planilha", () => {
    const result = calculateDailyPerformance(dailyMetric, 13.85);

    expect(result.finalInvestment).toBeCloseTo(339.57, 2);
    expect(result.coreRevenue).toBe(64.88);
    expect(result.trackedRevenue).toBe(97.32);
    expect(result.coreRoas).toBeCloseTo(0.19, 2);
    expect(result.generalRoas).toBeCloseTo(0.29, 2);
    expect(result.checkoutConversion).toBeCloseTo(75, 2);
  });

  it("desconta taxa de trafego e todos os custos do lucro", () => {
    const config = {
      ...defaultProjectMetricConfig("2026-07-31"),
      manychatCost: 1000,
      companyCosts: 7200,
      otherCosts: 800,
    };
    const result = calculateFinancialSummary([dailyMetric], config);

    expect(result.totalCost).toBeCloseTo(9339.57, 2);
    expect(result.profit).toBeCloseTo(-9242.25, 2);
  });

  it("calcula os cenarios de CPA com as taxas historicas", () => {
    const config = {
      ...defaultProjectMetricConfig("2026-07-31"),
      ticketBudget: 7000,
      historicalAttendance: 40,
      historicalTicketSales: 62,
      historicalFormationSales: 11,
    };
    const result = calculateProjectionScenario(50, config, 19.9, 934.7);

    expect(result.ticketSales).toBe(140);
    expect(result.attendance).toBeCloseTo(90.32, 2);
    expect(result.formationSales).toBeCloseTo(24.84, 2);
    expect(result.formationRevenue).toBeCloseTo(23_216.74, 2);
    expect(result.plannedCost).toBeCloseTo(7_969.5, 2);
    expect(result.roas).toBeCloseTo(3.26, 2);
  });
});

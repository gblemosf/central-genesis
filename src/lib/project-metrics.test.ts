import { describe, expect, it } from "vitest";
import type { ProjectDailyMetric } from "@/lib/domain";
import {
  aggregateProjectDailyMetrics,
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
    expect(result.coreRoas).toBeCloseTo(64.88 / 298.26);
    expect(result.generalRoas).toBeCloseTo(97.32 / 298.26);
    expect(result.cpa).toBeCloseTo(298.26 / 4);
    expect(result.arpu).toBeCloseTo(24.33, 2);
    expect(result.checkoutConversion).toBeCloseTo(75, 2);
  });

  it("desconta taxa de trafego e todos os custos do lucro", () => {
    const config = {
      ...defaultProjectMetricConfig("2026-07-31"),
      trafficFeePercent: 13.85,
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
      trafficFeePercent: 13.85,
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
    expect(result.roas).toBeCloseTo(3.71, 2);
  });

  it("marca divisoes impossiveis como indisponiveis", () => {
    const result = calculateDailyPerformance({
      ...dailyMetric,
      investment: 0,
      impressions: 0,
      clicks: 0,
      pageViews: 0,
      checkouts: 0,
      coreSales: 0,
      revenue: 0,
      productMetrics: [],
    }, 13.85);

    expect(result).toMatchObject({
      ctr: null,
      connectRate: null,
      landingPageConversion: null,
      checkoutConversion: null,
      cpa: null,
      arpu: null,
      coreRoas: null,
      generalRoas: null,
    });
  });

  it("agrega os tres order bumps da linha diaria", () => {
    const first = {
      ...dailyMetric,
      csvDaily: { core: 4, ob1: 2, ob2: 1, ob3: 0 },
    };
    const second = {
      ...dailyMetric,
      date: "2026-07-27",
      csvDaily: { core: 3, ob1: 1, ob2: 0, ob3: 0 },
    };

    expect(aggregateProjectDailyMetrics([first, second]).csvDaily).toEqual({
      core: 7,
      ob1: 3,
      ob2: 1,
      ob3: 0,
    });
  });

  it("propaga dados incompletos inclusive em dias zerados", () => {
    const absent: ProjectDailyMetric = { ...dailyMetric, revenue: 0, investment: 0, coreSales: 0,
      productMetrics: [], revenueAvailable: false, trafficAvailable: false, salesAvailable: false };
    const aggregate = aggregateProjectDailyMetrics([dailyMetric, absent]);
    expect(aggregate).toMatchObject({ revenueAvailable: false, trafficAvailable: false, salesAvailable: false });
    expect(calculateDailyPerformance(aggregate, 10)).toMatchObject({ cpa: null, arpu: null, coreRoas: null, generalRoas: null, ctr: null, checkoutConversion: null });
    expect(calculateFinancialSummary([dailyMetric, absent], defaultProjectMetricConfig("2026-10-05")))
      .toMatchObject({ profit: null, margin: null, roas: null, roi: null, companyResult: null });
    expect(calculateFinancialSummary([], defaultProjectMetricConfig("2026-10-05")))
      .toMatchObject({ profit: null, margin: null, roas: null, roi: null, companyResult: null });
  });

  it("não confunde líquido zero conhecido com receita ausente, nem substitui aquisições por saldo de produtos", () => {
    const row: ProjectDailyMetric = { ...dailyMetric, coreSales: 2, revenue: 0,
      revenueAvailable: true, trafficAvailable: true, salesAvailable: true,
      productMetrics: [{ ...dailyMetric.productMetrics[0], quantity: -5, approvedQuantity: 2, revenue: 0, revenueAvailable: true }] };
    expect(calculateDailyPerformance(row, 15)).toMatchObject({ coreSales: 2, trackedRevenueAvailable: true, coreRevenueAvailable: true, arpu: 0, generalRoas: 0 });
    expect(calculateDailyPerformance(row, 15).cpa).toBe(dailyMetric.investment / 2);
    const productMissing = { ...row, productMetrics: [{ ...row.productMetrics[0], revenueAvailable: false }] };
    expect(calculateDailyPerformance(productMissing, 0).coreRoas).toBeNull();
  });

  it("agrega unidades aprovadas e preserva a indisponibilidade de cada produto", () => {
    const first = { ...dailyMetric, productMetrics: [{ ...dailyMetric.productMetrics[0], quantity: 2, approvedQuantity: 2, revenueAvailable: true }] };
    const refund = { ...dailyMetric, coreSales: 0, productMetrics: [{ ...dailyMetric.productMetrics[0], quantity: -1, approvedQuantity: 0, revenueAvailable: false }] };
    const [product] = aggregateProjectDailyMetrics([first, refund]).productMetrics;
    expect(product).toMatchObject({ quantity: 1, approvedQuantity: 2, revenueAvailable: false });
    expect(aggregateProjectDailyMetrics([])).toMatchObject({ revenueAvailable: false, trafficAvailable: false, salesAvailable: false });
  });

  it("cobra taxa somente sobre mídia e trata API como custo operacional da projeção", () => {
    const config = { ...defaultProjectMetricConfig("2026-10-05"), ticketBudget: 100, apiBudget: 50, trafficFeePercent: 10 };
    const result = calculateProjectionScenario(50, config, 100, 0);
    expect(result.ticketSales).toBe(2);
    expect(result.finalMediaInvestment).toBeCloseTo(110);
    expect(result.plannedCost).toBeCloseTo(160);
    expect(result.profit).toBeCloseTo(40);
    expect(result.roas).toBe(2);
    expect(calculateProjectionScenario(50, { ...config, ticketBudget: 0 }, 100, 0).roas).toBeNull();
  });

  it("oculta cruzamentos financeiros quando há recebimentos pendentes sem ocultar o tráfego observado", () => {
    const pending = { ...dailyMetric, comparisonAvailable: false };
    const aggregate = aggregateProjectDailyMetrics([dailyMetric, pending]);
    expect(aggregate.comparisonAvailable).toBe(false);
    expect(calculateDailyPerformance(aggregate, 10)).toMatchObject({
      ctr: 1.47, cpa: null, arpu: null, coreRoas: null, generalRoas: null, checkoutConversion: null,
    });
    expect(calculateFinancialSummary([dailyMetric, pending], defaultProjectMetricConfig("2026-10-05")))
      .toMatchObject({ profit: null, margin: null, roas: null, roi: null, companyResult: null });
  });
});

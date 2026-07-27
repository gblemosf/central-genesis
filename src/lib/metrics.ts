import type { DailyMetric, FunnelStage } from "@/lib/domain";

export interface PerformanceTotals {
  investment: number;
  revenue: number;
  profit: number;
  margin: number;
  roas: number;
  cpa: number;
  aov: number;
  ctr: number;
  connectRate: number;
  checkoutRate: number;
  coreSales: number;
}

function percentage(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

export function calculatePerformance(
  rows: DailyMetric[],
  extraCosts = 0,
): PerformanceTotals {
  const totals = rows.reduce(
    (sum, row) => ({
      investment: sum.investment + row.investment,
      revenue: sum.revenue + row.revenue,
      impressions: sum.impressions + row.impressions,
      clicks: sum.clicks + row.clicks,
      pageViews: sum.pageViews + row.pageViews,
      checkouts: sum.checkouts + row.checkouts,
      coreSales: sum.coreSales + row.coreSales,
    }),
    {
      investment: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
      pageViews: 0,
      checkouts: 0,
      coreSales: 0,
    },
  );

  const totalCost = totals.investment + extraCosts;
  const profit = totals.revenue - totalCost;

  return {
    investment: totals.investment,
    revenue: totals.revenue,
    profit,
    margin: percentage(profit, totals.revenue),
    roas: totals.investment > 0 ? totals.revenue / totals.investment : 0,
    cpa: totals.coreSales > 0 ? totals.investment / totals.coreSales : 0,
    aov: totals.coreSales > 0 ? totals.revenue / totals.coreSales : 0,
    ctr: percentage(totals.clicks, totals.impressions),
    connectRate: percentage(totals.pageViews, totals.clicks),
    checkoutRate: percentage(totals.checkouts, totals.pageViews),
    coreSales: totals.coreSales,
  };
}

export function calculateFunnel(
  stages: FunnelStage[],
  mode: "cascade" | "base",
) {
  const baseQuantity = stages[0]?.quantity ?? 0;
  let previousQuantity = baseQuantity;

  return stages.map((stage, index) => {
    const quantity =
      index === 0 || stage.conversionRate <= 0
        ? stage.quantity
        : Math.round(
            (mode === "cascade" ? previousQuantity : baseQuantity) *
              (stage.conversionRate / 100),
          );

    previousQuantity = quantity;
    return { ...stage, quantity, revenue: quantity * stage.price };
  });
}

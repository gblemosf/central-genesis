import type { DailyMetric, FunnelStage } from "@/lib/domain";

export interface PerformanceTotals {
  investment: number;
  revenue: number;
  profit: number | null;
  margin: number | null;
  roas: number | null;
  cpa: number | null;
  aov: number | null;
  ctr: number | null;
  connectRate: number | null;
  checkoutRate: number | null;
  coreSales: number;
}

function percentage(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : null;
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
  const revenueAvailable = rows.length > 0 && rows.every((row) => row.revenueAvailable !== false);
  const trafficAvailable = rows.length > 0 && rows.every((row) => row.trafficAvailable !== false);
  const salesAvailable = rows.length > 0 && rows.every((row) => row.salesAvailable !== false);
  const comparisonAvailable = rows.length > 0 && rows.every((row) => row.comparisonAvailable !== false);
  const profit = comparisonAvailable && revenueAvailable && trafficAvailable ? totals.revenue - totalCost : null;

  return {
    investment: totals.investment,
    revenue: totals.revenue,
    profit,
    margin: profit !== null ? percentage(profit, totals.revenue) : null,
    roas: comparisonAvailable && revenueAvailable && trafficAvailable && totals.investment > 0 ? totals.revenue / totals.investment : null,
    cpa: comparisonAvailable && salesAvailable && trafficAvailable && totals.coreSales > 0 ? totals.investment / totals.coreSales : null,
    aov: comparisonAvailable && revenueAvailable && salesAvailable && totals.coreSales > 0 ? totals.revenue / totals.coreSales : null,
    ctr: trafficAvailable ? percentage(totals.clicks, totals.impressions) : null,
    connectRate: trafficAvailable ? percentage(totals.pageViews, totals.clicks) : null,
    checkoutRate: trafficAvailable ? percentage(totals.checkouts, totals.pageViews) : null,
    coreSales: totals.coreSales,
  };
}

// An intake backlog makes the recorded result provisional, not incalculable.
// Keep this separate from reconciled comparisons used by CPA and projections.
export function calculateRecordedComparison(rows: DailyMetric[], extraCosts = 0) {
  const available = rows.length > 0 && rows.every(row =>
    row.revenueAvailable !== false && row.trafficAvailable !== false);
  const totals = calculatePerformance(rows, extraCosts);
  return {
    balance: available ? totals.revenue - totals.investment - extraCosts : null,
    roas: available && totals.investment > 0 ? totals.revenue / totals.investment : null,
    partial: available && rows.some(row => row.comparisonAvailable === false),
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
      index === 0
        ? stage.quantity
        : Math.round(
            (mode === "cascade" ? previousQuantity : baseQuantity) *
              (stage.conversionRate / 100),
          );

    previousQuantity = quantity;
    return { ...stage, quantity, revenue: quantity * stage.price };
  });
}

import type {
  ProductDailyMetric,
  ProjectDailyMetric,
  ProjectMetricConfig,
} from "@/lib/domain";

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function percentage(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function ratioPercentage(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : null;
}

export function defaultProjectMetricConfig(today: string): ProjectMetricConfig {
  return {
    periodStart: `${today.slice(0, 7)}-01`,
    periodEnd: today,
    trafficFeePercent: 0,
    manychatCost: 0,
    companyCosts: 0,
    otherCosts: 0,
    companySharePercent: 0,
    ticketBudget: 0,
    apiBudget: 0,
    remarketingBudget: 0,
    distributionBudget: 0,
    baseCpa: 0,
    idealCpa: 0,
    historicalAttendance: 0,
    historicalTicketSales: 0,
    historicalFormationSales: 0,
    studentGroupLeads: 0,
    studentGroupTarget: 0,
    buyerGroupLeads: 0,
    buyerGroupTarget: 0,
    captureLeads: 0,
    captureTarget: 0,
    ticketNetPrice: 0,
    orderBump1NetPrice: 0,
    orderBump2NetPrice: 0,
    orderBump3NetPrice: 0,
    formationNetPrice: 0,
    ticketProductId: null,
    formationProductId: null,
    downsellProductId: null,
  };
}

export function normalizeProjectMetricConfig(
  value: unknown,
  today: string,
): ProjectMetricConfig {
  const defaults = defaultProjectMetricConfig(today);
  const input = recordValue(value);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const periodStart =
    typeof input.periodStart === "string" && datePattern.test(input.periodStart)
      ? input.periodStart
      : defaults.periodStart;
  const periodEnd =
    typeof input.periodEnd === "string" && datePattern.test(input.periodEnd)
      ? input.periodEnd
      : defaults.periodEnd;
  const periodDays =
    (Date.parse(`${periodEnd}T00:00:00Z`) -
      Date.parse(`${periodStart}T00:00:00Z`)) /
    86_400_000;
  const validPeriod = periodDays >= 0 && periodDays <= 365;

  return {
    automaticMetrics: Object.fromEntries(
      Object.entries(recordValue(input.automaticMetrics)).filter(
        ([key, mode]) => ["baseCpa", "ticketNetPrice", "formationNetPrice",
          "orderBump1NetPrice", "orderBump2NetPrice", "orderBump3NetPrice",
          "historicalTicketSales", "historicalFormationSales"].includes(key) && typeof mode === "boolean",
      ),
    ),
    periodStart: validPeriod ? periodStart : defaults.periodStart,
    periodEnd: validPeriod ? periodEnd : defaults.periodEnd,
    trafficFeePercent: finiteNumber(input.trafficFeePercent, defaults.trafficFeePercent),
    manychatCost: finiteNumber(input.manychatCost),
    companyCosts: finiteNumber(input.companyCosts),
    otherCosts: finiteNumber(input.otherCosts),
    companySharePercent: finiteNumber(
      input.companySharePercent,
      defaults.companySharePercent,
    ),
    ticketBudget: finiteNumber(input.ticketBudget),
    apiBudget: finiteNumber(input.apiBudget),
    remarketingBudget: finiteNumber(input.remarketingBudget),
    distributionBudget: finiteNumber(input.distributionBudget),
    baseCpa: finiteNumber(input.baseCpa, defaults.baseCpa),
    idealCpa: finiteNumber(input.idealCpa, defaults.idealCpa),
    historicalAttendance: finiteNumber(input.historicalAttendance),
    historicalTicketSales: finiteNumber(input.historicalTicketSales),
    historicalFormationSales: finiteNumber(input.historicalFormationSales),
    studentGroupLeads: finiteNumber(input.studentGroupLeads),
    studentGroupTarget: finiteNumber(input.studentGroupTarget),
    buyerGroupLeads: finiteNumber(input.buyerGroupLeads),
    buyerGroupTarget: finiteNumber(input.buyerGroupTarget),
    captureLeads: finiteNumber(input.captureLeads),
    captureTarget: finiteNumber(input.captureTarget),
    ticketNetPrice: finiteNumber(input.ticketNetPrice),
    orderBump1NetPrice: finiteNumber(input.orderBump1NetPrice),
    orderBump2NetPrice: finiteNumber(input.orderBump2NetPrice),
    orderBump3NetPrice: finiteNumber(input.orderBump3NetPrice),
    formationNetPrice: finiteNumber(input.formationNetPrice),
    ticketProductId: optionalString(input.ticketProductId),
    formationProductId: optionalString(input.formationProductId),
    downsellProductId: optionalString(input.downsellProductId),
  };
}

export function calculateDailyPerformance(
  metric: ProjectDailyMetric,
  trafficFeePercent: number,
) {
  const coreProducts = metric.productMetrics.filter(
    (product) => ["core", "front_end", "low_ticket"].includes(product.stageType),
  );
  const orderBumps = metric.productMetrics.filter(
    (product) => product.stageType === "order_bump",
  );
  // Acquisition counts come from the approved-sale ledger. Product quantities
  // can be net of later refunds and must not silently replace that denominator.
  const coreSales = metric.coreSales;
  const coreRevenue = coreProducts.reduce((sum, product) => sum + product.revenue, 0);
  const trackedRevenue = metric.revenue;
  const finalInvestment = metric.investment * (1 + trafficFeePercent / 100);
  const salesAvailable = metric.salesAvailable !== false;
  const trafficAvailable = metric.trafficAvailable !== false;
  const comparisonAvailable = metric.comparisonAvailable !== false;
  const coreRevenueAvailable = salesAvailable &&
    (coreProducts.length > 0 ? coreProducts.every((product) => product.revenueAvailable !== false) : coreSales === 0);
  const trackedRevenueAvailable = metric.revenueAvailable !== false;

  return {
    ...metric,
    coreSales,
    coreRevenue,
    coreRevenueAvailable,
    orderBumps,
    trackedRevenue,
    trackedRevenueAvailable,
    finalInvestment,
    ctr: trafficAvailable ? ratioPercentage(metric.clicks, metric.impressions) : null,
    connectRate: trafficAvailable ? ratioPercentage(metric.pageViews, metric.clicks) : null,
    landingPageConversion: trafficAvailable ? ratioPercentage(metric.checkouts, metric.pageViews) : null,
    checkoutConversion: comparisonAvailable && salesAvailable && trafficAvailable ? ratioPercentage(coreSales, metric.checkouts) : null,
    cpa: comparisonAvailable && salesAvailable && trafficAvailable && coreSales > 0 ? metric.investment / coreSales : null,
    arpu: comparisonAvailable && salesAvailable && coreSales > 0 && trackedRevenueAvailable ? trackedRevenue / coreSales : null,
    coreRoas: comparisonAvailable && trafficAvailable && metric.investment > 0 && coreRevenueAvailable
      ? coreRevenue / metric.investment
      : null,
    generalRoas: comparisonAvailable && trafficAvailable && metric.investment > 0 && trackedRevenueAvailable
      ? trackedRevenue / metric.investment
      : null,
  };
}

export function aggregateProjectDailyMetrics(rows: ProjectDailyMetric[]): ProjectDailyMetric {
  const products = new Map<string, ProductDailyMetric>();

  for (const row of rows) {
    for (const product of row.productMetrics) {
      const key = `${product.productId}:${product.stageId}`;
      const current = products.get(key) ?? {
        ...product,
        quantity: 0,
        approvedQuantity: 0,
        revenue: 0,
        revenueAvailable: true,
      };
      current.quantity += product.quantity;
      current.approvedQuantity = (current.approvedQuantity ?? 0) +
        (product.approvedQuantity ?? Math.max(0, product.quantity));
      current.revenue += product.revenue;
      current.revenueAvailable = current.revenueAvailable !== false && product.revenueAvailable !== false;
      products.set(key, current);
    }
  }

  return {
    date: "GERAL",
    revenueAvailable: rows.length > 0 && rows.every((row) => row.revenueAvailable !== false),
    trafficAvailable: rows.length > 0 && rows.every((row) => row.trafficAvailable !== false),
    salesAvailable: rows.length > 0 && rows.every((row) => row.salesAvailable !== false),
    comparisonAvailable: rows.length > 0 && rows.every((row) => row.comparisonAvailable !== false),
    investment: rows.reduce((sum, row) => sum + row.investment, 0),
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    pageViews: rows.reduce((sum, row) => sum + row.pageViews, 0),
    checkouts: rows.reduce((sum, row) => sum + row.checkouts, 0),
    coreSales: rows.reduce((sum, row) => sum + row.coreSales, 0),
    productMetrics: Array.from(products.values()),
    csvDaily: rows.some((row) => row.csvDaily)
      ? {
          core: rows.reduce((sum, row) => sum + (row.csvDaily?.core ?? 0), 0),
          ob1: rows.reduce((sum, row) => sum + (row.csvDaily?.ob1 ?? 0), 0),
          ob2: rows.reduce((sum, row) => sum + (row.csvDaily?.ob2 ?? 0), 0),
          ob3: rows.reduce((sum, row) => sum + (row.csvDaily?.ob3 ?? 0), 0),
        }
      : undefined,
  };
}

export function calculateFinancialSummary(
  rows: ProjectDailyMetric[],
  config: ProjectMetricConfig,
) {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const trafficInvestment = rows.reduce((sum, row) => sum + row.investment, 0);
  const finalTrafficInvestment =
    trafficInvestment * (1 + config.trafficFeePercent / 100);
  const operatingCosts = config.manychatCost + config.companyCosts + config.otherCosts;
  const totalCost = finalTrafficInvestment + operatingCosts;
  const revenueAvailable = rows.length > 0 && rows.every((row) => row.revenueAvailable !== false);
  const trafficAvailable = rows.length > 0 && rows.every((row) => row.trafficAvailable !== false);
  const comparisonAvailable = rows.length > 0 && rows.every((row) => row.comparisonAvailable !== false);
  const profit = comparisonAvailable && revenueAvailable && trafficAvailable ? revenue - totalCost : null;

  return {
    revenue,
    trafficInvestment,
    finalTrafficInvestment,
    operatingCosts,
    totalCost,
    profit,
    margin: profit !== null ? ratioPercentage(profit, revenue) : null,
    roas: comparisonAvailable && revenueAvailable && trafficAvailable && trafficInvestment > 0 ? revenue / trafficInvestment : null,
    roi: profit !== null && totalCost > 0 ? profit / totalCost : null,
    companyResult: profit !== null ? profit * (config.companySharePercent / 100) : null,
  };
}

export function calculateProjectionScenario(
  cpa: number,
  config: ProjectMetricConfig,
  ticketPrice: number,
  formationPrice: number,
) {
  const ticketSales = cpa > 0 ? config.ticketBudget / cpa : 0;
  const attendanceRate = percentage(
    config.historicalAttendance,
    config.historicalTicketSales,
  );
  const formationPerAttendance = percentage(
    config.historicalFormationSales,
    config.historicalAttendance,
  );
  const attendance = ticketSales * (attendanceRate / 100);
  const formationSales = attendance * (formationPerAttendance / 100);
  const ticketRevenue = ticketSales * ticketPrice;
  const formationRevenue = formationSales * formationPrice;
  const revenue = ticketRevenue + formationRevenue;
  const mediaBudget =
    config.ticketBudget +
    config.remarketingBudget +
    config.distributionBudget;
  const finalMediaInvestment = mediaBudget * (1 + config.trafficFeePercent / 100);
  const plannedCost =
    finalMediaInvestment +
    config.apiBudget +
    config.manychatCost +
    config.companyCosts +
    config.otherCosts;

  return {
    cpa,
    ticketSales,
    attendance,
    formationSales,
    ticketRevenue,
    formationRevenue,
    revenue,
    finalMediaInvestment,
    plannedCost,
    profit: revenue - plannedCost,
    roas: mediaBudget > 0 ? revenue / mediaBudget : null,
  };
}

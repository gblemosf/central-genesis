import type { ProjectDailyMetric, ProductDailyMetric } from '@/lib/domain';
import { dateInTimezone } from '@/lib/dates';
import { financialFacts, itemFinancialFacts } from '@/lib/financial-facts';

export interface FinancialEvent {
  id: string; project_id: string | null; event_type: string; event_at: string;
  currency: string; gross_amount: number | string | null; net_amount: number | string | null; payload: unknown;
  sales_event_items: {
    id: string; product_id: string | null; funnel_stage_id: string | null;
    product_name_snapshot: string | null; stage_type_snapshot: ProductDailyMetric['stageType'] | null;
    quantity: number | null; gross_amount: number | string | null; net_amount: number | string | null;
    products: { external_id: string } | { external_id: string }[] | null;
  }[] | null;
}
export interface RecordedTraffic {
  metric_date: string; investment: number | string; impressions: number | string;
  clicks: number | string; page_views: number | string; checkouts: number | string;
}
export interface TrafficCoverage { since: string; until: string }
const cents = (value: number) => Math.round(value * 100);
const coreTypes = ['core', 'front_end', 'low_ticket'];

// Immutable recorded facts take precedence over daily CSV aggregates. We never
// add both (which duplicates sales), nor turn a projection price into revenue.
export function reconcileDailyMetrics(input: {
  start: string; end: string; timezone: string; baseline: ProjectDailyMetric[];
  events: FinancialEvent[]; traffic: RecordedTraffic[]; coverage: TrafficCoverage[];
}): ProjectDailyMetric[] {
  const events = input.events.filter(event => event.currency === 'BRL' &&
    ['PURCHASE_APPROVED', 'PURCHASE_COMPLETED', 'PURCHASE_REFUNDED'].includes(event.event_type))
    .map(event => ({ event, date: dateInTimezone(new Date(event.event_at), input.timezone) }))
    .filter(({ date }) => date >= input.start && date <= input.end);
  const rows = new Map<string, ProjectDailyMetric>();
  for (const cursor = new Date(`${input.start}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= input.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const base = input.baseline.find(row => row.date === date);
    rows.set(date, { date, investment: 0, coreSales: 0, impressions: 0, clicks: 0,
      pageViews: 0, checkouts: 0, ...base,
      // Legacy net fields have no reliable before/after-split contract.
      revenue: 0, revenueAvailable: events.length > 0 && !base?.salesAvailable,
      salesAvailable: events.length > 0 || base?.salesAvailable === true,
      trafficAvailable: base?.trafficAvailable === true,
      productMetrics: (base?.productMetrics ?? []).map(item => ({ ...item, revenue: 0, revenueAvailable: false })),
    });
  }
  const salesDates = new Set<string>();
  for (const { event, date } of events) {
    const row = rows.get(date)!;
    if (!salesDates.has(date)) {
      row.revenue = 0; row.coreSales = 0; row.productMetrics = []; row.csvDaily = undefined;
      row.revenueAvailable = true; salesDates.add(date);
    }
    const facts = financialFacts(event);
    if (facts.afterFees === null) row.revenueAvailable = false;
    else row.revenue = (cents(row.revenue) + cents(facts.afterFees)) / 100;
    const items = event.sales_event_items ?? [];
    if (!items.length || items.some(item => !item.product_id || !item.stage_type_snapshot ||
      !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) row.salesAvailable = false;
    for (const item of items) {
      const isRefund = event.event_type === 'PURCHASE_REFUNDED';
      const quantity = Number(item.quantity ?? 0);
      const stageType = item.stage_type_snapshot;
      if (!isRefund && stageType && coreTypes.includes(stageType)) row.coreSales += quantity;
      if (!stageType || !item.product_id) continue;
      const stageId = item.funnel_stage_id ?? `historical-${item.id}`;
      let product = row.productMetrics.find(product => product.productId === item.product_id && product.stageId === stageId);
      if (!product) {
        product = { productId: item.product_id, stageId,
          stageType, productName: item.product_name_snapshot ?? 'Produto histórico', quantity: 0,
          approvedQuantity: 0, revenue: 0, revenueAvailable: true };
        row.productMetrics.push(product);
      }
      product.quantity += (isRefund ? -1 : 1) * quantity;
      product.approvedQuantity = (product.approvedQuantity ?? 0) + (isRefund ? 0 : quantity);
      const itemFacts = itemFinancialFacts(event, item, items);
      if (itemFacts.afterFees === null) product.revenueAvailable = false;
      else product.revenue = (cents(product.revenue) + cents(itemFacts.afterFees)) / 100;
    }
  }
  const trafficDates = new Set<string>();
  for (const traffic of input.traffic) {
    const row = rows.get(traffic.metric_date);
    if (!row) continue;
    if (!trafficDates.has(row.date)) {
      row.investment = row.impressions = row.clicks = row.pageViews = row.checkouts = 0;
      trafficDates.add(row.date);
    }
    row.investment = (cents(row.investment) + cents(Number(traffic.investment))) / 100;
    row.impressions += Number(traffic.impressions); row.clicks += Number(traffic.clicks);
    row.pageViews += Number(traffic.page_views); row.checkouts += Number(traffic.checkouts);
    // A nonzero row alone cannot prove every linked account was queried.
    row.trafficAvailable = false;
  }
  for (const row of rows.values()) {
    if (input.coverage.some(range => row.date >= range.since && row.date <= range.until)) {
      if (!trafficDates.has(row.date)) row.investment = row.impressions = row.clicks = row.pageViews = row.checkouts = 0;
      row.trafficAvailable = true;
    }
  }
  return [...rows.values()];
}

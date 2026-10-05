import { describe, expect, it } from 'vitest';
import { reconcileDailyMetrics, type FinancialEvent } from './metric-reconciliation';
import type { ProjectDailyMetric } from './domain';

const baseline = (date: string, extra: Partial<ProjectDailyMetric> = {}): ProjectDailyMetric => ({ date, investment: 0, revenue: 0, coreSales: 0, impressions: 0, clicks: 0, pageViews: 0, checkouts: 0, productMetrics: [], ...extra });
const sale = (id: string, extra: Partial<FinancialEvent> = {}): FinancialEvent => ({ id, project_id: 'scd', event_type: 'PURCHASE_APPROVED', event_at: '2026-10-03T15:00:00Z', currency: 'BRL', gross_amount: 100, net_amount: 45,
  payload: { financial: { gross: 100, platform_fee: 10, net_after_fees: 90, payout: 45, payout_source: 'seller_receiver' } },
  sales_event_items: [{ id, product_id: id, funnel_stage_id: 'core', product_name_snapshot: id, stage_type_snapshot: 'core', quantity: 1, gross_amount: 100, net_amount: 45, products: { external_id: id } }], ...extra });
const reconcile = (events: FinancialEvent[], extra: Partial<Parameters<typeof reconcileDailyMetrics>[0]> = {}) => reconcileDailyMetrics({ start: '2026-10-02', end: '2026-10-05', timezone: 'America/Sao_Paulo', baseline: [], events, traffic: [], coverage: [], ...extra });

describe('reconcile recorded facts', () => {
  it('does not claim known core counts when an event has no classified items', () => {
    const rows = reconcile([sale('a', { sales_event_items: [] })]);
    expect(rows[1].salesAvailable).toBe(false);
    expect(rows[1].revenue).toBe(90);
  });
  it('uses one after-fees basis across gateways instead of summing payouts', () => {
    const assiny = sale('a', { net_amount: 90, payload: { financial: { gross: 100, platform_fee: 10, net_after_fees: 90, payout: null } } });
    const rows = reconcile([sale('h'), assiny]);
    expect(rows[1].revenue).toBe(180);
    expect(rows[1].productMetrics.map(item => item.revenue)).toEqual([90, 90]);
    expect(rows.every(row => row.revenueAvailable)).toBe(true);
  });
  it('does not publish partial sums as complete when one sale has unknown fees', () => {
    const rows = reconcile([sale('known'), sale('unknown', { payload: {} })]);
    expect(rows[1].revenue).toBe(90);
    expect(rows[1].revenueAvailable).toBe(false);
    expect(rows[1].coreSales).toBe(2);
  });
  it('cannot convert CSV counts or configurable prices into realized net revenue', () => {
    const rows = reconcile([], { baseline: [baseline('2026-10-03', { revenue: 99999, coreSales: 5, salesAvailable: true })] });
    expect(rows[1].revenue).toBe(0);
    expect(rows[1].revenueAvailable).toBe(false);
    expect(rows[1].coreSales).toBe(5);
  });
  it('API facts win over the same-day CSV without adding quantities twice', () => {
    const rows = reconcile([sale('a')], { baseline: [baseline('2026-10-03', { revenue: 999, coreSales: 5, salesAvailable: true })] });
    expect(rows[1].revenue).toBe(90); expect(rows[1].coreSales).toBe(1);
  });
  it('does not treat unknown traffic dates as zero, but accepts a completed empty sync', () => {
    const rows = reconcile([sale('a')], { coverage: [{ since: '2026-10-03', until: '2026-10-04' }] });
    expect(rows.map(row => row.trafficAvailable)).toEqual([false, true, true, false]);
    expect(rows[1].investment).toBe(0);
  });
  it('ignores foreign currency and reports approved acquisitions separately from refunds', () => {
    const rows = reconcile([sale('a'), sale('usd', { currency: 'USD' }), sale('refund', { event_type: 'PURCHASE_REFUNDED' })]);
    expect(rows[1].coreSales).toBe(1); expect(rows[1].revenue).toBe(0);
    expect(rows[1].revenueAvailable).toBe(true);
  });
  it('counts front-end and low-ticket consistently with core and uses project-local dates', () => {
    const event = sale('a', { event_at: '2026-10-03T01:00:00Z' });
    event.sales_event_items![0].stage_type_snapshot = 'low_ticket';
    const rows = reconcile([event]);
    expect(rows[0].coreSales).toBe(1); expect(rows[1].coreSales).toBe(0);
  });
});

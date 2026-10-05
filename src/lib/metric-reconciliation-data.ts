import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectDailyMetric } from '@/lib/domain';
import { readQueryPages } from '@/lib/read-query-pages';
import { record } from '@/lib/sales-attribution';
import { reconcileDailyMetrics, type FinancialEvent } from '@/lib/metric-reconciliation';

export async function readReconciledMetrics(db: SupabaseClient, projects: { id: string; timezone: string; baseline: ProjectDailyMetric[] }[], start: string, end: string) {
  const ids = projects.map(project => project.id);
  if (!ids.length) return { data: new Map<string, ProjectDailyMetric[]>(), error: null };
  const fromDate = new Date(`${start}T00:00:00Z`); fromDate.setUTCDate(fromDate.getUTCDate() - 1);
  const toDate = new Date(`${end}T00:00:00Z`); toDate.setUTCDate(toDate.getUTCDate() + 2);
  const [sales, traffic, runs, links] = await Promise.all([
    readQueryPages((from, to) => db.from('recognized_sales_events').select('id,project_id,event_type,event_at,currency,gross_amount,net_amount,payload,sales_event_items(id,product_id,funnel_stage_id,product_name_snapshot,stage_type_snapshot,quantity,gross_amount,net_amount,products(external_id))')
      .in('project_id', ids).gte('event_at', fromDate.toISOString()).lt('event_at', toDate.toISOString())
      .in('event_type', ['PURCHASE_APPROVED', 'PURCHASE_COMPLETED', 'PURCHASE_REFUNDED']).order('event_at').order('id').range(from, to)),
    readQueryPages((from, to) => db.from('traffic_metrics_daily').select('id,project_id,metric_date,investment,impressions,clicks,page_views,checkouts')
      .in('project_id', ids).eq('source', 'meta').gte('metric_date', start).lte('metric_date', end).order('id').range(from, to)),
    readQueryPages((from, to) => db.from('sync_runs').select('id,project_id,finished_at,metadata').in('project_id', ids)
      .in('job_type', ['meta_insights', 'meta_auto']).eq('status', 'succeeded').order('id').range(from, to)),
    readQueryPages((from, to) => db.from('project_accounts').select('project_id,provider_account_id,created_at,provider_accounts(is_active,account_type,currency)')
      .in('project_id', ids).order('project_id').order('provider_account_id').range(from, to)),
  ]);
  const error = sales.error ?? traffic.error ?? runs.error ?? links.error;
  if (error) return { data: new Map<string, ProjectDailyMetric[]>(), error };
  const data = new Map<string, ProjectDailyMetric[]>();
  for (const project of projects) {
    const accounts = (links.data ?? []).filter(link => link.project_id === project.id);
    const lastLink = accounts.map(link => link.created_at).sort().at(-1) ?? '';
    const accountsUsable = accounts.length > 0 && accounts.every(link => {
      const account = record(Array.isArray(link.provider_accounts) ? link.provider_accounts[0] : link.provider_accounts);
      return account.is_active === true && account.account_type === 'meta_ad_account' && account.currency === 'BRL';
    });
    // Sync is atomic for the project's accounts. Ignore success before the
    // newest account was linked; that run cannot attest to the current scope.
    const coverage = (runs.data ?? []).filter(run => run.project_id === project.id && accountsUsable && run.finished_at >= lastLink)
      .flatMap(run => { const meta = record(run.metadata); return typeof meta.since === 'string' && typeof meta.until === 'string' ? [{ since: meta.since, until: meta.until }] : []; });
    data.set(project.id, reconcileDailyMetrics({ start, end, timezone: project.timezone, baseline: project.baseline,
      events: (sales.data ?? []).filter(event => event.project_id === project.id) as unknown as FinancialEvent[],
      traffic: (traffic.data ?? []).filter(row => row.project_id === project.id), coverage }));
  }
  return { data, error: null };
}

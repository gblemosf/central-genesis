import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readQueryPages } from '@/lib/read-query-pages';
import { record } from '@/lib/sales-attribution';

// Receipts aren't purchases. Surface unresolved deliveries by connection without
// assigning their amounts or customers to a project by guesswork.
export async function readMetricIntakeWarnings(db: SupabaseClient, projectIds: string[], start: string, end: string) {
  const warnings = new Map<string, string[]>();
  if (!projectIds.length) return warnings;
  const mappings = await readQueryPages((from, to) => db.from('product_mappings')
    .select('id,project_id,products(connection_id)').in('project_id', projectIds)
    .is('effective_to', null).order('id').range(from, to));
  if (mappings.error) {
    for (const id of projectIds) warnings.set(id, ['Não foi possível conferir os recebimentos pendentes das conexões.']);
    return warnings;
  }
  const connectionOf = (row: { products: unknown }) => record(Array.isArray(row.products) ? row.products[0] : row.products).connection_id;
  const ids = [...new Set((mappings.data ?? []).map(connectionOf).filter((id): id is string => typeof id === 'string'))];
  if (!ids.length) return warnings;
  const endDate = new Date(`${end}T00:00:00-03:00`); endDate.setUTCDate(endDate.getUTCDate() + 1);
  for (const provider of ['payt', 'assiny'] as const) {
    const pending = await readQueryPages((from, to) => db.from(`${provider}_webhook_receipts`)
      .select('id,connection_id,state').in('connection_id', ids)
      .in('state', ['awaiting_contract', 'unmapped', 'failed'])
      .gte('received_at', `${start}T00:00:00-03:00`).lt('received_at', endDate.toISOString()).order('id').range(from, to));
    for (const id of projectIds) {
      const connections = new Set((mappings.data ?? []).filter(row => row.project_id === id).map(connectionOf));
      const count = (pending.data ?? []).filter(row => connections.has(row.connection_id)).length;
      const messages = warnings.get(id) ?? [];
      if (pending.error) messages.push(`Não foi possível conferir a fila de recebimentos ${provider}.`);
      else if (count) messages.push(`${provider === 'payt' ? 'Payt' : 'Assiny'}: ${count} recebimento(s) pendente(s) nas conexões deste projeto, recebidos no período. Podem incluir testes, abandonos e compras ainda fora dos totais; precisam de conciliação.`);
      if (messages.length) warnings.set(id, messages);
    }
  }
  return warnings;
}

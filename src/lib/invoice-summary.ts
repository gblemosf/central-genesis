import type { SaleRow } from "@/lib/project-operations";

// Use invoice facts once only when every item of this accounting event is in
// the selection. A product subset cannot inherit the whole invoice's revenue.
export function invoiceSummaryRows(rows: SaleRow[]): SaleRow[] {
  const groups = new Map<string, SaleRow[]>();
  for (const row of rows) if (row.invoice) {
    const key = `${row.connectionId}:${row.transaction}:${row.status}:${row.invoice.recordId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const emitted = new Set<string>();
  return rows.flatMap(row => {
    const invoice = row.invoice;
    if (!invoice) return [row];
    const key = `${row.connectionId}:${row.transaction}:${row.status}:${invoice.recordId}`;
    const group = groups.get(key)!;
    const ids = group.map(item => item.catalogProductId);
    const complete = group.length === invoice.itemIds.length && new Set(ids).size === group.length &&
      invoice.itemIds.every(id => ids.includes(id)) && group.every(item => item.currency === row.currency && JSON.stringify(item.invoice) === JSON.stringify(invoice));
    if (!complete) return [row];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return [{ ...row, gross: invoice.financial.gross ?? row.gross, fee: invoice.financial.fee,
      afterFees: invoice.financial.afterFees, payout: invoice.financial.payout, payoutSource: invoice.financial.payoutSource }];
  });
}

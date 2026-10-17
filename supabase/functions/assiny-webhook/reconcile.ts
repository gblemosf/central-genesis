type AssinyItem = { gross: number | null; fee: number | null; net: number | null };

// Preserve both declared sets of amounts. A bounded cent difference is recorded
// on the invoice, never distributed across products or hidden by rounding.
export function assinyReconciliation(items: AssinyItem[], gross: number, fee: number | null, net: number | null) {
  if (fee === null || net === null || fee + net !== gross || items.some(item =>
    item.gross === null || item.fee === null || item.net === null || item.fee + item.net !== item.gross)) return null;
  const feeDelta = fee - items.reduce((sum, item) => sum + item.fee!, 0);
  const netDelta = net - items.reduce((sum, item) => sum + item.net!, 0);
  if (Math.abs(feeDelta) > items.length - 1 || netDelta !== -feeDelta) return null;
  return { scope: feeDelta ? "invoice" : "items", ...(feeDelta ? { adjustment: {
    kind: "reported_item_rounding", gross_delta: 0, platform_fee_delta: feeDelta / 100, net_after_fees_delta: netDelta / 100,
  } } : {}) };
}

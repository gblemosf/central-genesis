import type { AutomaticMetricField, ObservedProductSale, ProjectDailyMetric, ProjectFunnelStage, ProjectMetricConfig, ProjectProduct } from "@/lib/domain";
import { record } from "@/lib/sales-attribution";

export const automaticMetricFields: AutomaticMetricField[] = [
  "baseCpa", "ticketNetPrice", "formationNetPrice", "orderBump1NetPrice",
  "orderBump2NetPrice", "orderBump3NetPrice", "historicalTicketSales", "historicalFormationSales",
];

function amount(value: unknown): number | null {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value) : null;
}

export function observedSaleFromEvent(event: {
  currency?: string;
  event_type: string;
  payload?: unknown;
  net_amount?: number | string | null;
  sales_event_items: { product_id: string | null; quantity: number | null }[] | null;
}, date: string): ObservedProductSale[] {
  if (event.currency !== "BRL") return [];
  const items = event.sales_event_items ?? [];
  const payload = record(event.payload), financial = record(payload.financial);
  const source = financial.payout_source || payload.net_amount_source;
  const payout = amount(financial.payout) ??
    (["producer_commission", "seller_receiver"].includes(String(source)) ? amount(event.net_amount) : null);
  // A missing fee is not zero; an unallocated multi-product total is not a unit price.
  const afterFees = amount(financial.net_after_fees) ??
    (source === "gross_minus_hotmart_fee" ? amount(event.net_amount) : null);
  return items.flatMap((item) => item.product_id && (item.quantity ?? 0) > 0 ? [{
    date, productId: item.product_id, quantity: item.quantity!,
    refunded: event.event_type === "PURCHASE_REFUNDED",
    payout: items.length === 1 ? payout : null,
    afterFees: items.length === 1 ? afterFees : null,
  }] : []);
}

export function usesAutomaticMetric(config: ProjectMetricConfig, field: AutomaticMetricField) {
  // Existing positive overrides remain effective until the user selects Automatic.
  return config.automaticMetrics?.[field] ?? config[field] === 0;
}

export interface MetricReference { value: number | null; detail: string }

export function resolveMetricReferences(
  config: ProjectMetricConfig,
  products: ProjectProduct[],
  stages: ProjectFunnelStage[],
  sales: ObservedProductSale[],
  daily: ProjectDailyMetric[],
  hasSalesSource: boolean,
) {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const available = products.filter((product) => product.stageId && !product.archivedAt);
  const candidates = (types: string[]) => available.filter((product) =>
    types.includes(stageById.get(product.stageId!)?.type ?? ""));
  const explicit = [config.ticketProductId, config.formationProductId, config.downsellProductId];
  const role = (id: string | null, types: string[]) => {
    if (id) return available.find((product) => product.id === id)?.id ?? null;
    const matches = candidates(types).filter((product) => !explicit.includes(product.id));
    return matches.length === 1 ? matches[0].id : null;
  };
  const ticketId = role(config.ticketProductId, ["core", "front_end", "low_ticket"]);
  const formationId = role(config.formationProductId, ["upsell", "middle_end", "back_end"]);
  const downsellId = role(config.downsellProductId, ["downsell"]);
  const bumps = candidates(["order_bump"]).sort((a, b) =>
    (stageById.get(a.stageId!)?.position ?? 0) - (stageById.get(b.stageId!)?.position ?? 0) || a.id.localeCompare(b.id));
  const periodSales = sales.filter((sale) => sale.date >= config.periodStart && sale.date <= config.periodEnd);
  const forProduct = (id: string | null) => periodSales.filter((sale) => sale.productId === id);
  const missing = (id: string | null) => id ? "Sem vendas com valor líquido informado no período." : "Selecione o produto correspondente; o funil não define um único produto.";
  const price = (id: string | null): MetricReference => {
    const paid = forProduct(id).filter((sale) => !sale.refunded);
    // Do not mix producer payout and post-fee revenue in one average.
    const source = paid.some((sale) => sale.payout !== null) ? "payout" : "afterFees";
    const known = paid.filter((sale) => sale[source] !== null);
    const units = known.reduce((total, sale) => total + sale.quantity, 0);
    const allUnits = paid.reduce((total, sale) => total + sale.quantity, 0);
    return units > 0 ? {
      value: known.reduce((total, sale) => total + sale[source]!, 0) / units,
      detail: `Média de ${units} de ${allUnits} unidade(s) aprovada(s), ${source === "payout" ? "repasse ao produtor" : "após taxas da plataforma"}.`,
    } : { value: null, detail: missing(id) };
  };
  const count = (id: string | null): MetricReference => ({
    value: id && hasSalesSource ? Math.max(0, forProduct(id).reduce((sum, sale) =>
      sum + sale.quantity * (sale.refunded ? -1 : 1), 0)) : null,
    detail: id ? "Unidades aprovadas menos estornos registrados no período selecionado." : missing(id),
  });
  const ticketCount = count(ticketId);
  const spend = daily.filter((row) => row.date >= config.periodStart && row.date <= config.periodEnd)
    .reduce((total, row) => total + row.investment, 0) * (1 + config.trafficFeePercent / 100);
  const coreIds = new Set([
    ...candidates(["core", "front_end", "low_ticket"]).map((product) => product.id),
    ...daily.flatMap((row) => row.productMetrics.filter((product) =>
      ["core", "front_end", "low_ticket"].includes(product.stageType) && product.quantity > 0).map((product) => product.productId)),
  ]);
  const cpaAvailable = ticketId && coreIds.size === 1 && coreIds.has(ticketId) && spend > 0 && (ticketCount.value ?? 0) > 0;
  const references: Record<AutomaticMetricField, MetricReference> = {
    baseCpa: {
      value: cpaAvailable ? spend / ticketCount.value! : null,
      detail: coreIds.size > 1 ? "A conta atende vários produtos. Não há gasto por produto para calcular este CPA." :
        "Investimento registrado com taxa de tráfego ÷ vendas do produto. Inclui vendas orgânicas; não é o CPA atribuído pela Meta.",
    },
    ticketNetPrice: price(ticketId), formationNetPrice: price(formationId),
    orderBump1NetPrice: price(bumps[0]?.id ?? null),
    orderBump2NetPrice: price(bumps[1]?.id ?? null),
    orderBump3NetPrice: price(bumps[2]?.id ?? null),
    historicalTicketSales: ticketCount, historicalFormationSales: count(formationId),
  };
  const effective = { ...config };
  for (const field of automaticMetricFields) {
    if (usesAutomaticMetric(config, field)) effective[field] = references[field].value ?? 0;
  }
  return { references, effective, ticketId, formationId, downsellId };
}

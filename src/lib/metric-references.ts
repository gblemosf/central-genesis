import type { AutomaticMetricField, ObservedProductSale, ProjectDailyMetric, ProjectFunnelStage, ProjectMetricConfig, ProjectProduct } from "@/lib/domain";
import { itemFinancialFacts, type FinancialItemRecord } from "@/lib/financial-facts";

export const automaticMetricFields: AutomaticMetricField[] = [
  "baseCpa", "ticketNetPrice", "formationNetPrice", "orderBump1NetPrice",
  "orderBump2NetPrice", "orderBump3NetPrice", "historicalTicketSales", "historicalFormationSales",
];

export function observedSaleFromEvent(event: {
  currency?: string;
  event_type: string;
  payload?: unknown;
  gross_amount?: number | string | null;
  net_amount?: number | string | null;
  sales_event_items: (FinancialItemRecord & { product_id: string | null; quantity: number | null })[] | null;
}, date: string): ObservedProductSale[] {
  if (event.currency !== "BRL" || !["PURCHASE_APPROVED", "PURCHASE_COMPLETED", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"].includes(event.event_type)) return [];
  const items = event.sales_event_items ?? [];
  return items.flatMap((item) => {
    if (!item.product_id || !Number.isFinite(item.quantity) || (item.quantity ?? 0) <= 0) return [];
    const financial = itemFinancialFacts(event, item, items);
    return [{
      date, productId: item.product_id, quantity: item.quantity!,
      refunded: ["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"].includes(event.event_type),
      payout: financial.payout,
      afterFees: financial.afterFees,
    }];
  });
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
    // Every product in a scenario uses the same base. Neither a payout nor
    // an average of only the known transactions represents all recorded sales.
    const known = paid.filter((sale) => sale.afterFees !== null && Number.isFinite(sale.afterFees) && sale.afterFees >= 0);
    if (hasSalesSource && paid.length > known.length) return {
      value: null,
      detail: `${paid.length - known.length} venda(s) sem líquido após taxas válido. A média aguarda todos os valores registrados.`,
    };
    const units = paid.reduce((total, sale) => total + sale.quantity, 0);
    return hasSalesSource && units > 0 ? {
      value: known.reduce((total, sale) => total + sale.afterFees!, 0) / units,
      detail: `Média de ${units} unidade(s) aprovada(s), após taxas da plataforma e antes da divisão entre participantes.`,
    } : { value: null, detail: missing(id) };
  };
  const count = (id: string | null): MetricReference => ({
    value: id && hasSalesSource ? forProduct(id).filter((sale) => !sale.refunded)
      .reduce((sum, sale) => sum + sale.quantity, 0) : null,
    detail: id ? "Unidades aprovadas registradas no período. Reembolsos não são novas aquisições negativas." : missing(id),
  });
  const ticketCount = count(ticketId);
  const periodDaily = daily.filter((row) => row.date >= config.periodStart && row.date <= config.periodEnd);
  const spend = periodDaily.reduce((total, row) => total + row.investment, 0);
  const cpaSourcesAvailable = periodDaily.length > 0 && periodDaily.every((row) =>
    row.trafficAvailable !== false && row.salesAvailable !== false && row.comparisonAvailable !== false);
  const coreIds = new Set([
    ...candidates(["core", "front_end", "low_ticket"]).map((product) => product.id),
    ...periodDaily.flatMap((row) => row.productMetrics.filter((product) =>
      ["core", "front_end", "low_ticket"].includes(product.stageType) && (product.approvedQuantity ?? product.quantity) > 0).map((product) => product.productId)),
  ]);
  const cpaAvailable = cpaSourcesAvailable && ticketId && coreIds.size === 1 && coreIds.has(ticketId) && (ticketCount.value ?? 0) > 0;
  const references: Record<AutomaticMetricField, MetricReference> = {
    baseCpa: {
      value: cpaAvailable ? spend / ticketCount.value! : null,
      detail: coreIds.size > 1 ? "A conta atende vários produtos. Não há gasto por produto para calcular este CPA." :
        "Investimento registrado em mídia ÷ unidades aprovadas do produto. Inclui vendas orgânicas; não é o CPA atribuído pela Meta. Taxas externas entram somente nos custos.",
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

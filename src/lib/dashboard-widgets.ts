import type { AnalysisFilter } from "@/lib/analysis-filters";
import type { ProjectProduct } from "@/lib/domain";
import type { SaleRow } from "@/lib/project-operations";
import { subtractCalendarDays } from "@/lib/dates";

export const widgetLabels = {
  finance: "Composição financeira",
  traffic: "Tráfego e conversão",
  origins: "Origens das vendas",
  recovery: "Recuperação de checkout",
  forms: "Formulários",
  sources: "Fontes e pendências",
  comparison: "Comparação de períodos",
};
export type WidgetId = keyof typeof widgetLabels;
export const widgetPresets: Record<string, WidgetId[]> = {
  Gestão: ["finance", "traffic", "origins", "sources"],
  Tráfego: ["traffic", "origins", "finance", "sources"],
  Comercial: ["finance", "recovery", "forms", "sources"],
};
export function parseWidgetPreference(raw: string | null): WidgetId[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(value)) return [...widgetPresets.Gestão];
    return [
      ...new Set(
        value.filter(
          (id): id is WidgetId =>
            typeof id === "string" && Object.hasOwn(widgetLabels, id),
        ),
      ),
    ];
  } catch {
    return [...widgetPresets.Gestão];
  }
}
export function matchesSaleProducts(
  sale: SaleRow,
  filter: AnalysisFilter,
  products: ProjectProduct[],
) {
  if (filter.productIds === null) return true;
  const id =
    sale.catalogProductId ||
    products.find(
      (product) =>
        product.externalId === sale.productId &&
        product.connectionId === sale.connectionId,
    )?.id;
  return Boolean(id && filter.productIds.includes(id));
}
function saleGroups(sales: SaleRow[]): SaleRow[][] {
  const transactions = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    const key = JSON.stringify([sale.connectionId || sale.provider, sale.transaction || sale.id]);
    const items = transactions.get(key) ?? [];
    items.push(sale);
    transactions.set(key, items);
  }
  return [...transactions.values()];
}

export function paidSaleGroups(sales: SaleRow[]): SaleRow[][] {
  return saleGroups(sales.filter((row) => row.status === "paid"));
}

export function saleOrigins(sales: SaleRow[]) {
  const groups = new Map<string, { label: string[]; sales: SaleRow[] }>();
  for (const items of saleGroups(sales)) {
    const paid = items.filter((sale) => sale.status === "paid");
    const attributionRows = paid.length ? paid : items;
    const label = (["source", "medium", "campaign", "page"] as const).map((field) => {
      const values = [...new Set(attributionRows.map((sale) => sale.attribution[field]?.trim()).filter(Boolean))];
      if (values.length > 1) return field === "source" ? "Origem divergente na mesma compra" : "Divergente na mesma compra";
      return values[0] || (field === "source" || field === "page" ? "Não identificada" : "");
    });
    const key = JSON.stringify(label);
    const group = groups.get(key) ?? { label, sales: [] };
    group.sales.push(...items);
    groups.set(key, group);
  }
  return groups;
}

export function saleSources(sales: SaleRow[]) {
  const groups = new Map<string, number>();
  for (const items of paidSaleGroups(sales)) {
    const sources = [...new Set(items.map((sale) => sale.attribution.source.trim()).filter(Boolean))];
    const source = sources.length > 1 ? "Origem divergente na mesma compra" :
      sources[0] || "Sem origem informada";
    groups.set(source, (groups.get(source) ?? 0) + 1);
  }
  return [...groups].sort((a, b) => b[1] - a[1]);
}

export function previousAnalysisPeriod(
  filter: Pick<AnalysisFilter, "start" | "end">,
) {
  const days =
    Math.round(
      (Date.parse(filter.end) - Date.parse(filter.start)) / 86_400_000,
    ) + 1;
  return {
    start: subtractCalendarDays(filter.start, days),
    end: subtractCalendarDays(filter.start, 1),
  };
}

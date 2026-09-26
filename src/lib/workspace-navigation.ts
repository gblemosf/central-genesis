import {
  presetPeriod,
  validAnalysisPeriod,
  type AnalysisFilter,
} from "@/lib/analysis-filters";

export const workspaceSections = [
  { id: "summary", label: "Resumo", views: [["overview", "Visão do projeto"]] },
  {
    id: "sales",
    label: "Vendas",
    views: [
      ["sales", "Compras"],
      ["recovery", "Recuperação"],
      ["results", "Resultados"],
      ["financial", "Custos e saldo"],
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    views: [
      ["origins", "Origens e UTMs"],
      ["metrics", "Tráfego diário"],
    ],
  },
  {
    id: "audience",
    label: "Público",
    views: [
      ["contacts", "Contatos"],
      ["forms", "Respostas dos formulários"],
    ],
  },
  {
    id: "sources",
    label: "Fontes e ajustes",
    views: [
      ["settings", "Conexões e metas"],
      ["products", "Produtos e funil"],
      ["forms-setup", "Conectar formulários"],
      ["history", "Histórico de vendas"],
      ["imports", "Importar CSV"],
      ["planning", "Projeções"],
      ["assumptions", "Premissas e custos"],
    ],
  },
] as const;

export type WorkspaceView =
  (typeof workspaceSections)[number]["views"][number][0];
export const metricViews = {
  metrics: "daily",
  financial: "financial",
  planning: "planning",
  imports: "data",
  assumptions: "config",
} as const;
export type MetricView = (typeof metricViews)[keyof typeof metricViews];
export function isWorkspaceView(value: string | null): value is WorkspaceView {
  return workspaceSections.some((section) =>
    section.views.some(([view]) => view === value),
  );
}
export function readWorkspaceLocation(
  params: URLSearchParams,
  today: string,
): { tab: WorkspaceView; filter: AnalysisFilter } {
  const view = params.get("view");
  const start = params.get("start") ?? "",
    end = params.get("end") ?? "";
  return {
    tab: isWorkspaceView(view) ? view : "overview",
    filter: {
      ...(validAnalysisPeriod(start, end)
        ? { start, end }
        : presetPeriod("30", today)),
      // An empty selection is different from all products. Unknown IDs must not expand the scope.
      productIds: params.has("products")
        ? [...new Set(params.get("products")!.split(",").filter(Boolean))]
        : null,
    },
  };
}
export function workspaceQuery(
  params: URLSearchParams,
  tab: WorkspaceView,
  filter: AnalysisFilter,
) {
  const next = new URLSearchParams(params);
  next.set("view", tab);
  next.set("start", filter.start);
  next.set("end", filter.end);
  if (filter.productIds === null) next.delete("products");
  else next.set("products", filter.productIds.join(","));
  return next.toString();
}

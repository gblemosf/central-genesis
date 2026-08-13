import type {
  ProjectAnalytics,
  ProjectCatalog,
  ProjectSummary,
} from "@/lib/domain";

export interface ProjectReadinessItem {
  key: "status" | "catalog" | "metrics" | "sales" | "traffic";
  label: string;
  description: string;
  ready: boolean;
  target: "overview" | "metrics" | "products" | "settings";
}

export function getProjectReadiness(
  project: ProjectSummary,
  catalog: ProjectCatalog,
  analytics: ProjectAnalytics,
) {
  const mappedProducts = catalog.products.filter(
    (product) =>
      product.mappedProjectId === project.id && product.stageId && !product.archivedAt,
  );
  const hasSales = analytics.dailyMetrics.some(
    (metric) => metric.revenue !== 0 || metric.coreSales !== 0,
  );
  const hasTraffic = analytics.dailyMetrics.some(
    (metric) =>
      metric.investment !== 0 ||
      metric.impressions !== 0 ||
      metric.clicks !== 0 ||
      metric.pageViews !== 0 ||
      metric.checkouts !== 0,
  );
  const unmapped = analytics.dataSources.unmappedSalesEvents;

  const items: ProjectReadinessItem[] = [
    {
      key: "status",
      label: "Projeto ativo",
      description:
        project.status === "active"
          ? "Incluido no consolidado da Visao geral."
          : "Ative o projeto para inclui-lo no consolidado.",
      ready: project.status === "active",
      target: "settings",
    },
    {
      key: "catalog",
      label: "Produtos mapeados",
      description: mappedProducts.length
        ? `${mappedProducts.length} produto(s) associado(s) ao funil.`
        : "Associe o ID externo do produto a uma etapa do funil.",
      ready: mappedProducts.length > 0,
      target: "products",
    },
    {
      key: "metrics",
      label: "Parametros confirmados",
      description: analytics.configSaved
        ? "Periodo, precos e custos foram confirmados."
        : "Revise o periodo, os precos liquidos e os custos.",
      ready: analytics.configSaved,
      target: "metrics",
    },
    {
      key: "sales",
      label: "Vendas chegando",
      description: unmapped > 0
        ? `${unmapped} evento(s) da conexao ainda sem produto mapeado.`
        : hasSales
          ? "A fonte de vendas possui eventos ou linhas importadas."
          : "Envie um evento de teste ou importe o CSV diario.",
      ready: hasSales && unmapped === 0,
      target: unmapped > 0 ? "products" : "metrics",
    },
    {
      key: "traffic",
      label: "Trafego chegando",
      description: hasTraffic
        ? "Ha dados de Meta ou CSV para o projeto."
        : catalog.linkedMetaAccountId
          ? "A conta esta vinculada; execute a sincronizacao Meta."
          : "Vincule uma conta Meta ou importe o CSV diario.",
      ready: hasTraffic,
      target: catalog.linkedMetaAccountId ? "overview" : "settings",
    },
  ];

  return {
    items,
    completed: items.filter((item) => item.ready).length,
    total: items.length,
    ready: items.every((item) => item.ready),
  };
}

import type {
  ProjectAnalytics,
  ProjectCatalog,
  ProjectSummary,
} from "@/lib/domain";
import type { WorkspaceView } from "@/lib/workspace-navigation";

export interface ProjectReadinessItem {
  key: "status" | "catalog" | "metrics" | "sales" | "traffic";
  label: string;
  description: string;
  ready: boolean;
  target: WorkspaceView;
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
    (metric) => metric.revenue !== 0 || metric.coreSales !== 0 || metric.productMetrics.some((product) => product.quantity !== 0 || product.revenue !== 0),
  );
  const hasHotmartProduct = mappedProducts.some((product) => catalog.salesConnections.some((connection) => connection.id === product.connectionId && connection.provider === "hotmart"));
  const hasTraffic = analytics.dailyMetrics.some(
    (metric) =>
      metric.investment !== 0 ||
      metric.impressions !== 0 ||
      metric.clicks !== 0 ||
      metric.pageViews !== 0 ||
      metric.checkouts !== 0,
  );
  const unmapped = analytics.dataSources.unmappedSalesEvents;
  const unmappedProducts = analytics.dataSources.unmappedSalesProducts ?? [];
  const unmappedNames = unmappedProducts.slice(0, 3).join(", ") +
    (unmappedProducts.length > 3 ? ` e mais ${unmappedProducts.length - 3} produto(s)` : "");

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
      label: "Dados no período",
      description: hasSales || hasTraffic
        ? "Selecione período e produtos para consultar os resultados. Custos externos são opcionais."
        : "Não há dados neste período. Confira os vínculos e selecione outras datas antes de revisar a integração.",
      ready: hasSales || hasTraffic,
      target: hasSales ? "sales" : hasTraffic ? "metrics" : "settings",
    },
    {
      key: "sales",
      label: hasSales && unmapped > 0 ? "Vendas recebidas · vínculo pendente" : "Vendas no período",
      description: unmapped > 0
        ? `${hasSales ? "As vendas já estão chegando. " : ""}${unmapped} evento(s) da conexão aguardam vínculo de produto${unmappedNames ? `: ${unmappedNames}` : ""}. Revise em Produtos e funil; não é uma configuração de formulário.`
        : hasSales
          ? "A fonte de vendas possui eventos ou linhas importadas."
          : hasHotmartProduct
            ? "Confira o recebimento de eventos ou importe o histórico Hotmart para este período."
            : "Confira o produto e a entrega de eventos na plataforma de venda. Ausência de vendas no período não comprova falha.",
      ready: hasSales && unmapped === 0,
      target: unmapped > 0 ? "products" : hasSales ? "sales" : hasHotmartProduct ? "history" : "products",
    },
    {
      key: "traffic",
      label: "Tráfego no período",
      description: hasTraffic
        ? "Ha dados de Meta ou CSV para o projeto."
        : catalog.linkedMetaAccountId
          ? "A conta esta vinculada; execute a sincronizacao Meta."
          : "Vincule a conta Meta usada nas campanhas para sincronizar o tráfego.",
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

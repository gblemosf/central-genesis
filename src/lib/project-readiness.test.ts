import { describe, expect, it } from "vitest";
import type {
  ProjectAnalytics,
  ProjectCatalog,
  ProjectSummary,
} from "@/lib/domain";
import { getProjectReadiness } from "@/lib/project-readiness";
import { defaultProjectMetricConfig } from "@/lib/project-metrics";

const project: ProjectSummary = {
  id: "project",
  name: "Projeto",
  expertName: "Expert",
  status: "draft",
  color: "#fff",
  initials: "PR",
  monthlyTarget: 0,
  marginTarget: 0,
  investment: 0,
  revenue: 0,
  coreSales: 0,
  products: 0,
  lastSyncAt: null,
  dailyMetrics: [],
};

const catalog: ProjectCatalog = {
  products: [],
  stages: [],
  metaAccounts: [],
  salesConnections: [],
  linkedMetaAccountId: null,
};

const analytics: ProjectAnalytics = {
  config: defaultProjectMetricConfig("2026-08-13"),
  configSaved: false,
  dataSources: {
    csvDailyRows: 0,
    metaTrafficRows: 0,
    webhookSalesEvents: 0,
    unmappedSalesEvents: 2,
  },
  dailyMetrics: [],
};

describe("getProjectReadiness", () => {
  it("explica quando o projeto ainda nao esta operacional", () => {
    const readiness = getProjectReadiness(project, catalog, analytics);

    expect(readiness.ready).toBe(false);
    expect(readiness.completed).toBe(0);
    expect(readiness.items.find((item) => item.key === "sales")?.description).toContain(
      "2 evento(s)",
    );
  });

  it("considera pronto um projeto ativo, mapeado e abastecido", () => {
    const readiness = getProjectReadiness(
      { ...project, status: "active" },
      {
        ...catalog,
        linkedMetaAccountId: "meta",
        products: [
          {
            id: "product",
            connectionId: "sales",
            externalId: "external",
            name: "Produto",
            price: 19.9,
            currency: "BRL",
            source: "provider",
            archivedAt: null,
            stageId: "stage",
            mappedProjectId: "project",
          },
        ],
      },
      {
        ...analytics,
        configSaved: true,
        dataSources: {
          csvDailyRows: 0,
          metaTrafficRows: 3,
          webhookSalesEvents: 1,
          unmappedSalesEvents: 0,
        },
        dailyMetrics: [
          {
            date: "2026-08-13",
            investment: 10,
            revenue: 19.9,
            impressions: 100,
            clicks: 10,
            pageViews: 5,
            checkouts: 2,
            coreSales: 1,
            productMetrics: [],
          },
        ],
      },
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.completed).toBe(5);
  });
});

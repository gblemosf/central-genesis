import "server-only";

import type {
  DailyMetric,
  IntegrationConnection,
  MetaConnectionOption,
  ProjectCatalog,
  ProjectSummary,
} from "@/lib/domain";
import { demoConnections, demoProjects } from "@/lib/demo-data";
import { dateInTimezone } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { titleCase } from "@/lib/utils";

interface LegacyTrafficRow {
  projeto: string;
  date: string;
  invest: number | string | null;
  impressions: number | null;
  clicks: number | null;
  pageviews: number | null;
  checkouts: number | null;
}

interface LegacySalesRow {
  projeto: string;
  date: string;
  core: number | null;
  fat_liquido: number | string | null;
}

interface ProductMapRow {
  projeto: string;
}

export interface AppData<T> {
  data: T;
  source: "live" | "demo";
  warning?: string;
}

const numberValue = (value: number | string | null | undefined) =>
  Number.parseFloat(String(value ?? 0)) || 0;

function aggregateLegacyData(
  trafficRows: LegacyTrafficRow[],
  salesRows: LegacySalesRow[],
  productRows: ProductMapRow[],
): ProjectSummary[] {
  const projectIds = Array.from(
    new Set([
      ...trafficRows.map((row) => row.projeto),
      ...salesRows.map((row) => row.projeto),
      ...productRows.map((row) => row.projeto),
    ]),
  );

  return projectIds.map((projectId, index) => {
    const metrics = new Map<string, DailyMetric>();
    const getMetric = (date: string) => {
      const current = metrics.get(date) ?? {
        date,
        investment: 0,
        revenue: 0,
        impressions: 0,
        clicks: 0,
        pageViews: 0,
        checkouts: 0,
        coreSales: 0,
      };
      metrics.set(date, current);
      return current;
    };

    trafficRows
      .filter((row) => row.projeto === projectId)
      .forEach((row) => {
        const metric = getMetric(row.date);
        metric.investment = numberValue(row.invest);
        metric.impressions = row.impressions ?? 0;
        metric.clicks = row.clicks ?? 0;
        metric.pageViews = row.pageviews ?? 0;
        metric.checkouts = row.checkouts ?? 0;
      });

    salesRows
      .filter((row) => row.projeto === projectId)
      .forEach((row) => {
        const metric = getMetric(row.date);
        metric.revenue = numberValue(row.fat_liquido);
        metric.coreSales = row.core ?? 0;
      });

    const dailyMetrics = Array.from(metrics.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const investment = dailyMetrics.reduce(
      (sum, row) => sum + row.investment,
      0,
    );
    const revenue = dailyMetrics.reduce((sum, row) => sum + row.revenue, 0);
    const coreSales = dailyMetrics.reduce(
      (sum, row) => sum + row.coreSales,
      0,
    );
    const name = titleCase(projectId);

    return {
      id: projectId,
      name,
      expertName: `Projeto ${name}`,
      status: "active",
      color: ["#ff6b5e", "#61d6c8", "#f5c451", "#8f7cff"][index % 4],
      initials: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      monthlyTarget: 100000,
      marginTarget: 65,
      investment,
      revenue,
      coreSales,
      products: productRows.filter((row) => row.projeto === projectId).length,
      lastSyncAt: dailyMetrics.at(-1)?.date ?? null,
      dailyMetrics,
    } satisfies ProjectSummary;
  });
}

export async function getProjects(): Promise<AppData<ProjectSummary[]>> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return getSupabasePublicEnv().demoMode
      ? { data: demoProjects, source: "demo" }
      : {
          data: [],
          source: "live",
          warning: "Supabase nao configurado para este ambiente.",
        };
  }
  const reportingStartDate = `${dateInTimezone(new Date()).slice(0, 7)}-01`;

  const { data: normalizedProjects, error: normalizedError } = await supabase
    .from("projects")
    .select(
      "id,name,slug,status,color,monthly_revenue_target,margin_target,expert_id,experts(name)",
    )
    .order("created_at", { ascending: true });

  if (normalizedError) {
    return {
      data: [],
      source: "live",
      warning: `Falha ao consultar projetos: ${normalizedError.message}`,
    };
  }

  if (normalizedProjects?.length) {
    const projectIds = normalizedProjects.map((project) => project.id);
    const [metrics, mappings] = await Promise.all([
      supabase
        .from("project_daily_metrics")
        .select(
          "project_id,metric_date,investment,revenue,impressions,clicks,page_views,checkouts,core_sales",
        )
        .in("project_id", projectIds)
        .gte("metric_date", reportingStartDate)
        .order("metric_date", { ascending: true }),
      supabase
        .from("product_mappings")
        .select("project_id")
        .in("project_id", projectIds)
        .is("effective_to", null),
    ]);

    if (metrics.error || mappings.error) {
      return {
        data: [],
        source: "live",
        warning: `Falha ao carregar indicadores: ${metrics.error?.message ?? mappings.error?.message}`,
      };
    }

    const projects = normalizedProjects.map((project, index) => {
      const dates = new Map<string, DailyMetric>();
      const metricFor = (date: string) => {
        const metric = dates.get(date) ?? {
          date,
          investment: 0,
          revenue: 0,
          impressions: 0,
          clicks: 0,
          pageViews: 0,
          checkouts: 0,
          coreSales: 0,
        };
        dates.set(date, metric);
        return metric;
      };

      (metrics.data ?? [])
        .filter((row) => row.project_id === project.id)
        .forEach((row) => {
          const metric = metricFor(row.metric_date);
          metric.investment += numberValue(row.investment);
          metric.revenue += numberValue(row.revenue);
          metric.impressions += numberValue(row.impressions);
          metric.clicks += numberValue(row.clicks);
          metric.pageViews += numberValue(row.page_views);
          metric.checkouts += numberValue(row.checkouts);
          metric.coreSales += numberValue(row.core_sales);
        });

      const dailyMetrics = Array.from(dates.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      const expertRelation = project.experts as
        | { name?: string }
        | { name?: string }[]
        | null;
      const expertName = Array.isArray(expertRelation)
        ? expertRelation[0]?.name
        : expertRelation?.name;

      return {
        id: project.id,
        name: project.name,
        expertName: expertName ?? "Expert nao informado",
        status: project.status,
        color: project.color || ["#ff6b5e", "#61d6c8", "#f5c451"][index % 3],
        initials: project.name.slice(0, 2).toUpperCase(),
        monthlyTarget: numberValue(project.monthly_revenue_target),
        marginTarget: numberValue(project.margin_target),
        investment: dailyMetrics.reduce((sum, row) => sum + row.investment, 0),
        revenue: dailyMetrics.reduce((sum, row) => sum + row.revenue, 0),
        coreSales: dailyMetrics.reduce((sum, row) => sum + row.coreSales, 0),
        products: (mappings.data ?? []).filter(
          (mapping) => mapping.project_id === project.id,
        ).length,
        lastSyncAt: dailyMetrics.at(-1)?.date ?? null,
        dailyMetrics,
      } as ProjectSummary;
    });

    return { data: projects, source: "live" };
  }

  const [traffic, sales, products] = await Promise.all([
    supabase
      .from("metricas_trafego")
      .select("projeto,date,invest,impressions,clicks,pageviews,checkouts")
      .gte("date", reportingStartDate)
      .order("date", { ascending: true }),
    supabase
      .from("metricas_vendas")
      .select("projeto,date,core,fat_liquido")
      .gte("date", reportingStartDate)
      .order("date", { ascending: true }),
    supabase.from("mapeamento_produtos").select("projeto"),
  ]);

  if (traffic.error || sales.error || products.error) {
    return {
      data: [],
      source: "live",
      warning:
        "O schema operacional ainda nao foi aplicado e as tabelas legadas nao estao disponiveis.",
    };
  }

  const projects = aggregateLegacyData(
    (traffic.data ?? []) as LegacyTrafficRow[],
    (sales.data ?? []) as LegacySalesRow[],
    (products.data ?? []) as ProductMapRow[],
  );

  return { data: projects, source: "live" };
}

export async function getProject(projectId: string) {
  const projects = await getProjects();
  const project = projects.data.find((item) => item.id === projectId) ?? null;
  if (!project && projects.warning) throw new Error(projects.warning);
  return {
    ...projects,
    data: project,
  };
}

export async function getProjectCatalog(projectId: string): Promise<ProjectCatalog> {
  const supabase = await createSupabaseServerClient();
  const emptyCatalog: ProjectCatalog = {
    products: [],
    stages: [],
    metaAccounts: [],
    linkedMetaAccountId: null,
  };
  if (!supabase) return { ...emptyCatalog, warning: "Supabase nao configurado." };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project) {
    return {
      ...emptyCatalog,
      warning: projectError?.message ?? "Catalogo indisponivel para este projeto.",
    };
  }

  const [products, stages, mappings, metaAccounts, projectAccounts] = await Promise.all([
    supabase
      .from("products")
      .select("id,external_id,name,current_price,currency")
      .eq("organization_id", project.organization_id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("funnel_stages")
      .select("id,name,stage_type,position")
      .eq("project_id", projectId)
      .order("position"),
    supabase
      .from("product_mappings")
      .select("product_id,project_id,funnel_stage_id")
      .eq("organization_id", project.organization_id)
      .is("effective_to", null),
    supabase
      .from("provider_accounts")
      .select("id,external_id,name")
      .eq("organization_id", project.organization_id)
      .eq("account_type", "meta_ad_account")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("project_accounts")
      .select("provider_account_id,project_id")
      .eq("organization_id", project.organization_id),
  ]);
  if (
    products.error ||
    stages.error ||
    mappings.error ||
    metaAccounts.error ||
    projectAccounts.error
  ) {
    return {
      ...emptyCatalog,
      warning:
        products.error?.message ??
        stages.error?.message ??
        mappings.error?.message ??
        metaAccounts.error?.message ??
        projectAccounts.error?.message ??
        "Nao foi possivel carregar o catalogo.",
    };
  }

  const mappingByProduct = new Map(
    (mappings.data ?? []).map((mapping) => [mapping.product_id, mapping]),
  );
  const linkedAccount = (projectAccounts.data ?? []).find(
    (link) => link.project_id === projectId,
  );
  const accountLinks = new Map(
    (projectAccounts.data ?? []).map((link) => [link.provider_account_id, link.project_id]),
  );
  return {
    products: (products.data ?? []).map((product) => {
      const mapping = mappingByProduct.get(product.id);
      return {
        id: product.id,
        externalId: product.external_id,
        name: product.name,
        price: numberValue(product.current_price),
        currency: product.currency,
        stageId: mapping?.project_id === projectId ? mapping.funnel_stage_id : null,
        mappedProjectId: mapping?.project_id ?? null,
      };
    }),
    stages: (stages.data ?? []).map((stage) => ({
      id: stage.id,
      name: stage.name,
      type: stage.stage_type,
      position: stage.position,
    })),
    metaAccounts: (metaAccounts.data ?? [])
      .filter((account) => {
        const linkedProjectId = accountLinks.get(account.id);
        return !linkedProjectId || linkedProjectId === projectId;
      })
      .map((account) => ({
        id: account.id,
        externalId: account.external_id,
        name: account.name,
      })),
    linkedMetaAccountId: linkedAccount?.provider_account_id ?? null,
  };
}

export async function getMetaConnectionsForOnboarding(): Promise<MetaConnectionOption[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const [connections, links] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id,name,provider_accounts(id,external_id,name,is_active,account_type)")
      .eq("provider", "meta")
      .neq("status", "revoked")
      .order("created_at"),
    supabase.from("project_accounts").select("provider_account_id"),
  ]);
  if (connections.error || links.error) return [];
  const linkedAccountIds = new Set(
    (links.data ?? []).map((link) => link.provider_account_id),
  );

  return (connections.data ?? []).map((connection) => ({
    id: connection.id,
    name: connection.name,
    accounts: (connection.provider_accounts ?? [])
      .filter(
        (account) =>
          account.is_active &&
          account.account_type === "meta_ad_account" &&
          !linkedAccountIds.has(account.id),
      )
      .map((account) => ({
        id: account.id,
        externalId: account.external_id,
        name: account.name,
      })),
  }));
}

export async function getConnections(): Promise<
  AppData<IntegrationConnection[]>
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return getSupabasePublicEnv().demoMode
      ? { data: demoConnections, source: "demo" }
      : { data: [], source: "live", warning: "Supabase nao configurado." };
  }

  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id,name,provider,status,business_id,last_verified_at,last_error,provider_accounts(count)",
    )
    .order("created_at", { ascending: true });

  if (error) return { data: [], source: "live", warning: error.message };

  const connections = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    provider: row.provider as IntegrationConnection["provider"],
    status: row.status as IntegrationConnection["status"],
    businessId: row.business_id ? String(row.business_id) : undefined,
    accountCount: Array.isArray(row.provider_accounts)
      ? Number(row.provider_accounts[0]?.count ?? 0)
      : 0,
    lastVerifiedAt: row.last_verified_at
      ? String(row.last_verified_at)
      : null,
    lastError: row.last_error ? String(row.last_error) : undefined,
  }));

  return { data: connections, source: "live" };
}

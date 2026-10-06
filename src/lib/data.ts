import "server-only";

import type {
  DailyMetric,
  IntegrationConnection,
  MetaConnectionOption,
  ProductDailyMetric,
  ProjectAnalytics,
  ProjectCatalog,
  ProjectDailyMetric,
  ProjectFormsData,
  ProjectSummary,
  SalesConnectionOption,
} from "@/lib/domain";
import { demoConnections, demoProjects } from "@/lib/demo-data";
import { dateInTimezone } from "@/lib/dates";
import { observedSaleFromEvent } from "@/lib/metric-references";
import {
  defaultProjectMetricConfig,
  normalizeProjectMetricConfig,
} from "@/lib/project-metrics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { validAnalysisPeriod } from "@/lib/analysis-filters";
import { readQueryPages } from "@/lib/read-query-pages";
import { readReconciledMetrics } from "@/lib/metric-reconciliation-data";
import { readMetricIntakeWarnings } from "@/lib/metric-intake-warnings";
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
  ob1: number | null;
  ob2: number | null;
  ob3: number | null;
  ob4: number | null;
  ob5: number | null;
  up1: number | null;
  up2: number | null;
  ds1: number | null;
  ds2: number | null;
  fat_liquido: number | string | null;
}

interface NormalizedCsvDailyRow {
  project_id: string;
  metric_date: string;
  investment: number | string;
  impressions: number | string;
  clicks: number | string;
  page_views: number | string;
  checkouts: number | string;
  core_sales: number | string;
  order_bump_1_sales: number | string;
  order_bump_2_sales: number | string;
  order_bump_3_sales: number | string;
}

interface ProductMapRow {
  projeto: string;
}

interface LegacyProductMapRow extends ProductMapRow {
  product_id: string;
  campo: string;
  nome_produto: string | null;
}

interface SaleEventItemRow {
  id: string;
  product_id: string | null;
  funnel_stage_id: string | null;
  product_name_snapshot: string | null;
  stage_type_snapshot: ProductDailyMetric["stageType"] | null;
  quantity: number | null;
  net_amount: number | string | null;
}

interface SaleEventRow {
  payload?: unknown;
  currency?: string;
  net_amount?: number | string | null;
  id: string;
  event_type: string;
  event_at: string;
  sales_event_items: SaleEventItemRow[] | null;
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
        revenueAvailable: false, salesAvailable: false, trafficAvailable: false,
      };
      metrics.set(date, current);
      return current;
    };

    trafficRows
      .filter((row) => row.projeto === projectId)
      .forEach((row) => {
        const metric = getMetric(row.date);
        metric.investment = numberValue(row.invest);
        metric.trafficAvailable = row.invest !== null;
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
        metric.revenueAvailable = false;
        metric.salesAvailable = true;
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
      legacy: true,
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
      monthlyTarget: 0,
      marginTarget: 0,
      investment,
      revenue,
      coreSales,
      products: productRows.filter((row) => row.projeto === projectId).length,
      lastSyncAt: dailyMetrics.at(-1)?.date ?? null,
      dailyMetrics,
    } satisfies ProjectSummary;
  });
}

export async function getProjects(period?: { start: string; end: string }): Promise<AppData<ProjectSummary[]>> {
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
  if (period && !validAnalysisPeriod(period.start, period.end)) return { data: [], source: "live", warning: "Escolha um período válido de até 366 dias." };
  const reportingStartDate = period?.start ?? `${dateInTimezone(new Date()).slice(0, 7)}-01`;
  const reportingEndDate = period?.end ?? dateInTimezone(new Date());

  const { data: normalizedProjects, error: normalizedError } = await supabase
    .from("projects")
    .select(
      "id,name,slug,status,color,monthly_revenue_target,margin_target,expert_id,deleted_at,settings,reporting_timezone,experts(name)",
    )
    .order("created_at", { ascending: true });

  if (normalizedError) {
    return {
      data: [],
      source: "live",
      warning: `Falha ao consultar projetos: ${normalizedError.message}`,
    };
  }

  const [legacyTraffic, legacySales, legacyProducts] = await Promise.all([
    readQueryPages((from, to) => supabase
      .from("metricas_trafego")
      .select("projeto,date,invest,impressions,clicks,pageviews,checkouts")
      .gte("date", reportingStartDate)
      .lte("date", reportingEndDate)
      .order("date", { ascending: true }).order("projeto").range(from, to)),
    readQueryPages((from, to) => supabase
      .from("metricas_vendas")
      .select("projeto,date,core,fat_liquido")
      .gte("date", reportingStartDate)
      .lte("date", reportingEndDate)
      .order("date", { ascending: true }).order("projeto").range(from, to)),
    supabase.from("mapeamento_produtos").select("projeto"),
  ]);
  const legacyAvailable =
    !legacyTraffic.error && !legacySales.error;
  const legacyProjectSummaries = legacyAvailable
    ? aggregateLegacyData(
        (legacyTraffic.data ?? []) as LegacyTrafficRow[],
        (legacySales.data ?? []) as LegacySalesRow[],
        legacyProducts.error
          ? []
          : ((legacyProducts.data ?? []) as ProductMapRow[]),
      )
    : [];
  for (const project of legacyProjectSummaries) {
    const byDate = new Map(project.dailyMetrics.map(row => [row.date, row]));
    for (const cursor = new Date(`${reportingStartDate}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= reportingEndDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, { date, investment: 0, revenue: 0, coreSales: 0,
        impressions: 0, clicks: 0, pageViews: 0, checkouts: 0, revenueAvailable: false, trafficAvailable: false, salesAvailable: false });
    }
    project.dailyMetrics = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const activeNormalizedProjects = (normalizedProjects ?? []).filter(
    (project) => !project.deleted_at,
  );
  const normalizedSlugs = new Set(
    (normalizedProjects ?? []).map((project) => project.slug),
  );

  if (activeNormalizedProjects.length) {
    const projectIds = activeNormalizedProjects.map((project) => project.id);
    const [metrics, mappings, csvDaily] = await Promise.all([
      readQueryPages((from, to) => supabase
        .from("project_daily_metrics")
        .select(
          "project_id,metric_date,investment,revenue,impressions,clicks,page_views,checkouts,core_sales",
        )
        .in("project_id", projectIds)
        .gte("metric_date", reportingStartDate)
        .lte("metric_date", reportingEndDate)
        .order("metric_date", { ascending: true }).order("project_id").range(from, to)),
      supabase
        .from("product_mappings")
        .select("project_id")
        .in("project_id", projectIds)
        .is("effective_to", null),
      readQueryPages((from, to) => supabase
        .from("project_csv_daily_metrics")
        .select("project_id,metric_date,investment,impressions,clicks,page_views,checkouts,core_sales,order_bump_1_sales,order_bump_2_sales,order_bump_3_sales")
        .in("project_id", projectIds)
        .gte("metric_date", reportingStartDate).lte("metric_date", reportingEndDate)
        .order("metric_date").order("project_id").range(from, to)),
    ]);

    if (metrics.error || mappings.error || csvDaily.error) {
      return {
        data: [],
        source: "live",
        warning: `Falha ao carregar indicadores: ${metrics.error?.message ?? mappings.error?.message ?? csvDaily.error?.message}`,
      };
    }

    const projects = activeNormalizedProjects.map((project, index) => {
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
          revenueAvailable: false, salesAvailable: false, trafficAvailable: false,
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

      for (const row of (csvDaily.data ?? []) as NormalizedCsvDailyRow[]) {
        if (row.project_id !== project.id) continue;
        const metric = metricFor(row.metric_date);
        metric.investment = numberValue(row.investment);
        metric.impressions = numberValue(row.impressions);
        metric.clicks = numberValue(row.clicks);
        metric.pageViews = numberValue(row.page_views);
        metric.checkouts = numberValue(row.checkouts);
        metric.coreSales = numberValue(row.core_sales);
        metric.revenue = 0;
        metric.salesAvailable = true; metric.trafficAvailable = true;
      }

      const legacyProject = legacyProjectSummaries.find(
        (item) => item.id === project.slug,
      );
      for (const row of (legacyTraffic.data ?? []) as LegacyTrafficRow[]) {
        if (row.projeto !== project.slug) continue;
        const metric = metricFor(row.date);
        metric.investment = numberValue(row.invest);
        metric.trafficAvailable = row.invest !== null;
        metric.impressions = numberValue(row.impressions);
        metric.clicks = numberValue(row.clicks);
        metric.pageViews = numberValue(row.pageviews);
        metric.checkouts = numberValue(row.checkouts);
      }
      for (const row of (legacySales.data ?? []) as LegacySalesRow[]) {
        if (row.projeto !== project.slug) continue;
        const metric = metricFor(row.date);
        metric.revenue = numberValue(row.fat_liquido);
        metric.salesAvailable = true;
        metric.coreSales = numberValue(row.core);
      }
      // Normalized imports are authoritative when an upgraded project still has
      // legacy rows for the same slug and date.
      for (const row of (csvDaily.data ?? []) as NormalizedCsvDailyRow[]) {
        if (row.project_id !== project.id) continue;
        const metric = metricFor(row.metric_date);
        metric.investment = numberValue(row.investment);
        metric.impressions = numberValue(row.impressions);
        metric.clicks = numberValue(row.clicks);
        metric.pageViews = numberValue(row.page_views);
        metric.checkouts = numberValue(row.checkouts);
        metric.coreSales = numberValue(row.core_sales);
        metric.revenue = 0;
        metric.salesAvailable = true; metric.trafficAvailable = true;
      }
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
        products: Math.max(
          (mappings.data ?? []).filter((mapping) => mapping.project_id === project.id)
            .length,
          legacyProject?.products ?? 0,
        ),
        lastSyncAt: dailyMetrics.at(-1)?.date ?? null,
        dailyMetrics,
      } as ProjectSummary;
    });

    const audited = await readReconciledMetrics(supabase, projects.map(project => ({
      id: project.id,
      timezone: activeNormalizedProjects.find(row => row.id === project.id)?.reporting_timezone ?? "America/Sao_Paulo",
      baseline: project.dailyMetrics.map(row => ({ ...row, productMetrics: [] })),
    })), reportingStartDate, reportingEndDate);
    const qualityWarnings = await readMetricIntakeWarnings(supabase, projectIds, reportingStartDate, reportingEndDate);
    for (const project of projects) {
      project.qualityWarnings = qualityWarnings.get(project.id);
      const rows = audited.data.get(project.id);
      project.dailyMetrics = rows ?? project.dailyMetrics.map(row => ({ ...row, revenueAvailable: false, trafficAvailable: false, salesAvailable: false }));
      if (project.qualityWarnings?.length) project.dailyMetrics = project.dailyMetrics.map(row => ({ ...row, comparisonAvailable: false }));
      project.revenue = project.dailyMetrics.reduce((sum, row) => sum + row.revenue, 0);
      project.investment = project.dailyMetrics.reduce((sum, row) => sum + row.investment, 0);
      project.coreSales = project.dailyMetrics.reduce((sum, row) => sum + row.coreSales, 0);
    }
    return {
      data: [
        ...projects,
        ...legacyProjectSummaries.filter((project) => !normalizedSlugs.has(project.id)),
      ],
      source: "live",
      warning: audited.error ? `Não foi possível conferir as bases financeiras: ${audited.error.message}` : undefined,
    };
  }

  if (!legacyAvailable) {
    return {
      data: [],
      source: "live",
      warning:
        "O schema operacional ainda nao foi aplicado e as tabelas legadas nao estao disponiveis.",
    };
  }

  return {
    data: legacyProjectSummaries.filter((project) => !normalizedSlugs.has(project.id)),
    source: "live",
  };
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
    salesConnections: [],
    linkedMetaAccountId: null,
  };
  if (!supabase) return { ...emptyCatalog, warning: "Supabase nao configurado." };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,organization_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError || !project) {
    return {
      ...emptyCatalog,
      warning: projectError?.message ?? "Catalogo indisponivel para este projeto.",
    };
  }

  const [
    products,
    stages,
    mappings,
    metaAccounts,
    projectAccounts,
    salesConnections,
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id,connection_id,external_id,name,current_price,currency,source,archived_at",
      )
      .eq("organization_id", project.organization_id)
      .order("name"),
    supabase
      .from("funnel_stages")
      .select("id,name,stage_type,position,color,archived_at")
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
      .select("provider_account_id,project_id,is_primary")
      .eq("organization_id", project.organization_id),
    supabase
      .from("integration_connections")
      .select("id,name,provider")
      .eq("organization_id", project.organization_id)
      .neq("provider", "meta")
      .neq("provider", "google_forms")
      .is("revoked_at", null)
      .order("name"),
  ]);
  if (
    products.error ||
    stages.error ||
    mappings.error ||
    metaAccounts.error ||
    projectAccounts.error ||
    salesConnections.error
  ) {
    return {
      ...emptyCatalog,
      warning:
        products.error?.message ??
        stages.error?.message ??
        mappings.error?.message ??
        metaAccounts.error?.message ??
        projectAccounts.error?.message ??
        salesConnections.error?.message ??
        "Nao foi possivel carregar o catalogo.",
    };
  }

  const mappingByProduct = new Map(
    (mappings.data ?? []).map((mapping) => [mapping.product_id, mapping]),
  );
  const linkedAccounts = (projectAccounts.data ?? []).filter(
    (link) => link.project_id === projectId,
  );
  const linkedAccount = linkedAccounts.find((link) => link.is_primary) ?? linkedAccounts[0];
  const accountLinks = new Map(
    (projectAccounts.data ?? []).map((link) => [link.provider_account_id, link.project_id]),
  );
  return {
    products: (products.data ?? []).map((product) => {
      const mapping = mappingByProduct.get(product.id);
      return {
        id: product.id,
        connectionId: product.connection_id,
        externalId: product.external_id,
        name: product.name,
        price: numberValue(product.current_price),
        currency: product.currency,
        source: product.source,
        archivedAt: product.archived_at,
        stageId: mapping?.project_id === projectId ? mapping.funnel_stage_id : null,
        mappedProjectId: mapping?.project_id ?? null,
      };
    }),
    stages: (stages.data ?? []).map((stage) => ({
      id: stage.id,
      name: stage.name,
      type: stage.stage_type,
      position: stage.position,
      color: stage.color,
      archivedAt: stage.archived_at,
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
    linkedMetaAccountIds: linkedAccounts.map((link) => link.provider_account_id),
    salesConnections: (salesConnections.data ?? []).map((connection) => ({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      products: [],
    })),
  };
}

export async function getProjectAnalytics(
  projectId: string,
  catalog: ProjectCatalog,
  period?: { periodStart: string; periodEnd: string },
): Promise<ProjectAnalytics> {
  const supabase = await createSupabaseServerClient();
  const today = dateInTimezone(new Date());
  if (!supabase) {
    const project = demoProjects.find((item) => item.id === projectId);
    const dailyMetrics = (project?.dailyMetrics ?? []).map((metric) => ({
      ...metric,
      productMetrics: [],
    }));
    return {
      config: defaultProjectMetricConfig(today),
      configSaved: true,
      dataSources: {
        csvDailyRows: 0,
        metaTrafficRows: dailyMetrics.length,
        webhookSalesEvents: dailyMetrics.filter(
          (metric) => metric.revenue !== 0 || metric.coreSales !== 0,
        ).length,
        unmappedSalesEvents: 0,
      },
      dailyMetrics,
    };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,organization_id,slug,settings,reporting_timezone")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError || !project) {
    return {
      config: defaultProjectMetricConfig(today),
      configSaved: false,
      dataSources: {
        csvDailyRows: 0,
        metaTrafficRows: 0,
        webhookSalesEvents: 0,
        unmappedSalesEvents: 0,
      },
      dailyMetrics: [],
      warning: projectError?.message ?? "Projeto nao encontrado.",
    };
  }

  const settings =
    project.settings !== null &&
    typeof project.settings === "object" &&
    !Array.isArray(project.settings)
      ? (project.settings as Record<string, unknown>)
      : {};
  const projectToday = dateInTimezone(new Date(), project.reporting_timezone);
  const savedMetricSettings =
    settings.metrics !== null &&
    typeof settings.metrics === "object" &&
    !Array.isArray(settings.metrics)
      ? (settings.metrics as Record<string, unknown>)
      : {};
  const configSaved =
    typeof savedMetricSettings.trafficFeePercent === "number" &&
    typeof savedMetricSettings.companySharePercent === "number" &&
    typeof savedMetricSettings.baseCpa === "number" &&
    typeof savedMetricSettings.idealCpa === "number";
  const config = normalizeProjectMetricConfig({ ...savedMetricSettings, ...period }, projectToday);
  const salesConnectionId =
    typeof settings.sales_connection_id === "string" && settings.sales_connection_id
      ? settings.sales_connection_id
      : null;
  const startBuffer = new Date(`${config.periodStart}T00:00:00Z`);
  startBuffer.setUTCDate(startBuffer.getUTCDate() - 1);
  const endBuffer = new Date(`${config.periodEnd}T00:00:00Z`);
  endBuffer.setUTCDate(endBuffer.getUTCDate() + 2);

  const salesRequest = async () => {
    const data: SaleEventRow[] = [];
    const pageSize = 1000;

    for (let page = 0; page < 100; page += 1) {
      const from = page * pageSize;
      const response = await supabase
        .from("recognized_sales_events")
        .select(
          "id,event_type,event_at,currency,gross_amount,net_amount,payload,sales_event_items(id,product_id,funnel_stage_id,product_name_snapshot,stage_type_snapshot,quantity,gross_amount,net_amount,products(external_id))",
        )
        .eq("project_id", projectId)
        .in("event_type", [
          "PURCHASE_APPROVED",
          "PURCHASE_COMPLETED",
          "PURCHASE_REFUNDED",
        ])
        .gte("event_at", startBuffer.toISOString())
        .lt("event_at", endBuffer.toISOString())
        .order("event_at")
        .order("id")
        .range(from, from + pageSize - 1);
      if (response.error) return { data, error: response.error };

      const pageRows = (response.data ?? []) as unknown as SaleEventRow[];
      data.push(...pageRows);
      if (pageRows.length < pageSize) return { data, error: null };
    }

    return {
      data,
      error: { message: "O periodo excedeu o limite de 100 mil vendas." },
    };
  };

  const [
    metrics,
    metaTrafficCount,
    sales,
    webhookSalesCount,
    normalizedCsvDaily,
    normalizedCsvDailyCount,
    legacyTraffic,
    legacyTrafficCount,
    legacySales,
    legacySalesCount,
    legacyProducts,
    unmappedSalesCount,
  ] = await Promise.all([
    supabase
      .from("project_daily_metrics")
      .select(
        "metric_date,investment,revenue,impressions,clicks,page_views,checkouts,core_sales",
      )
      .eq("project_id", projectId)
      .gte("metric_date", config.periodStart)
      .lte("metric_date", config.periodEnd)
      .order("metric_date"),
    supabase
      .from("traffic_metrics_daily")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .eq("source", "meta")
      .gte("metric_date", config.periodStart)
      .lte("metric_date", config.periodEnd),
    salesRequest(),
    supabase
      .from("sales_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .in("event_type", [
        "PURCHASE_APPROVED",
        "PURCHASE_COMPLETED",
        "PURCHASE_REFUNDED",
      ])
      .gte("event_at", startBuffer.toISOString())
      .lt("event_at", endBuffer.toISOString()),
    supabase
      .from("project_csv_daily_metrics")
      .select("project_id,metric_date,investment,impressions,clicks,page_views,checkouts,core_sales,order_bump_1_sales,order_bump_2_sales,order_bump_3_sales")
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .gte("metric_date", config.periodStart)
      .lte("metric_date", config.periodEnd)
      .order("metric_date"),
    supabase
      .from("project_csv_daily_metrics")
      .select("metric_date", { count: "exact", head: true })
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .gte("metric_date", config.periodStart)
      .lte("metric_date", config.periodEnd),
    supabase
      .from("metricas_trafego")
      .select("projeto,date,invest,impressions,clicks,pageviews,checkouts")
      .eq("projeto", project.slug)
      .gte("date", config.periodStart)
      .lte("date", config.periodEnd)
      .order("date"),
    supabase
      .from("metricas_trafego")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", project.organization_id)
      .eq("projeto", project.slug)
      .gte("date", config.periodStart)
      .lte("date", config.periodEnd),
    supabase
      .from("metricas_vendas")
      .select("projeto,date,core,ob1,ob2,ob3,ob4,ob5,up1,up2,ds1,ds2,fat_liquido")
      .eq("projeto", project.slug)
      .gte("date", config.periodStart)
      .lte("date", config.periodEnd)
      .order("date"),
    supabase
      .from("metricas_vendas")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", project.organization_id)
      .eq("projeto", project.slug)
      .gte("date", config.periodStart)
      .lte("date", config.periodEnd),
    supabase
      .from("mapeamento_produtos")
      .select("product_id,projeto,campo,nome_produto")
      .eq("projeto", project.slug),
    salesConnectionId
      ? supabase
          .from("sales_events")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", project.organization_id)
          .eq("connection_id", salesConnectionId)
          .is("project_id", null)
          .in("event_type", [
            "PURCHASE_APPROVED",
            "PURCHASE_COMPLETED",
            "PURCHASE_REFUNDED",
          ])
          .gte("event_at", startBuffer.toISOString())
          .lt("event_at", endBuffer.toISOString())
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const historicalProductIds = Array.from(
    new Set(
      sales.data.flatMap((event) =>
        (event.sales_event_items ?? [])
          .map((item) => item.product_id)
          .filter((productId): productId is string => Boolean(productId)),
      ),
    ),
  ).filter((productId) => !products.has(productId));
  let historicalProductsError: { message: string } | null = null;
  for (let index = 0; index < historicalProductIds.length; index += 500) {
    const productIds = historicalProductIds.slice(index, index + 500);
    const response = await supabase
      .from("products")
      .select("id,name,current_price,currency")
      .in("id", productIds);
    if (response.error) {
      historicalProductsError = response.error;
      break;
    }
    for (const product of response.data ?? []) {
      products.set(product.id, {
        id: product.id,
        connectionId: null,
        externalId: product.id,
        name: product.name,
        price: numberValue(product.current_price),
        currency: product.currency,
        source: "provider",
        archivedAt: null,
        stageId: null,
        mappedProjectId: projectId,
      });
    }
  }

  const rows = new Map<string, ProjectDailyMetric>();
  const metricFor = (date: string) => {
    const metric = rows.get(date) ?? {
      date,
      investment: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
      pageViews: 0,
      checkouts: 0,
      coreSales: 0,
      productMetrics: [],
      revenueAvailable: false, salesAvailable: false, trafficAvailable: false,
    };
    rows.set(date, metric);
    return metric;
  };
  const stageById = new Map(catalog.stages.map((stage) => [stage.id, stage]));
  const mappedProducts = catalog.products.filter(
    (product) => product.mappedProjectId === projectId && product.stageId && !product.archivedAt,
  );
  const coreProduct = mappedProducts.find((product) => product.id === config.ticketProductId) ??
    mappedProducts.find((product) =>
      ["core", "front_end", "low_ticket"].includes(
        stageById.get(product.stageId ?? "")?.type ?? "",
      )
    );
  const orderBumpProducts = mappedProducts
    .filter((product) => stageById.get(product.stageId ?? "")?.type === "order_bump")
    .sort((a, b) =>
      (stageById.get(a.stageId ?? "")?.position ?? 0) -
        (stageById.get(b.stageId ?? "")?.position ?? 0) ||
      a.name.localeCompare(b.name)
    )
    .slice(0, 3);
  const normalizedCsvDates = new Set(
    ((normalizedCsvDaily.data ?? []) as NormalizedCsvDailyRow[]).map((row) => row.metric_date),
  );
  const applyNormalizedCsv = (row: NormalizedCsvDailyRow) => {
    const metric = metricFor(row.metric_date);
    const quantities = [
      numberValue(row.order_bump_1_sales),
      numberValue(row.order_bump_2_sales),
      numberValue(row.order_bump_3_sales),
    ];
    metric.investment = numberValue(row.investment);
    metric.impressions = numberValue(row.impressions);
    metric.clicks = numberValue(row.clicks);
    metric.pageViews = numberValue(row.page_views);
    metric.checkouts = numberValue(row.checkouts);
    metric.coreSales = numberValue(row.core_sales);
    metric.salesAvailable = true; metric.trafficAvailable = true;
    metric.csvDaily = {
      core: metric.coreSales,
      ob1: quantities[0],
      ob2: quantities[1],
      ob3: quantities[2],
    };
    metric.productMetrics = [
      {
        productId: coreProduct?.id ?? "csv-core",
        stageId: coreProduct?.stageId ?? "csv-stage-core",
        productName: coreProduct?.name ?? "Core",
        stageType: "core",
        quantity: metric.coreSales,
        revenue: 0, revenueAvailable: false,
      },
      ...quantities.map((quantity, index) => ({
        productId: orderBumpProducts[index]?.id ?? `csv-ob-${index + 1}`,
        stageId: orderBumpProducts[index]?.stageId ?? `csv-stage-ob-${index + 1}`,
        productName: orderBumpProducts[index]?.name ?? `OB${index + 1}`,
        stageType: "order_bump" as const,
        quantity,
        revenue: 0, revenueAvailable: false,
      })),
    ];
    metric.revenue = metric.productMetrics.reduce((sum, product) => sum + product.revenue, 0);
  };

  for (const row of metrics.data ?? []) {
    const metric = metricFor(row.metric_date);
    metric.investment = numberValue(row.investment);
    metric.revenue = numberValue(row.revenue);
    metric.impressions = numberValue(row.impressions);
    metric.clicks = numberValue(row.clicks);
    metric.pageViews = numberValue(row.page_views);
    metric.checkouts = numberValue(row.checkouts);
    metric.coreSales = numberValue(row.core_sales);
  }

  if (!normalizedCsvDaily.error) {
    for (const row of (normalizedCsvDaily.data ?? []) as NormalizedCsvDailyRow[]) {
      applyNormalizedCsv(row);
    }
  }

  if (!legacyTraffic.error) {
    for (const row of (legacyTraffic.data ?? []) as LegacyTrafficRow[]) {
      const metric = metricFor(row.date);
      metric.investment = numberValue(row.invest);
      metric.trafficAvailable = row.invest !== null;
      metric.impressions = numberValue(row.impressions);
      metric.clicks = numberValue(row.clicks);
      metric.pageViews = numberValue(row.pageviews);
      metric.checkouts = numberValue(row.checkouts);
    }
  }
  if (!legacySales.error) {
    for (const row of (legacySales.data ?? []) as LegacySalesRow[]) {
      const metric = metricFor(row.date);
      metric.revenue = numberValue(row.fat_liquido);
      metric.coreSales = numberValue(row.core);
      metric.salesAvailable = true;
      metric.csvDaily = {
        core: numberValue(row.core),
        ob1: numberValue(row.ob1),
        ob2: numberValue(row.ob2),
        ob3: numberValue(row.ob3),
      };
    }
  }

  // Reapply normalized rows after the compatibility overlay. Existing legacy
  // history remains visible until a date is superseded by a normalized import.
  if (!normalizedCsvDaily.error) {
    for (const row of (normalizedCsvDaily.data ?? []) as NormalizedCsvDailyRow[]) {
      applyNormalizedCsv(row);
    }
  }

  const stages = new Map(catalog.stages.map((stage) => [stage.id, stage]));
  for (const event of sales.data) {
    if (event.currency !== "BRL") continue;
    const eventDate = dateInTimezone(new Date(event.event_at), project.reporting_timezone);
    if (eventDate < config.periodStart || eventDate > config.periodEnd) continue;
    if (normalizedCsvDates.has(eventDate)) continue;
    const metric = metricFor(eventDate);

    for (const item of event.sales_event_items ?? []) {
      const stage = item.funnel_stage_id ? stages.get(item.funnel_stage_id) : null;
      const product = item.product_id ? products.get(item.product_id) : null;
      const stageType = item.stage_type_snapshot ?? stage?.type;
      const productName = item.product_name_snapshot ?? product?.name;
      const productId = item.product_id ?? `historical-${item.id}`;
      const stageId = item.funnel_stage_id ?? `historical-${item.id}`;
      if (!stageType || !productName) continue;
      const current = metric.productMetrics.find(
        (productMetric) =>
          productMetric.productId === productId && productMetric.stageId === stageId,
      ) ?? {
        productId,
        stageId,
        productName,
        stageType,
        quantity: 0,
        revenue: 0,
      } satisfies ProductDailyMetric;
      const sign = event.event_type === "PURCHASE_REFUNDED" ? -1 : 1;
      current.quantity += sign * numberValue(item.quantity);
      current.revenue += numberValue(item.net_amount);
      if (
        !metric.productMetrics.some(
          (itemMetric) =>
            itemMetric.productId === productId && itemMetric.stageId === stageId,
        )
      ) {
        metric.productMetrics.push(current);
      }
    }
  }

  if (!legacySales.error) {
    const mappings = new Map(
      ((legacyProducts.data ?? []) as LegacyProductMapRow[]).map((mapping) => [
        mapping.campo.toLowerCase(),
        mapping,
      ]),
    );
    const legacyFields = [
      "core",
      "ob1",
      "ob2",
      "ob3",
      "ob4",
      "ob5",
      "up1",
      "up2",
      "ds1",
      "ds2",
    ] as const;

    const legacyRows = (legacySales.data ?? []) as LegacySalesRow[];
    for (const row of legacyRows) {
      const metric = metricFor(row.date);
      if (metric.productMetrics.length) continue;
      for (const field of legacyFields) {
        const quantity = numberValue(row[field]);
        if (!quantity) continue;
        const mapping = mappings.get(field);
        const stageType: ProductDailyMetric["stageType"] = field === "core"
          ? "core"
          : field.startsWith("ob")
            ? "order_bump"
            : field.startsWith("up")
              ? "upsell"
              : "downsell";
        const stageIndex = field === "core" ? 0 : Math.max(0, Number(field.slice(2)) - 1);
        const catalogStage = [...catalog.stages]
          .filter((stage) => stage.type === stageType && !stage.archivedAt)
          .sort((a, b) => a.position - b.position)[stageIndex];
        const catalogProduct = catalog.products.find(
          (product) =>
            product.mappedProjectId === projectId && product.stageId === catalogStage?.id,
        );
        metric.productMetrics.push({
          productId: catalogProduct?.id ?? mapping?.product_id ?? `legacy-${field}`,
          stageId: catalogStage?.id ?? `legacy-stage-${field}`,
          productName:
            catalogProduct?.name ?? mapping?.nome_produto ?? field.toUpperCase(),
          stageType,
          quantity,
          revenue: 0,
        });
      }
    }
  }

  const cursor = new Date(`${config.periodStart}T00:00:00Z`);
  const lastDate = new Date(`${config.periodEnd}T00:00:00Z`);
  while (cursor <= lastDate) {
    metricFor(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const importHistory = await supabase
    .from("metric_imports")
    .select(
      "id,original_filename,content_sha256,rows_written,period_start,period_end,created_at",
    )
    .eq("organization_id", project.organization_id)
    .eq("project_id", projectId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(50);

  const warning =
    metrics.error?.message ??
    metaTrafficCount.error?.message ??
    sales.error?.message ??
    webhookSalesCount.error?.message ??
    normalizedCsvDaily.error?.message ??
    normalizedCsvDailyCount.error?.message ??
    legacyTraffic.error?.message ??
    legacyTrafficCount.error?.message ??
    legacySales.error?.message ??
    legacySalesCount.error?.message ??
    legacyProducts.error?.message ??
    unmappedSalesCount.error?.message ??
    importHistory.error?.message ??
    historicalProductsError?.message;
  const normalizedCsvDateSet = new Set(
    ((normalizedCsvDaily.data ?? []) as NormalizedCsvDailyRow[]).map(
      (row) => row.metric_date,
    ),
  );
  const legacyCsvDateSet = new Set(
    [
      ...((legacyTraffic.data ?? []) as LegacyTrafficRow[]).map((row) => row.date),
      ...((legacySales.data ?? []) as LegacySalesRow[]).map((row) => row.date),
    ].filter((date) => !normalizedCsvDateSet.has(date)),
  );
  const audited = await readReconciledMetrics(supabase, [{ id: projectId,
    timezone: project.reporting_timezone ?? "America/Sao_Paulo", baseline: Array.from(rows.values()),
  }], config.periodStart, config.periodEnd);
  const qualityWarnings = await readMetricIntakeWarnings(supabase, [projectId], config.periodStart, config.periodEnd);
  return {
    config,
    configSaved,
    qualityWarnings: qualityWarnings.get(projectId),
    observedSales: sales.error ? [] : sales.data.flatMap((event) => observedSaleFromEvent(
      event, dateInTimezone(new Date(event.event_at), project.reporting_timezone),
    )),
    dataSources: {
      csvDailyRows:
        normalizedCsvDateSet.size + legacyCsvDateSet.size,
      metaTrafficRows: metaTrafficCount.count ?? 0,
      webhookSalesEvents: webhookSalesCount.count ?? 0,
      unmappedSalesEvents: unmappedSalesCount.count ?? 0,
    },
    dailyMetrics: (audited.data.get(projectId) ?? Array.from(rows.values()).map(row => ({ ...row, revenueAvailable: false, trafficAvailable: false, salesAvailable: false })))
      .map(row => ({ ...row, comparisonAvailable: !qualityWarnings.get(projectId)?.length })),
    imports: (importHistory.data ?? []).map((item) => ({
      id: item.id,
      filename: item.original_filename,
      sha256: item.content_sha256,
      rows: Number(item.rows_written),
      periodStart: item.period_start,
      periodEnd: item.period_end,
      importedAt: item.created_at,
    })),
    ...((warning ?? audited.error?.message) ? { warning: warning ?? audited.error?.message } : {}),
  };
}

export async function getProjectFormsData(projectId: string): Promise<ProjectFormsData> {
  const supabase = await createSupabaseServerClient();
  const empty: ProjectFormsData = {
    connections: [],
    forms: [],
    contacts: [],
    utms: [],
    recoveryAttempts: [],
  };
  if (!supabase) return empty;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,organization_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError || !project) {
    return {
      ...empty,
      warning: projectError?.message ?? "Projeto nao encontrado para formularios.",
    };
  }

  const [connections, forms, analytics, contacts, utms, recoveryAttempts] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id,name,status")
      .eq("organization_id", project.organization_id)
      .eq("provider", "google_forms")
      .is("revoked_at", null)
      .order("created_at"),
    supabase
      .from("google_forms")
      .select(
        "id,title,external_form_id,responder_uri,schema_version,last_synced_at,last_error",
      )
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_form_analytics")
      .select(
        "google_form_id,total_responses,unique_respondents,matched_responses,unresolved_responses,conflict_responses,latest_response_at",
      )
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId),
    supabase
      .from("contacts")
      .select("id,name,email,phone,source,last_seen_at,created_at")
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(100),
    supabase
      .from("project_utm_analytics")
      .select(
        "utm_campaign_id,utm_source,utm_medium,utm_campaign,contacts,responses,latest_touch_at",
      )
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .order("latest_touch_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase
      .from("checkout_recovery_attempts")
      .select(
        "id,status,amount,currency,offer_external_id,checkout_url,first_seen_at,last_seen_at,recovered_at,contacts(name,email,phone),utm_campaigns(utm_source,utm_medium,utm_campaign)",
      )
      .eq("organization_id", project.organization_id)
      .eq("project_id", projectId)
      .order("last_seen_at", { ascending: false })
      .limit(100),
  ]);

  const warning =
    connections.error?.message ??
    forms.error?.message ??
    analytics.error?.message ??
    contacts.error?.message ??
    utms.error?.message ??
    recoveryAttempts.error?.message;
  if (warning) return { ...empty, warning };

  const analyticsByForm = new Map(
    (analytics.data ?? []).map((row) => [row.google_form_id, row]),
  );

  return {
    connections: (connections.data ?? []).map((connection) => ({
      id: connection.id,
      name: connection.name,
      status: connection.status,
    })),
    forms: (forms.data ?? []).map((form) => {
      const formAnalytics = analyticsByForm.get(form.id);
      return {
        id: form.id,
        title: form.title,
        externalFormId: form.external_form_id,
        responderUri: form.responder_uri,
        schemaVersion: Number(form.schema_version ?? 0),
        totalResponses: Number(formAnalytics?.total_responses ?? 0),
        uniqueRespondents: Number(formAnalytics?.unique_respondents ?? 0),
        matchedResponses: Number(formAnalytics?.matched_responses ?? 0),
        unresolvedResponses: Number(formAnalytics?.unresolved_responses ?? 0),
        conflictResponses: Number(formAnalytics?.conflict_responses ?? 0),
        latestResponseAt: formAnalytics?.latest_response_at ?? null,
        lastSyncedAt: form.last_synced_at,
        lastError: form.last_error,
      };
    }),
    contacts: (contacts.data ?? []).map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      source: contact.source,
      lastSeenAt: contact.last_seen_at,
      createdAt: contact.created_at,
    })),
    utms: (utms.data ?? []).map((utm) => ({
      id: utm.utm_campaign_id,
      source: utm.utm_source,
      medium: utm.utm_medium,
      campaign: utm.utm_campaign,
      contacts: Number(utm.contacts ?? 0),
      responses: Number(utm.responses ?? 0),
      latestTouchAt: utm.latest_touch_at,
    })),
    recoveryAttempts: (recoveryAttempts.data ?? []).map((attempt) => {
      const contact = Array.isArray(attempt.contacts)
        ? attempt.contacts[0]
        : attempt.contacts;
      const utm = Array.isArray(attempt.utm_campaigns)
        ? attempt.utm_campaigns[0]
        : attempt.utm_campaigns;
      return {
        id: attempt.id,
        status: attempt.status,
        amount: Number(attempt.amount ?? 0),
        currency: attempt.currency,
        offerExternalId: attempt.offer_external_id,
        checkoutUrl: attempt.checkout_url,
        firstSeenAt: attempt.first_seen_at,
        lastSeenAt: attempt.last_seen_at,
        recoveredAt: attempt.recovered_at,
        contactName: contact?.name ?? null,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        utmSource: utm?.utm_source ?? null,
        utmMedium: utm?.utm_medium ?? null,
        utmCampaign: utm?.utm_campaign ?? null,
      };
    }),
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

export async function getSalesConnectionsForOnboarding(): Promise<SalesConnectionOption[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data: connections, error: connectionError } = await supabase
    .from("integration_connections")
    .select("id,name,provider,status")
    .neq("provider", "meta")
    .neq("provider", "google_forms")
    .in("status", ["connected", "attention"])
    .is("revoked_at", null)
    .order("created_at");
  if (connectionError || !connections?.length) return [];

  const usableConnections = connections.filter(connection => connection.status === "connected" || connection.provider === "payt" || connection.provider === "assiny");
  const connectionIds = usableConnections.map((connection) => connection.id);
  if (!connectionIds.length) return [];
  const [products, mappings] = await Promise.all([
    supabase
      .from("products")
      .select("id,connection_id,external_id,name,current_price,currency")
      .in("connection_id", connectionIds)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name"),
    supabase.from("product_mappings").select("product_id").is("effective_to", null),
  ]);
  if (products.error || mappings.error) return [];
  const mappedProductIds = new Set((mappings.data ?? []).map((mapping) => mapping.product_id));

  return usableConnections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    products: (products.data ?? [])
      .filter(
        (product) =>
          product.connection_id === connection.id && !mappedProductIds.has(product.id),
      )
      .map((product) => ({
        id: product.id,
        externalId: product.external_id,
        name: product.name,
        price: numberValue(product.current_price),
        currency: product.currency,
      })),
  }));
}

export async function getConnections(options: { includeArchived?: boolean } = {}): Promise<
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
      "id,name,provider,status,business_id,app_id,system_user_id,last_verified_at,last_error,archived_at:metadata->>genesis_archived_at,provider_accounts(count),products(count)",
    )
    .order("created_at", { ascending: true });

  if (error) return { data: [], source: "live", warning: error.message };

  const connections = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    provider: row.provider as IntegrationConnection["provider"],
    status: row.status as IntegrationConnection["status"],
    businessId: row.business_id ? String(row.business_id) : undefined,
    appId: row.app_id ? String(row.app_id) : undefined,
    systemUserId: row.system_user_id ? String(row.system_user_id) : undefined,
    accountCount: Array.isArray(row.provider_accounts)
      ? Number(row.provider_accounts[0]?.count ?? 0)
      : 0,
    productCount: Array.isArray(row.products)
      ? Number(row.products[0]?.count ?? 0)
      : 0,
    lastVerifiedAt: row.last_verified_at
      ? String(row.last_verified_at)
      : null,
    lastError: row.last_error ? String(row.last_error) : undefined,
    archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
  }));

  return {
    data: options.includeArchived
      ? connections
      : connections.filter(connection => connection.status !== "revoked" || !connection.archivedAt),
    source: "live",
  };
}

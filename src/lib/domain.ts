export const providers = [
  "meta",
  "hotmart",
  "eduzz",
  "kiwify",
  "hubla",
] as const;

export const operationalProviders = [...providers] as const;
export const salesProviders = ["hotmart", "eduzz", "kiwify", "hubla"] as const;
export const verifiableProviders = ["meta", "hotmart", "eduzz", "kiwify"] as const;
export const catalogProviders = ["hotmart", "eduzz", "kiwify"] as const;
export const funnelStageTypes = [
  "core",
  "order_bump",
  "upsell",
  "downsell",
  "low_ticket",
  "front_end",
  "middle_end",
  "back_end",
] as const;

export type Provider = (typeof providers)[number];
export type SalesProvider = (typeof salesProviders)[number];
export type ConnectionStatus =
  | "connected"
  | "attention"
  | "disconnected"
  | "revoked";
export type ProjectStatus = "active" | "draft" | "paused" | "archived";
export type FunnelStageType = (typeof funnelStageTypes)[number];
export type ProductSource = "provider" | "manual";

export interface DailyMetric {
  date: string;
  investment: number;
  revenue: number;
  impressions: number;
  clicks: number;
  pageViews: number;
  checkouts: number;
  coreSales: number;
}

export interface ProductDailyMetric {
  productId: string;
  stageId: string;
  productName: string;
  stageType: FunnelStageType;
  quantity: number;
  revenue: number;
}

export interface ProjectDailyMetric extends DailyMetric {
  productMetrics: ProductDailyMetric[];
}

export interface ProjectMetricConfig {
  periodStart: string;
  periodEnd: string;
  trafficFeePercent: number;
  plannedTrafficInvestment: number;
  manychatCost: number;
  companyCosts: number;
  otherCosts: number;
  companySharePercent: number;
  ticketBudget: number;
  apiBudget: number;
  remarketingBudget: number;
  distributionBudget: number;
  baseCpa: number;
  idealCpa: number;
  historicalAttendance: number;
  historicalTicketSales: number;
  historicalFormationSales: number;
  studentGroupLeads: number;
  studentGroupTarget: number;
  buyerGroupLeads: number;
  buyerGroupTarget: number;
  captureLeads: number;
  captureTarget: number;
  ticketNetPrice: number;
  formationNetPrice: number;
  ticketProductId: string | null;
  formationProductId: string | null;
  downsellProductId: string | null;
}

export interface ProjectAnalytics {
  config: ProjectMetricConfig;
  configSaved: boolean;
  dataSources: {
    csvTrafficRows: number;
    csvSalesRows: number;
    metaTrafficRows: number;
    webhookSalesEvents: number;
  };
  dailyMetrics: ProjectDailyMetric[];
  warning?: string;
}

export interface ProjectSummary {
  id: string;
  legacy?: boolean;
  name: string;
  expertName: string;
  status: ProjectStatus;
  color: string;
  initials: string;
  monthlyTarget: number;
  marginTarget: number;
  investment: number;
  revenue: number;
  coreSales: number;
  products: number;
  lastSyncAt: string | null;
  dailyMetrics: DailyMetric[];
}

export interface IntegrationConnection {
  id: string;
  name: string;
  provider: Provider;
  status: ConnectionStatus;
  businessId?: string;
  appId?: string;
  systemUserId?: string;
  accountCount: number;
  productCount: number;
  lastVerifiedAt: string | null;
  lastError?: string;
}

export interface ProjectProduct {
  id: string;
  connectionId: string | null;
  externalId: string;
  name: string;
  price: number;
  currency: string;
  source: ProductSource;
  archivedAt: string | null;
  stageId: string | null;
  mappedProjectId: string | null;
}

export interface ProjectFunnelStage {
  id: string;
  name: string;
  type: FunnelStageType;
  position: number;
  color: string | null;
  archivedAt: string | null;
}

export interface ProjectCatalog {
  products: ProjectProduct[];
  stages: ProjectFunnelStage[];
  metaAccounts: MetaAccountOption[];
  salesConnections: SalesConnectionOption[];
  linkedMetaAccountId: string | null;
  warning?: string;
}

export interface SalesConnectionOption {
  id: string;
  name: string;
  provider: SalesProvider;
  products: SalesProductOption[];
}

export interface SalesProductOption {
  id: string;
  externalId: string;
  name: string;
  price: number;
  currency: string;
}

export interface MetaAccountOption {
  id: string;
  externalId: string;
  name: string;
}

export interface MetaConnectionOption {
  id: string;
  name: string;
  accounts: MetaAccountOption[];
}

export interface FunnelStage {
  id: string;
  name: string;
  type: FunnelStageType;
  position: number;
  price: number;
  quantity: number;
  conversionRate: number;
}

export const providerLabels: Record<Provider, string> = {
  meta: "Meta Ads",
  hotmart: "Hotmart",
  eduzz: "Eduzz",
  kiwify: "Kiwify",
  hubla: "Hubla",
};

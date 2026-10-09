export const providers = [
  "meta",
  "hotmart",
  "eduzz",
  "kiwify",
  "hubla",
  "payt",
  "assiny",
  "google_forms",
] as const;

export const operationalProviders = [
  "meta",
  "hotmart",
  "eduzz",
  "kiwify",
  "hubla",
  "payt",
  "assiny",
] as const;
export const salesProviders = ["hotmart", "eduzz", "kiwify", "hubla", "payt", "assiny"] as const;
export const verifiableProviders = ["meta", "hotmart", "eduzz", "kiwify", "google_forms"] as const;
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
  // Availability describes the recorded source, not reconciliation with the gateway's complete history.
  revenueAvailable?: boolean;
  trafficAvailable?: boolean;
  salesAvailable?: boolean;
  comparisonAvailable?: boolean;
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
  revenueAvailable?: boolean;
  approvedQuantity?: number;
  productId: string;
  stageId: string;
  productName: string;
  stageType: FunnelStageType;
  quantity: number;
  revenue: number;
}

export interface ProjectDailyMetric extends DailyMetric {
  productMetrics: ProductDailyMetric[];
  csvDaily?: {
    core: number;
    ob1: number;
    ob2: number;
    ob3: number;
  };
}

export interface ProjectMetricConfig {
  automaticMetrics?: Partial<Record<AutomaticMetricField, boolean>>;
  periodStart: string;
  periodEnd: string;
  trafficFeePercent: number;
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
  orderBump1NetPrice: number;
  orderBump2NetPrice: number;
  orderBump3NetPrice: number;
  formationNetPrice: number;
  ticketProductId: string | null;
  formationProductId: string | null;
  downsellProductId: string | null;
}

export type AutomaticMetricField = "baseCpa" | "ticketNetPrice" | "formationNetPrice" |
  "orderBump1NetPrice" | "orderBump2NetPrice" | "orderBump3NetPrice" |
  "historicalTicketSales" | "historicalFormationSales";

// Only aggregateable financial facts cross the server/client boundary here.
export interface ObservedProductSale {
  date: string;
  productId: string;
  quantity: number;
  refunded: boolean;
  payout: number | null;
  afterFees: number | null;
}

export interface ProjectAnalytics {
  qualityWarnings?: string[];
  observedSales?: ObservedProductSale[];
  config: ProjectMetricConfig;
  configSaved: boolean;
  dataSources: {
    csvDailyRows: number;
    metaTrafficRows: number;
    webhookSalesEvents: number;
    unmappedSalesEvents: number;
    unmappedSalesProducts?: string[];
  };
  dailyMetrics: ProjectDailyMetric[];
  imports?: {
    id: string;
    filename: string;
    sha256: string;
    rows: number;
    periodStart: string;
    periodEnd: string;
    importedAt: string;
  }[];
  warning?: string;
}

export interface ProjectSummary {
  qualityWarnings?: string[];
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
  archivedAt?: string | null;
}

export interface GoogleFormsConnectionOption {
  id: string;
  name: string;
  status: ConnectionStatus;
}

export interface ProjectGoogleForm {
  id: string;
  title: string;
  externalFormId: string;
  responderUri: string | null;
  schemaVersion: number;
  totalResponses: number;
  uniqueRespondents: number;
  matchedResponses: number;
  unresolvedResponses: number;
  conflictResponses: number;
  latestResponseAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface ProjectContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface ProjectUtmAnalytics {
  id: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  contacts: number;
  responses: number;
  latestTouchAt: string | null;
}

export interface ProjectCheckoutRecoveryAttempt {
  id: string;
  status: "abandoned" | "pending" | "failed" | "expired" | "recovered";
  amount: number;
  currency: string;
  offerExternalId: string | null;
  checkoutUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  recoveredAt: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface ProjectFormsData {
  connections: GoogleFormsConnectionOption[];
  forms: ProjectGoogleForm[];
  contacts: ProjectContact[];
  utms: ProjectUtmAnalytics[];
  recoveryAttempts: ProjectCheckoutRecoveryAttempt[];
  warning?: string;
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
  linkedMetaAccountIds?: string[];
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
  payt: "Payt",
  assiny: "Assiny",
  google_forms: "Google Forms",
};

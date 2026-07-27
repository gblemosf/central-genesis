export const providers = [
  "meta",
  "hotmart",
  "eduzz",
  "kiwify",
  "hubla",
] as const;

export type Provider = (typeof providers)[number];
export type ConnectionStatus =
  | "connected"
  | "attention"
  | "disconnected"
  | "revoked";
export type ProjectStatus = "active" | "draft" | "paused" | "archived";
export type FunnelStageType =
  | "core"
  | "order_bump"
  | "upsell"
  | "downsell"
  | "low_ticket"
  | "front_end"
  | "middle_end"
  | "back_end";

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

export interface ProjectSummary {
  id: string;
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
  accountCount: number;
  lastVerifiedAt: string | null;
  lastError?: string;
}

export interface ProjectProduct {
  id: string;
  externalId: string;
  name: string;
  price: number;
  currency: string;
  stageId: string | null;
  mappedProjectId: string | null;
}

export interface ProjectFunnelStage {
  id: string;
  name: string;
  type: FunnelStageType;
  position: number;
}

export interface ProjectCatalog {
  products: ProjectProduct[];
  stages: ProjectFunnelStage[];
  metaAccounts: MetaAccountOption[];
  linkedMetaAccountId: string | null;
  warning?: string;
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

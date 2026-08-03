import type {
  DailyMetric,
  FunnelStage,
  IntegrationConnection,
  ProjectSummary,
} from "@/lib/domain";

function makeMetrics(
  multiplier: number,
  revenueMultiplier: number,
): DailyMetric[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = index + 1;
    const investment = Math.round((430 + day * 17) * multiplier * 100) / 100;
    const revenue =
      Math.round(
        investment * (0.74 + ((day * 7) % 11) / 20) * revenueMultiplier * 100,
      ) / 100;

    return {
      date: `2026-07-${String(day).padStart(2, "0")}`,
      investment,
      revenue,
      impressions: Math.round(21800 * multiplier + day * 740),
      clicks: Math.round(710 * multiplier + day * 29),
      pageViews: Math.round(445 * multiplier + day * 19),
      checkouts: Math.round(42 * multiplier + day * 2.3),
      coreSales: Math.round(17 * multiplier + day * 0.9),
    };
  });
}

export const demoProjects: ProjectSummary[] = [
  {
    id: "colorista",
    name: "Colorista Pro",
    expertName: "Gi Quintino",
    status: "active",
    color: "#ff6b5e",
    initials: "CP",
    monthlyTarget: 100000,
    marginTarget: 65,
    investment: 101562.09,
    revenue: 56653.04,
    coreSales: 3062,
    products: 4,
    lastSyncAt: "2026-07-27T11:05:00-03:00",
    dailyMetrics: makeMetrics(1.18, 1.42),
  },
  {
    id: "pesca",
    name: "Pesca Amazonica",
    expertName: "Projeto Pesca",
    status: "active",
    color: "#61d6c8",
    initials: "PA",
    monthlyTarget: 85000,
    marginTarget: 60,
    investment: 70535.16,
    revenue: 25612.19,
    coreSales: 895,
    products: 6,
    lastSyncAt: "2026-07-27T11:05:00-03:00",
    dailyMetrics: makeMetrics(0.82, 1.16),
  },
  {
    id: "novo-expert",
    name: "Novo Expert",
    expertName: "Onboarding pendente",
    status: "draft",
    color: "#f5c451",
    initials: "NE",
    monthlyTarget: 60000,
    marginTarget: 60,
    investment: 0,
    revenue: 0,
    coreSales: 0,
    products: 0,
    lastSyncAt: null,
    dailyMetrics: [],
  },
];

export const demoConnections: IntegrationConnection[] = [
  {
    id: "meta-bm-1",
    name: "Genesis BM Principal",
    provider: "meta",
    status: "connected",
    businessId: "BM configurado",
    accountCount: 2,
    productCount: 0,
    lastVerifiedAt: "2026-07-27T13:42:00-03:00",
  },
  {
    id: "meta-bm-2",
    name: "Genesis BM Secundario",
    provider: "meta",
    status: "attention",
    businessId: "Aguardando configuracao",
    accountCount: 0,
    productCount: 0,
    lastVerifiedAt: null,
  },
  {
    id: "hotmart-main",
    name: "Hotmart Colorista",
    provider: "hotmart",
    status: "connected",
    accountCount: 4,
    productCount: 4,
    lastVerifiedAt: "2026-07-27T12:20:00-03:00",
  },
];

export const defaultFunnel: FunnelStage[] = [
  {
    id: "low-ticket",
    name: "Low Ticket",
    type: "low_ticket",
    position: 1,
    price: 19.9,
    quantity: 1000,
    conversionRate: 0,
  },
  {
    id: "front-end",
    name: "Front VSL",
    type: "front_end",
    position: 2,
    price: 147,
    quantity: 120,
    conversionRate: 12,
  },
  {
    id: "middle-end",
    name: "Middle End",
    type: "middle_end",
    position: 3,
    price: 497,
    quantity: 30,
    conversionRate: 25,
  },
  {
    id: "back-end",
    name: "Back End",
    type: "back_end",
    position: 4,
    price: 1500,
    quantity: 6,
    conversionRate: 20,
  },
];

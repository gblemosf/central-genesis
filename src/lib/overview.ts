import type { DailyMetric, IntegrationConnection } from "@/lib/domain";

export interface OverviewDailyPoint {
  date: string;
  investment: number;
  revenue: number;
  coreSales: number;
}

export function buildOverviewDailySeries(
  rows: DailyMetric[],
  reportingDate: string,
  startDate?: string,
): OverviewDailyPoint[] {
  const monthStart = startDate ?? `${reportingDate.slice(0, 7)}-01`;
  const dates = new Map<string, OverviewDailyPoint>();
  const cursor = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${reportingDate}T00:00:00Z`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    dates.set(date, { date, investment: 0, revenue: 0, coreSales: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const row of rows) {
    if (row.date < monthStart || row.date > reportingDate) continue;
    const current = dates.get(row.date) ?? {
      date: row.date,
      investment: 0,
      revenue: 0,
      coreSales: 0,
    };
    current.investment += row.investment;
    current.revenue += row.revenue;
    current.coreSales += row.coreSales;
    dates.set(row.date, current);
  }

  return Array.from(dates.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function connectionOperationalSummary(connection: IntegrationConnection) {
  if (connection.provider === "hubla" || connection.provider === "payt") {
    if (connection.status !== "connected") {
      return connection.productCount > 0
        ? `${connection.productCount} produto(s) · webhook pendente`
        : "Webhook aguardando primeiro evento";
    }
    if (connection.productCount > 0) {
      return `Webhook ativo · ${connection.productCount} produto(s)`;
    }
    return "Webhook sem produtos identificados";
  }
  if (connection.provider === "meta") {
    return `${connection.accountCount} conta(s) de anuncios`;
  }
  if (connection.provider === "google_forms") {
    return connection.lastVerifiedAt ? "OAuth Google validado" : "OAuth aguardando validacao";
  }
  return connection.productCount > 0
    ? `${connection.productCount} produto(s) sincronizado(s)`
    : "Catalogo ainda nao sincronizado";
}

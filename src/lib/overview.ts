import type { DailyMetric, IntegrationConnection } from "@/lib/domain";

export interface OverviewDailyPoint {
  date: string;
  investment: number | null;
  revenue: number | null;
  coreSales: number | null;
}

export function overviewDataAvailability(rows: DailyMetric[]) {
  return {
    revenue: rows.length > 0 && rows.every(row => row.revenueAvailable !== false),
    traffic: rows.length > 0 && rows.every(row => row.trafficAvailable !== false),
    sales: rows.length > 0 && rows.every(row => row.salesAvailable !== false),
  };
}

export function buildOverviewDailySeries(
  rows: DailyMetric[],
  reportingDate: string,
  startDate?: string,
  projectRows?: DailyMetric[][],
): OverviewDailyPoint[] {
  const monthStart = startDate ?? `${reportingDate.slice(0, 7)}-01`;
  const dates = new Map<string, OverviewDailyPoint>();
  const cursor = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${reportingDate}T00:00:00Z`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    dates.set(date, { date, investment: null, revenue: null, coreSales: null });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const groups = new Map<string, DailyMetric[]>();
  for (const row of rows) {
    if (row.date < monthStart || row.date > reportingDate) continue;
    const group = groups.get(row.date) ?? [];
    group.push(row);
    groups.set(row.date, group);
  }

  for (const [date, group] of groups) {
    const available = overviewDataAvailability(group);
    dates.set(date, {
      date,
      investment: available.traffic ? group.reduce((sum, row) => sum + row.investment, 0) : null,
      revenue: available.revenue ? group.reduce((sum, row) => sum + row.revenue, 0) : null,
      coreSales: available.sales ? group.reduce((sum, row) => sum + row.coreSales, 0) : null,
    });
  }

  const series = Array.from(dates.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!projectRows) return series;
  const projectSeries = projectRows.map(group => buildOverviewDailySeries(group, reportingDate, monthStart));
  return series.map((point, index) => ({
    date: point.date,
    investment: projectSeries.length && projectSeries.every(group => group[index]?.investment != null)
      ? point.investment : null,
    revenue: projectSeries.length && projectSeries.every(group => group[index]?.revenue != null)
      ? point.revenue : null,
    coreSales: projectSeries.length && projectSeries.every(group => group[index]?.coreSales != null)
      ? point.coreSales : null,
  }));
}

export function connectionOperationalSummary(connection: IntegrationConnection) {
  if (connection.status === "revoked") return "Conexão revogada";
  if (["hubla", "payt", "assiny"].includes(connection.provider)) {
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

import type { ProjectDailyMetric } from "@/lib/domain";
import { subtractCalendarDays } from "@/lib/dates";

export interface AnalysisFilter { start: string; end: string; productIds: string[] | null }
export const periodPresets = [
  ["7", "7 dias"], ["15", "15 dias"], ["30", "30 dias"], ["60", "60 dias"],
  ["3m", "3 meses"], ["6m", "6 meses"],
] as const;

export function presetPeriod(preset: string, today: string) {
  if (!preset.endsWith("m")) return { start: subtractCalendarDays(today, Number(preset) - 1), end: today };
  const months = Number(preset.slice(0, -1));
  const date = new Date(`${today}T12:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return { start: subtractCalendarDays(date.toISOString().slice(0, 10), -1), end: today };
}

export function validAnalysisPeriod(start: string, end: string) {
  if (![start, end].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)) return false;
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  return days >= 0 && days <= 365;
}

export function filterProductMetrics(rows: ProjectDailyMetric[], ids: string[] | null): ProjectDailyMetric[] {
  if (ids === null) return rows;
  return rows.map((row) => {
    const products = row.productMetrics.filter((product) => ids.includes(product.productId));
    return { ...row, productMetrics: products, csvDaily: undefined,
      revenue: products.reduce((sum, product) => sum + product.revenue, 0),
      coreSales: products.filter((product) => ["core", "front_end", "low_ticket"].includes(product.stageType))
        .reduce((sum, product) => sum + product.quantity, 0),
    };
  });
}

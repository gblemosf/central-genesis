import type { Metadata } from "next";
import { OverviewDashboard } from "@/components/overview-dashboard";
import { getConnections, getProjects } from "@/lib/data";
import { dateInTimezone } from "@/lib/dates";
import { presetPeriod, validAnalysisPeriod } from "@/lib/analysis-filters";

export const metadata: Metadata = { title: "Visao geral" };
export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = dateInTimezone(new Date());
  const period = typeof params.start === "string" && typeof params.end === "string" && validAnalysisPeriod(params.start, params.end)
    ? { start: params.start, end: params.end } : presetPeriod("30", today);
  const [projects, connections] = await Promise.all([
    getProjects(period),
    getConnections(),
  ]);

  return (
    <OverviewDashboard
      projects={projects.data}
      connections={connections.data}
      source={projects.source === "live" ? connections.source : "demo"}
      warning={projects.warning ?? connections.warning}
      reportingDate={period.end}
      period={period}
    />
  );
}

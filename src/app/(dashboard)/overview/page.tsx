import type { Metadata } from "next";
import { OverviewDashboard } from "@/components/overview-dashboard";
import { getConnections, getProjects } from "@/lib/data";

export const metadata: Metadata = { title: "Visao geral" };

export default async function OverviewPage() {
  const [projects, connections] = await Promise.all([
    getProjects(),
    getConnections(),
  ]);

  return (
    <OverviewDashboard
      projects={projects.data}
      connections={connections.data}
      source={projects.source === "live" ? connections.source : "demo"}
      warning={projects.warning ?? connections.warning}
    />
  );
}

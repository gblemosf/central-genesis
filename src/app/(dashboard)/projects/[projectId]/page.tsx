import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/project-workspace";
import {
  getProject,
  getProjectAnalytics,
  getProjectCatalog,
  getProjectFormsData,
} from "@/lib/data";
import { dateInTimezone } from "@/lib/dates";
import { defaultProjectMetricConfig } from "@/lib/project-metrics";

export const metadata: Metadata = { title: "Projeto" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project.data) notFound();
  const catalog = project.source === "live" && !project.data.legacy
    ? await getProjectCatalog(projectId)
    : {
        products: [],
        stages: [],
        metaAccounts: [],
        salesConnections: [],
        linkedMetaAccountId: null,
      };
  const analytics = project.data.legacy
      ? {
          config: defaultProjectMetricConfig(dateInTimezone(new Date())),
          configSaved: false,
          dataSources: {
            csvDailyRows: project.data.dailyMetrics.length,
            metaTrafficRows: 0,
            webhookSalesEvents: 0,
          },
          dailyMetrics: project.data.dailyMetrics.map((metric) => ({
          ...metric,
          productMetrics: [],
        })),
        warning:
          "Metricas historicas preservadas em modo somente leitura ate a migracao deste projeto.",
      }
    : await getProjectAnalytics(projectId, catalog);
  const forms = project.source === "live" && !project.data.legacy
    ? await getProjectFormsData(projectId)
    : { connections: [], forms: [], contacts: [], utms: [] };

  return (
    <ProjectWorkspace
      project={project.data}
      initialCatalog={catalog}
      analytics={analytics}
      initialForms={forms}
      demoMode={project.source === "demo"}
    />
  );
}

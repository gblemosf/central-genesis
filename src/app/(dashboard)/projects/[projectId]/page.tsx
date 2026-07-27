import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/project-workspace";
import { getProject, getProjectCatalog } from "@/lib/data";

export const metadata: Metadata = { title: "Projeto" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project.data) notFound();
  const catalog = project.source === "live"
    ? await getProjectCatalog(projectId)
    : { products: [], stages: [], metaAccounts: [], linkedMetaAccountId: null };

  return (
    <ProjectWorkspace
      project={project.data}
      initialCatalog={catalog}
      demoMode={project.source === "demo"}
    />
  );
}

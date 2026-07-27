import type { Metadata } from "next";
import { ProjectsList } from "@/components/projects-list";
import { getProjects } from "@/lib/data";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <ProjectsList projects={projects.data} warning={projects.warning} />;
}

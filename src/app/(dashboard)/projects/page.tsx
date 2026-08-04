import type { Metadata } from "next";
import { ProjectsList } from "@/components/projects-list";
import { getProjects } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjectsPage() {
  const projects = await getProjects();
  const supabase = await createSupabaseServerClient();
  let canManage = false;

  if (supabase && projects.source === "live") {
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    if (userId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .limit(1)
        .maybeSingle();
      canManage = Boolean(membership);
    }
  }

  return (
    <ProjectsList
      projects={projects.data}
      warning={projects.warning}
      canManage={canManage}
    />
  );
}

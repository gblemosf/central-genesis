import type { Metadata } from "next";
import { connection } from "next/server";
import { SetupGuide } from "@/components/setup-guide";
import { getConnections, getProjects } from "@/lib/data";
import { getDatabaseChecks, getSetupObservations } from "@/lib/configuration-status";
import { buildSetupGuide } from "@/lib/setup-guide";
import { isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { getSupabasePublicEnv, getSupabaseSecretKey } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Passo a passo" };

export default async function SetupPage() {
  await connection();
  const env = getSupabasePublicEnv();
  const [connections, projects, checks, observations] = await Promise.all([getConnections(), getProjects(), getDatabaseChecks(), getSetupObservations()]);
  const steps = buildSetupGuide({
    databaseConfigured: env.configured, serverConfigured: Boolean(getSupabaseSecretKey()),
    googleConfigured: isGoogleOAuthConfigured(), demoMode: env.demoMode, checks,
    connections: connections.data, projects: projects.data,
    connectionsWarning: connections.warning, projectsWarning: projects.warning, ...observations,
  });
  return <SetupGuide steps={steps} projects={projects.data.filter((project) => !project.legacy && project.status !== "archived").map(({ id, name, expertName }) => ({ id, name, expertName }))} demoMode={env.demoMode} />;
}

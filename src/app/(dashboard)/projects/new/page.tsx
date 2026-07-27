import type { Metadata } from "next";
import { NewProjectWizard } from "@/components/new-project-wizard";
import { getMetaConnectionsForOnboarding } from "@/lib/data";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const demoMode = getSupabasePublicEnv().demoMode;
  const metaConnections = demoMode ? [] : await getMetaConnectionsForOnboarding();
  return (
    <NewProjectWizard
      demoMode={demoMode}
      metaConnections={metaConnections}
    />
  );
}

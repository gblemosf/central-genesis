import type { Metadata } from "next";
import { NewProjectWizard } from "@/components/new-project-wizard";
import {
  getMetaConnectionsForOnboarding,
  getSalesConnectionsForOnboarding,
} from "@/lib/data";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const demoMode = getSupabasePublicEnv().demoMode;
  const [metaConnections, salesConnections] = demoMode
    ? [[], []]
    : await Promise.all([
        getMetaConnectionsForOnboarding(),
        getSalesConnectionsForOnboarding(),
      ]);
  return (
    <NewProjectWizard
      demoMode={demoMode}
      metaConnections={metaConnections}
      salesConnections={salesConnections}
    />
  );
}

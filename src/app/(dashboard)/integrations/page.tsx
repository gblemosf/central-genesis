import type { Metadata } from "next";
import { IntegrationsManager } from "@/components/integrations-manager";
import { getConnections } from "@/lib/data";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Integracoes" };

export default async function IntegrationsPage() {
  const connections = await getConnections();
  return (
    <IntegrationsManager
      initialConnections={connections.data}
      demoMode={getSupabasePublicEnv().demoMode}
      warning={connections.warning}
    />
  );
}

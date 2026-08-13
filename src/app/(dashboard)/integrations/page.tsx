import type { Metadata } from "next";
import { IntegrationsManager } from "@/components/integrations-manager";
import { getConnections } from "@/lib/data";
import { isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Integracoes" };

type IntegrationsPageProps = {
  searchParams?: Promise<{
    googleForms?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const connections = await getConnections();
  const params = await searchParams;
  const googleFormsStatus = firstParam(params?.googleForms);
  const oauthMessage =
    googleFormsStatus === "connected"
      ? "Google Forms conectado com sucesso. Agora vincule formularios dentro de cada projeto."
      : googleFormsStatus === "error"
        ? "Nao foi possivel concluir a autorizacao do Google Forms. Revise as credenciais OAuth e tente novamente."
        : googleFormsStatus === "not_configured"
          ? "Google Forms ainda nao esta disponivel: configure as tres credenciais OAuth em Producao e publique novamente."
        : undefined;
  return (
    <IntegrationsManager
      initialConnections={connections.data}
      demoMode={getSupabasePublicEnv().demoMode}
      googleOAuthConfigured={isGoogleOAuthConfigured()}
      warning={oauthMessage ?? connections.warning}
    />
  );
}

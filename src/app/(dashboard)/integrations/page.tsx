import type { Metadata } from "next";
import { IntegrationsManager } from "@/components/integrations-manager";
import { getConnections } from "@/lib/data";
import { isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Conexões" };

type IntegrationsPageProps = {
  searchParams?: Promise<{
    googleForms?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const googleOAuthMessages: Record<string, string> = {
  connected: "Google Forms conectado com sucesso. Agora vincule formularios dentro de cada projeto.",
  error: "Nao foi possivel concluir a autorizacao do Google Forms. Clique em Reconectar para tentar novamente. Se o erro persistir, confira a configuracao da integracao.",
  session_expired: "A sessao de autorizacao do Google expirou ou ficou indisponivel. Clique em Reconectar e conclua a autorizacao em ate 10 minutos, na mesma aba.",
  invalid_response: "O retorno do Google nao corresponde a esta tentativa de conexao. Clique em Reconectar para iniciar uma nova autorizacao.",
  session_mismatch: "A conta da Central Genesis mudou durante a autorizacao. Entre na conta desejada e clique em Reconectar.",
  cancelled: "A autorizacao nao foi concluida no Google. A conexao anterior foi preservada. Clique em Reconectar quando estiver pronto.",
  not_configured: "Google Forms ainda nao esta disponivel: configure as tres credenciais OAuth em Producao e publique novamente.",
};

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const connections = await getConnections({ includeArchived: true });
  const params = await searchParams;
  const googleFormsStatus = firstParam(params?.googleForms);
  const oauthMessage = googleFormsStatus && Object.hasOwn(googleOAuthMessages, googleFormsStatus)
    ? googleOAuthMessages[googleFormsStatus]
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

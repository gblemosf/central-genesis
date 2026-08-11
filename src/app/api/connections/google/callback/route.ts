import { cookies } from "next/headers";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  exchangeGoogleAuthorizationCode,
  getRefreshTokenFromGoogleCredential,
  parseGoogleOAuthState,
  serializeGoogleCredential,
} from "@/lib/google/oauth";
import { readConnectionSecret, storeConnectionSecret } from "@/lib/secret-store";

const stateCookieName = "genesis_google_oauth_state";

function redirectToIntegrations(requestUrl: string, status: "connected" | "error") {
  const url = new URL("/integrations", requestUrl);
  url.searchParams.set("googleForms", status);
  return Response.redirect(url);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  try {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) throw new ApiError(`Google recusou a autorizacao: ${error}.`, 422);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookieStore.get(stateCookieName)?.value;
    cookieStore.delete(stateCookieName);

    if (!code || !state || !expectedState || state !== expectedState) {
      throw new ApiError("Resposta OAuth invalida.", 400);
    }

    const stateData = parseGoogleOAuthState(state);
    if (Date.now() - stateData.issuedAt > 10 * 60 * 1000) {
      throw new ApiError("Autorizacao Google expirada.", 400);
    }

    const context = await requireAdmin();
    if (
      stateData.userId !== context.userId ||
      stateData.organizationId !== context.organizationId
    ) {
      throw new ApiError("Sessao OAuth nao corresponde ao usuario atual.", 403);
    }

    const tokens = await exchangeGoogleAuthorizationCode(request.url, code);
    const { data: existingConnection, error: existingError } = await context.supabase
      .from("integration_connections")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("provider", "google_forms")
      .is("revoked_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new ApiError("Nao foi possivel consultar a conexao Google.", 503);

    if (existingConnection?.id) {
      const previousSecret = await readConnectionSecret(existingConnection.id).catch(
        () => undefined,
      );
      const credential = serializeGoogleCredential(
        tokens,
        previousSecret ? getRefreshTokenFromGoogleCredential(previousSecret) : undefined,
      );
      await storeConnectionSecret(existingConnection.id, credential);
      const { error: updateError } = await context.supabase
        .from("integration_connections")
        .update({
          status: "connected",
          last_verified_at: new Date().toISOString(),
          last_error: null,
          metadata: { scopes: tokens.scope ?? null },
        })
        .eq("id", existingConnection.id)
        .eq("organization_id", context.organizationId);
      if (updateError) throw new ApiError("Nao foi possivel atualizar a conexao Google.", 503);
      return redirectToIntegrations(request.url, "connected");
    }

    const credential = serializeGoogleCredential(tokens);
    const { data, error: createError } = await context.supabase.rpc(
      "create_connection_with_secret",
      {
        p_organization_id: context.organizationId,
        p_name: "Google Forms",
        p_provider: "google_forms",
        p_credential: credential,
        p_business_id: null,
        p_app_id: null,
        p_system_user_id: null,
      },
    );
    if (createError) throw createError;
    const connectionId = data?.id ? String(data.id) : "";
    if (!connectionId) throw new ApiError("Conexao Google nao foi criada.", 500);

    const { error: updateError } = await context.supabase
      .from("integration_connections")
      .update({
        status: "connected",
        last_verified_at: new Date().toISOString(),
        last_error: null,
        metadata: { scopes: tokens.scope ?? null },
      })
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId);
    if (updateError) throw new ApiError("Nao foi possivel confirmar a conexao Google.", 503);

    return redirectToIntegrations(request.url, "connected");
  } catch (error) {
    cookieStore.delete(stateCookieName);
    if (error instanceof ApiError) {
      return redirectToIntegrations(request.url, "error");
    }
    return apiErrorResponse(error);
  }
}

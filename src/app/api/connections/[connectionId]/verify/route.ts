import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import type { Provider } from "@/lib/domain";
import { verifyProviderCredential } from "@/lib/provider-verification";
import { readConnectionSecret } from "@/lib/secret-store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await context.params;
    const adminContext = await requireAdmin();
    const { data: connection, error: connectionError } = await adminContext.supabase
      .from("integration_connections")
      .select("id,provider")
      .eq("id", connectionId)
      .eq("organization_id", adminContext.organizationId)
      .maybeSingle();
    if (connectionError) {
      throw new ApiError("Nao foi possivel consultar a conexao.", 503);
    }
    if (!connection) throw new ApiError("Conexao nao encontrada.", 404);

    const secret = await readConnectionSecret(connectionId);
    const result = await verifyProviderCredential(
      connection.provider as Provider,
      secret,
    );
    const now = new Date().toISOString();

    const { error: updateError } = await adminContext.supabase
      .from("integration_connections")
      .update({
        status: result.ok ? "connected" : "attention",
        last_verified_at: result.ok ? now : null,
        last_error: result.error ?? null,
      })
      .eq("id", connectionId);
    if (updateError) throw updateError;

    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

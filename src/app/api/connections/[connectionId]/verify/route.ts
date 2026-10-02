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
      .select("id,provider,status,last_verified_at,metadata,revoked_at")
      .eq("id", connectionId)
      .eq("organization_id", adminContext.organizationId)
      .maybeSingle();
    if (connectionError) {
      throw new ApiError("Nao foi possivel consultar a conexao.", 503);
    }
    if (!connection || connection.revoked_at) throw new ApiError("Conexao nao encontrada.", 404);

    // Preparing our receiver is not verification of Assiny's delivery contract.
    if (connection.provider === "assiny") {
      return Response.json({ ok: true, confirmed: false, mode: "webhook", lastVerifiedAt: null,
        message: "Recebimento Assiny pré-configurado. Autenticação e campos da plataforma aguardam validação oficial.", products: [] });
    }
    const secret = await readConnectionSecret(connectionId);
    if (connection.provider === "hubla" || connection.provider === "payt") {
      const metadata =
        connection.metadata &&
        typeof connection.metadata === "object" &&
        !Array.isArray(connection.metadata)
          ? (connection.metadata as Record<string, unknown>)
          : {};
      const confirmed = connection.provider === "payt"
        ? Boolean(metadata.last_processed_webhook_at)
        : Boolean(metadata.last_webhook_at);
      const { data: products, error: productsError } = await adminContext.supabase
        .from("products")
        .select("id,external_id,name,current_price,currency")
        .eq("connection_id", connectionId)
        .eq("is_active", true)
        .is("archived_at", null)
        .order("name");
      if (productsError) throw productsError;
      return Response.json({
        ok: true,
        confirmed,
        mode: "webhook",
        lastVerifiedAt: confirmed ? connection.last_verified_at : null,
        products: (products ?? []).map((product) => ({
          id: product.id,
          externalId: product.external_id,
          name: product.name,
          price: Number(product.current_price ?? 0),
          currency: product.currency,
        })),
      });
    }
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

    return Response.json(
      { ...result, confirmed: result.ok },
      { status: result.ok ? 200 : 422 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

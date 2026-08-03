import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { catalogProviders, type Provider } from "@/lib/domain";
import { listProviderProducts } from "@/lib/provider-verification";
import { readConnectionSecret } from "@/lib/secret-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await route.params;
    const context = await requireAdmin();
    const { data: connection, error: connectionError } = await context.supabase
      .from("integration_connections")
      .select("id,provider,status,revoked_at")
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (connectionError) throw new ApiError("Nao foi possivel consultar a conexao.", 503);
    if (!connection || connection.revoked_at) {
      throw new ApiError("Conexao nao encontrada.", 404);
    }
    const provider = connection.provider as Provider;
    if (!(catalogProviders as readonly Provider[]).includes(provider)) {
      throw new ApiError("Esta plataforma nao oferece catalogo publico.", 422);
    }
    if (connection.status !== "connected") {
      throw new ApiError("Verifique a conexao antes de sincronizar produtos.", 409);
    }

    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);
    const secret = await readConnectionSecret(connectionId);
    const productSync = await listProviderProducts(provider, secret);
    const providerProducts = productSync.products;
    const { data: existing, error: existingError } = await admin
      .from("products")
      .select("id,external_id,name,current_price,currency,source,metadata")
      .eq("organization_id", context.organizationId)
      .eq("connection_id", connectionId);
    if (existingError) throw new ApiError("Nao foi possivel consultar o catalogo.", 503);
    const existingByExternalId = new Map(
      (existing ?? []).map((product) => [product.external_id, product]),
    );

    const now = new Date().toISOString();
    const rows = providerProducts.map((product) => {
      const current = existingByExternalId.get(product.externalId);
      const currentMetadata =
        current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
          ? (current.metadata as Record<string, unknown>)
          : {};
      const manualOverride = currentMetadata.manual_override === true;
      return {
        organization_id: context.organizationId,
        connection_id: connectionId,
        external_id: product.externalId,
        name: manualOverride ? current!.name : product.name,
        current_price: manualOverride ? current!.current_price : product.price,
        currency: manualOverride ? current!.currency : product.currency,
        is_active: product.active,
        source: "provider",
        archived_at: product.active ? null : now,
        provider_name: product.name,
        provider_price: product.price,
        provider_currency: product.currency,
        metadata: { ...currentMetadata, provider: product.metadata },
        updated_at: now,
      };
    });

    if (rows.length > 0) {
      const { error: upsertError } = await admin
        .from("products")
        .upsert(rows, { onConflict: "connection_id,external_id" });
      if (upsertError) throw new ApiError("Nao foi possivel atualizar os produtos.", 503);
    }

    const discoveredIds = new Set(providerProducts.map((product) => product.externalId));
    const retiredIds = productSync.complete
      ? (existing ?? [])
          .filter(
            (product) =>
              product.source === "provider" && !discoveredIds.has(product.external_id),
          )
          .map((product) => product.id)
      : [];
    if (retiredIds.length > 0) {
      const { error: retireError } = await admin
        .from("products")
        .update({ is_active: false, archived_at: now, updated_at: now })
        .in("id", retiredIds);
      if (retireError) throw new ApiError("Nao foi possivel arquivar produtos removidos.", 503);
    }

    await admin.from("sync_runs").insert({
      organization_id: context.organizationId,
      connection_id: connectionId,
      job_type: "provider_products",
      status: "succeeded",
      started_at: now,
      finished_at: new Date().toISOString(),
      records_processed: rows.length,
      metadata: {
        provider,
        catalogComplete: productSync.complete,
        retiredProducts: retiredIds.length,
      },
    });

    const { data: catalog, error: catalogError } = await admin
      .from("products")
      .select("id,external_id,name,current_price,currency")
      .eq("organization_id", context.organizationId)
      .eq("connection_id", connectionId)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name");
    if (catalogError) throw new ApiError("Catalogo sincronizado, mas indisponivel.", 503);

    return Response.json({
      products: rows.length,
      retiredProducts: retiredIds.length,
      items: (catalog ?? []).map((product) => ({
        id: product.id,
        externalId: product.external_id,
        name: product.name,
        price: Number(product.current_price ?? 0),
        currency: product.currency,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

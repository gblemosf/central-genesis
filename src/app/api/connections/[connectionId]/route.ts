import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import type { IntegrationConnection } from "@/lib/domain";
import { serializeProviderCredentials } from "@/lib/provider-credentials";
import { readConnectionSecret, storeConnectionSecret } from "@/lib/secret-store";
import { connectionUpdateInputSchema } from "@/lib/validators";

interface ConnectionRow {
  id: string;
  name: string;
  provider: IntegrationConnection["provider"];
  status: IntegrationConnection["status"];
  business_id: string | null;
  app_id: string | null;
  system_user_id: string | null;
  last_verified_at: string | null;
}

async function findConnection(connectionId: string) {
  const context = await requireAdmin();
  const { data, error } = await context.supabase
    .from("integration_connections")
    .select(
      "id,name,provider,status,business_id,app_id,system_user_id,last_verified_at",
    )
    .eq("id", connectionId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (error) throw new ApiError("Nao foi possivel consultar a conexao.", 503);
  if (!data) throw new ApiError("Conexao nao encontrada.", 404);

  return { context, connection: data as ConnectionRow };
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await route.params;
    const { context, connection } = await findConnection(connectionId);
    const input = connectionUpdateInputSchema.parse(await request.json());
    const identifiersChanged =
      (input.businessId ?? null) !== connection.business_id ||
      (input.appId ?? null) !== connection.app_id ||
      (input.systemUserId ?? null) !== connection.system_user_id;
    const shouldReverify = Boolean(input.credentials) || identifiersChanged;
    const nextStatus =
      connection.status === "revoked" && !input.credentials
        ? "revoked"
        : shouldReverify
          ? "attention"
          : connection.status;

    const { error: updateError } = await context.supabase
      .from("integration_connections")
      .update({
        name: input.name,
        business_id: input.businessId ?? null,
        app_id: input.appId ?? null,
        system_user_id: input.systemUserId ?? null,
        status: nextStatus,
        last_verified_at: shouldReverify ? null : connection.last_verified_at,
        last_error: shouldReverify ? null : undefined,
      })
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId);
    if (updateError) throw new ApiError("Nao foi possivel editar a conexao.", 503);

    if (input.credentials) {
      const existing = await readConnectionSecret(connectionId).catch(() => undefined);
      const credential = serializeProviderCredentials(
        connection.provider,
        input.credentials,
        existing,
      );
      await storeConnectionSecret(connectionId, credential);
    }

    return Response.json({
      data: {
        id: connection.id,
        name: input.name,
        provider: connection.provider,
        status: nextStatus,
        businessId: input.businessId ?? undefined,
        appId: input.appId ?? undefined,
        systemUserId: input.systemUserId ?? undefined,
        accountCount: 0,
        productCount: 0,
        lastVerifiedAt: shouldReverify ? null : connection.last_verified_at,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await route.params;
    const { context, connection } = await findConnection(connectionId);
    if (connection.status !== "revoked") {
      throw new ApiError("Revogue a conexao antes de exclui-la.", 409);
    }

    const { data: accounts, error: accountsError } = await context.supabase
      .from("provider_accounts")
      .select("id")
      .eq("connection_id", connectionId);
    if (accountsError) {
      throw new ApiError("Nao foi possivel validar os vinculos da conexao.", 503);
    }

    const accountIds = (accounts ?? []).map((account) => account.id);
    const [projectLinks, products, sales, metrics, syncRuns] = await Promise.all([
      accountIds.length
        ? context.supabase
            .from("project_accounts")
            .select("provider_account_id", { count: "exact", head: true })
            .in("provider_account_id", accountIds)
        : Promise.resolve({ count: 0, error: null }),
      context.supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId),
      context.supabase
        .from("sales_events")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId),
      accountIds.length
        ? context.supabase
            .from("traffic_metrics_daily")
            .select("provider_account_id", { count: "exact", head: true })
            .in("provider_account_id", accountIds)
        : Promise.resolve({ count: 0, error: null }),
      context.supabase
        .from("sync_runs")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId),
    ]);

    if (
      projectLinks.error ||
      products.error ||
      sales.error ||
      metrics.error ||
      syncRuns.error
    ) {
      throw new ApiError("Nao foi possivel validar os vinculos da conexao.", 503);
    }
    if (
      (projectLinks.count ?? 0) +
        (products.count ?? 0) +
        (sales.count ?? 0) +
        (metrics.count ?? 0) +
        (syncRuns.count ?? 0) >
      0
    ) {
      throw new ApiError(
        "A conexao possui projetos, produtos ou vendas vinculados e nao pode ser excluida.",
        409,
      );
    }

    const { error: deleteError } = await context.supabase.rpc(
      "delete_empty_integration_connection",
      {
        p_organization_id: context.organizationId,
        p_connection_id: connectionId,
      },
    );
    if (deleteError) throw new ApiError("Nao foi possivel excluir a conexao.", 503);

    return Response.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

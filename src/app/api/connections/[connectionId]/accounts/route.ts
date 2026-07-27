import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { fetchMetaCollection } from "@/lib/meta-api";
import { readConnectionSecret } from "@/lib/secret-store";

interface MetaAccount {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
}

export async function POST(
  _request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await route.params;
    const context = await requireAdmin();
    const { data: connection, error: connectionError } = await context.supabase
      .from("integration_connections")
      .select("id,provider,system_user_id")
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (connectionError) {
      throw new ApiError("Nao foi possivel consultar a conexao.", 503);
    }
    if (!connection) throw new ApiError("Conexao nao encontrada.", 404);
    if (connection.provider !== "meta") {
      throw new ApiError("Descoberta automatica disponivel apenas para Meta.", 422);
    }

    const credential = await readConnectionSecret(connectionId);
    const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
    const owner = connection.system_user_id || "me";
    const edge = connection.system_user_id
      ? "assigned_ad_accounts"
      : "adaccounts";
    const url = new URL(`https://graph.facebook.com/${version}/${owner}/${edge}`);
    url.searchParams.set(
      "fields",
      "id,name,account_status,currency,timezone_name",
    );
    url.searchParams.set("limit", "200");

    const accounts = await fetchMetaCollection<MetaAccount>(
      url,
      credential,
      "A Meta recusou a listagem de contas.",
    );
    const { data: currentAccounts, error: currentAccountsError } = await context.supabase
      .from("provider_accounts")
      .select("id,external_id")
      .eq("connection_id", connectionId);
    if (currentAccountsError) throw currentAccountsError;

    if (accounts.length) {
      const { error } = await context.supabase.from("provider_accounts").upsert(
        accounts.map((account) => ({
          organization_id: context.organizationId,
          connection_id: connectionId,
          external_id: account.id,
          name: account.name ?? account.id,
          account_type: "meta_ad_account",
          currency: account.currency ?? null,
          timezone: account.timezone_name ?? null,
          is_active: account.account_status === 1,
          metadata: { account_status: account.account_status },
        })),
        { onConflict: "connection_id,external_id" },
      );
      if (error) throw error;
    }

    const discoveredIds = new Set(accounts.map((account) => account.id));
    const staleIds = (currentAccounts ?? [])
      .filter((account) => !discoveredIds.has(account.external_id))
      .map((account) => account.id);
    if (staleIds.length) {
      const { error } = await context.supabase
        .from("provider_accounts")
        .update({ is_active: false })
        .in("id", staleIds);
      if (error) throw error;
    }

    return Response.json({ accounts: accounts.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

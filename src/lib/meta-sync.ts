import "server-only";
import { ApiError, type AdminContext } from "@/lib/api-auth";
import { dateInTimezone, subtractCalendarDays } from "@/lib/dates";
import { fetchMetaCollection } from "@/lib/meta-api";
import { canonicalMetaTimezone } from "@/lib/meta-timezone";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { readConnectionSecret } from "@/lib/secret-store";

interface MetaInsight {
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
}

function actionValue(row: MetaInsight, names: string[]) {
  for (const name of names) {
    const action = row.actions?.find((item) => item.action_type === name);
    if (action) return Math.round(Number.parseFloat(action.value) || 0);
  }
  return 0;
}

export async function syncProjectMeta(context: Pick<AdminContext, "supabase" | "organizationId">, projectId: string, body: { since?: string; until?: string; days?: number } = {}, jobId?: string) {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,reporting_timezone")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (projectError) throw new ApiError("Nao foi possivel consultar o projeto.", 503);
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    const { data: links, error: linksError } = await context.supabase
      .from("project_accounts")
      .select("provider_account_id")
      .eq("project_id", projectId);
    if (linksError) throw linksError;
    const accountIds = (links ?? []).map((link) => link.provider_account_id);
    if (!accountIds.length) throw new ApiError("Nenhuma conta Meta vinculada.", 422);

    const { data: accounts, error: accountsError } = await context.supabase
      .from("provider_accounts")
      .select("id,external_id,connection_id,currency,timezone")
      .in("id", accountIds)
      .eq("account_type", "meta_ad_account")
      .eq("is_active", true);
    if (accountsError) throw accountsError;
    if (!accounts?.length) throw new ApiError("Nenhuma conta Meta vinculada.", 422);
    if (accounts.length !== accountIds.length) {
      throw new ApiError("Há contas vinculadas inativas ou indisponíveis. Revise os vínculos antes de sincronizar o projeto inteiro.", 422);
    }
    if (accounts.some((account) => account.currency !== "BRL")) {
      throw new ApiError("A Central aceita apenas contas Meta em BRL neste momento.", 422);
    }
    const projectTimezone = canonicalMetaTimezone(project.reporting_timezone);
    if (!projectTimezone || accounts.some((account) => canonicalMetaTimezone(account.timezone) !== projectTimezone)) {
      throw new ApiError("O fuso da conta Meta difere do fuso do projeto.", 422);
    }

    const until = body.until ?? dateInTimezone(new Date(), project.reporting_timezone);
    const since = body.since ?? subtractCalendarDays(until, (body.days ?? 10) - 1);
    const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
    const allRows: Array<{
      provider_account_id: string;
      metric_date: string;
      investment: number;
      impressions: number;
      clicks: number;
      page_views: number;
      checkouts: number;
    }> = [];

    for (const account of accounts) {
      const storedCredential = await readConnectionSecret(account.connection_id);
      const credential = decodeProviderCredentials("meta", storedCredential).accessToken;
      if (!credential) throw new ApiError("Token de acesso Meta nao encontrado.", 422);
      const url = new URL(
        `https://graph.facebook.com/${version}/${account.external_id}/insights`,
      );
      url.searchParams.set(
        "fields",
        "spend,impressions,clicks,inline_link_clicks,actions,date_start",
      );
      url.searchParams.set("time_increment", "1");
      url.searchParams.set("level", "account");
      url.searchParams.set("limit", "500");
      url.searchParams.set(
        "time_range",
        JSON.stringify({ since, until }),
      );

      const insights = await fetchMetaCollection<MetaInsight>(
        url,
        credential,
        "Falha ao sincronizar Meta Ads.",
      );
      const rows = insights.map((row) => ({
        provider_account_id: account.id,
        metric_date: row.date_start,
        investment: Number.parseFloat(row.spend ?? "0") || 0,
        impressions: Number.parseInt(row.impressions ?? "0", 10) || 0,
        clicks:
          Number.parseInt(row.inline_link_clicks ?? row.clicks ?? "0", 10) || 0,
        page_views: actionValue(row, ["landing_page_view"]),
        checkouts: actionValue(row, ["initiate_checkout", "omni_initiated_checkout"]),
      }));
      allRows.push(...rows);
    }

    const { data: processed, error: replaceError } = await context.supabase.rpc(
      jobId ? "apply_meta_sync_job" : "replace_meta_metrics",
      {
        ...(jobId ? { p_run_id: jobId } : { p_organization_id: context.organizationId, p_project_id: projectId }),
        p_since: since,
        p_until: until,
        p_provider_account_ids: accounts.map((account) => account.id),
        p_rows: allRows,
      },
    );
    if (replaceError) throw replaceError;

    return { processed: Number(processed ?? 0) };
}

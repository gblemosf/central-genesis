import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { dateInTimezone, subtractCalendarDays } from "@/lib/dates";
import { fetchMetaCollection } from "@/lib/meta-api";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConnectionSecret } from "@/lib/secret-store";
import { z } from "zod";

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

const syncInputSchema = z
  .object({
    days: z.number().int().min(1).max(366).optional(),
    since: z.iso.date().optional(),
    until: z.iso.date().optional(),
  })
  .superRefine((input, context) => {
    if (Boolean(input.since) !== Boolean(input.until)) {
      context.addIssue({
        code: "custom",
        path: [input.since ? "until" : "since"],
        message: "Informe o inicio e o fim do periodo.",
      });
      return;
    }
    if (input.since && input.until) {
      const days =
        (Date.parse(`${input.until}T00:00:00Z`) -
          Date.parse(`${input.since}T00:00:00Z`)) /
        86_400_000;
      if (days < 0 || days > 365) {
        context.addIssue({
          code: "custom",
          path: ["until"],
          message: "O periodo deve ter entre 1 e 366 dias.",
        });
      }
    }
  });

export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);

    const body = syncInputSchema.parse(await request.json().catch(() => ({})));
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,reporting_timezone")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
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
    if (accounts.some((account) => account.currency !== "BRL")) {
      throw new ApiError("A Central aceita apenas contas Meta em BRL neste momento.", 422);
    }
    if (accounts.some((account) => account.timezone !== project.reporting_timezone)) {
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

    const { data: processed, error: replaceError } = await admin.rpc(
      "replace_meta_metrics",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_since: since,
        p_until: until,
        p_provider_account_ids: accounts.map((account) => account.id),
        p_rows: allRows,
      },
    );
    if (replaceError) throw replaceError;

    return Response.json({ processed: Number(processed ?? 0) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

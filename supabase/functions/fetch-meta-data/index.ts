import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function accessToken(secret: string) {
  try {
    const parsed = objectValue(JSON.parse(secret));
    return typeof parsed.accessToken === "string" ? parsed.accessToken : "";
  } catch {
    return secret;
  }
}

function dateInTimezone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function actionValue(row: JsonObject, names: string[]) {
  const actions = Array.isArray(row.actions) ? row.actions.map(objectValue) : [];
  for (const name of names) {
    const action = actions.find((item) => item.action_type === name);
    if (action) return Math.round(Number(action.value) || 0);
  }
  return 0;
}

function equalSecret(received: string, expected: string) {
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cronSecret = Deno.env.get("META_SYNC_CRON_SECRET") ?? "";
  const receivedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !equalSecret(receivedSecret, cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return new Response("Service unavailable", { status: 503 });
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: links, error: linksError } = await supabase
    .from("project_accounts")
    .select("organization_id,project_id,provider_account_id");
  if (linksError) return new Response("Unable to load project accounts", { status: 503 });
  if (!links?.length) return Response.json({ projects: 0, rows: 0 });

  const projectIds = [...new Set(links.map((link) => link.project_id))];
  const accountIds = [...new Set(links.map((link) => link.provider_account_id))];
  const [{ data: projects, error: projectsError }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase.from("projects").select("id,organization_id,reporting_timezone,currency,deleted_at")
        .in("id", projectIds).is("deleted_at", null),
      supabase.from("provider_accounts")
        .select("id,organization_id,connection_id,external_id,currency,timezone,is_active")
        .in("id", accountIds).eq("account_type", "meta_ad_account").eq("is_active", true),
    ]);
  if (projectsError || accountsError) return new Response("Unable to load Meta links", { status: 503 });

  const accountById = new Map((accounts ?? []).map((account) => [account.id, account]));
  const secretByConnection = new Map<string, string>();
  let processedProjects = 0;
  let processedRows = 0;
  const version = Deno.env.get("META_GRAPH_API_VERSION") ?? "v25.0";

  for (const project of projects ?? []) {
    const projectLinks = links.filter((link) => link.project_id === project.id);
    const projectAccounts = projectLinks.map((link) => accountById.get(link.provider_account_id))
      .filter((account): account is NonNullable<typeof account> => Boolean(account));
    if (!projectAccounts.length || projectAccounts.some((account) =>
      account.organization_id !== project.organization_id || account.currency !== project.currency
      || account.timezone !== project.reporting_timezone
    )) continue;

    const until = dateInTimezone(new Date(), project.reporting_timezone);
    const sinceDate = new Date(`${until}T12:00:00Z`);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - 9);
    const since = dateInTimezone(sinceDate, project.reporting_timezone);
    const rows: JsonObject[] = [];

    for (const account of projectAccounts) {
      let token = secretByConnection.get(account.connection_id);
      if (!token) {
        const { data: stored, error } = await supabase.rpc("get_connection_secret", {
          p_connection_id: account.connection_id,
        });
        // Replacement deletes the old period for every supplied account. A missing
        // credential must abort the project, never turn a failed read into zero spend.
        if (error || typeof stored !== "string") {
          return new Response("Meta credential unavailable; existing metrics preserved", { status: 503 });
        }
        token = accessToken(stored).trim();
        if (!token) {
          return new Response("Meta credential unavailable; existing metrics preserved", { status: 503 });
        }
        secretByConnection.set(account.connection_id, token);
      }
      const endpoint = new URL(`https://graph.facebook.com/${version}/${account.external_id}/insights`);
      endpoint.searchParams.set("fields", "spend,impressions,clicks,inline_link_clicks,actions,date_start");
      endpoint.searchParams.set("time_increment", "1");
      endpoint.searchParams.set("level", "account");
      endpoint.searchParams.set("limit", "500");
      endpoint.searchParams.set("time_range", JSON.stringify({ since, until }));
      let next: string | null = endpoint.toString();
      const visited = new Set<string>();
      try {
        while (next) {
          const nextUrl = new URL(next);
          if (nextUrl.protocol !== "https:" || nextUrl.hostname !== "graph.facebook.com" ||
            (nextUrl.port && nextUrl.port !== "443") || nextUrl.username || nextUrl.password ||
            visited.has(nextUrl.href) || visited.size >= 100) {
            return new Response("Invalid Meta pagination; existing metrics preserved", { status: 502 });
          }
          visited.add(nextUrl.href);
          const response = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) return new Response("Meta synchronization failed", { status: 502 });
          const body = objectValue(await response.json());
          if (!Array.isArray(body.data)) {
            return new Response("Invalid Meta response; existing metrics preserved", { status: 502 });
          }
          for (const insight of body.data.map(objectValue)) {
            rows.push({
              provider_account_id: account.id,
              metric_date: insight.date_start,
              investment: Number(insight.spend) || 0,
              impressions: Number(insight.impressions) || 0,
              clicks: Number(insight.inline_link_clicks ?? insight.clicks) || 0,
              page_views: actionValue(insight, ["landing_page_view"]),
              checkouts: actionValue(insight, ["initiate_checkout", "omni_initiated_checkout"]),
            });
          }
          const paging = objectValue(body.paging);
          next = typeof paging.next === "string" ? paging.next : null;
        }
      } catch {
        return new Response("Meta synchronization failed; existing metrics preserved", { status: 502 });
      }
    }
    const { data: count, error } = await supabase.rpc("replace_meta_metrics", {
      p_organization_id: project.organization_id,
      p_project_id: project.id,
      p_since: since,
      p_until: until,
      p_provider_account_ids: projectAccounts.map((account) => account.id),
      p_rows: rows,
    });
    if (error) return new Response("Metric persistence failed", { status: 503 });
    processedProjects += 1;
    processedRows += Number(count ?? 0);
  }

  return Response.json({ projects: processedProjects, rows: processedRows });
});

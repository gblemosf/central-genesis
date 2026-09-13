import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConnectionSecret } from "@/lib/secret-store";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { hotmartAccessToken } from "@/lib/provider-verification";
import {
  historyStatuses,
  historyWindow,
  nextHistoryCursor,
  normalizeHistoryPurchase,
  type HistoryCursor,
} from "@/lib/hotmart-history";
import { record, text } from "@/lib/sales-attribution";

const pageSchema = z.object({
  items: z.array(z.unknown()),
  page_info: z
    .object({
      next_page_token: z.string().optional(),
      total_results: z.number().optional(),
    })
    .optional(),
});
export async function hotmartHistoryPage(
  token: string,
  endpoint: "history" | "commissions" | "users",
  query: URLSearchParams,
) {
  let response: Response;
  try {
    response = await fetch(
      `https://developers.hotmart.com/payments/api/v1/sales/${endpoint}?${query}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new ApiError(
      "A Hotmart não respondeu. A importação tentará novamente.",
      503,
    );
  }
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    let providerCode: unknown;
    try {
      providerCode = record(JSON.parse(errorBody)).error;
    } catch {
      // Some gateways return HTML instead of the documented JSON error.
    }
    const errorCode = typeof providerCode === "string" &&
      /^[a-z_]{1,60}$/.test(providerCode) ? providerCode : "unknown";
    // Keep failures diagnosable without logging tokens, transaction IDs or buyers.
    console.warn("Hotmart history request failed", {
      endpoint,
      status: response.status,
      startDate: query.get("start_date"),
      endDate: query.get("end_date"),
      purchaseStatus: query.get("transaction_status"),
      hasTransaction: query.has("transaction"),
      hasPageToken: query.has("page_token"),
      contentType: response.headers.get("content-type"),
      errorCode,
      errorFields: ["product_id", "start_date", "end_date", "transaction_status", "page_token", "max_results", "Authorization", "header", "too large"].filter((field) => errorBody.includes(field)),
    });
    if ([401, 403].includes(response.status))
      throw new ApiError(
        "A Hotmart recusou o acesso ao histórico ou aos detalhes da venda. Confira as permissões da conexão.",
        403,
      );
    if (response.status === 429)
      throw new ApiError(
        "Limite temporário da Hotmart. A importação tentará novamente.",
        429,
      );
    throw new ApiError(
      `Não foi possível consultar ${endpoint === "history" ? "o histórico" : endpoint === "commissions" ? "as comissões" : "os participantes"} da Hotmart (HTTP ${response.status}). Tente novamente.`,
      503,
    );
  }
  const parsed = pageSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new ApiError(
      "A Hotmart retornou um formato de histórico inesperado.",
      502,
    );
  return parsed.data;
}

// One durable page per invocation. A lease prevents overlapping cron invocations;
// page application and the checkpoint commit in a single database transaction.
export async function processHotmartHistoryJob() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new ApiError("Serviço indisponível.", 503);
  const claimed = await admin.rpc("claim_hotmart_history_import");
  if (claimed.error)
    throw new ApiError(
      "Não foi possível consultar a fila de importações.",
      503,
    );
  const job = claimed.data?.[0];
  if (!job) return { processed: 0, idle: true };
  try {
    const { data: product, error } = await admin
      .from("products")
      .select("external_id,integration_connections!inner(provider,revoked_at)")
      .eq("id", job.product_id)
      .single();
    if (error || !product) throw new ApiError("Produto não encontrado.", 422);
    const connection = record(product.integration_connections);
    if (connection.provider !== "hotmart" || connection.revoked_at)
      throw new ApiError(
        "A conexão Hotmart está indisponível ou foi revogada.",
        422,
      );
    const credentials = decodeProviderCredentials(
      "hotmart",
      await readConnectionSecret(job.connection_id),
    );
    let token: string;
    try {
      token = await hotmartAccessToken(credentials);
    } catch {
      throw new ApiError(
        "Não foi possível autenticar a conexão Hotmart. Confira suas credenciais.",
        403,
      );
    }
    const cursor = job.cursor as HistoryCursor;
    const end = new Date(job.end_at).getTime();
    const window = historyWindow(cursor, end);
    const query = new URLSearchParams({
      product_id: product.external_id,
      start_date: String(window.start),
      end_date: String(window.end),
      transaction_status: historyStatuses[cursor.statusIndex],
      max_results: "5",
    });
    if (cursor.pageToken) query.set("page_token", cursor.pageToken);
    const observedAt = new Date().toISOString();
    const page = await hotmartHistoryPage(token, "history", query);
    const rows = [];
    for (const item of page.items) {
      const transaction = text(record(record(item).purchase).transaction);
      if (!transaction)
        throw new ApiError("A Hotmart retornou uma compra sem transação.", 502);
      const detailsQuery = new URLSearchParams({
        transaction,
        max_results: "100",
      });
      const [commissions, users] = await Promise.all([
        hotmartHistoryPage(token, "commissions", detailsQuery),
        hotmartHistoryPage(token, "users", detailsQuery),
      ]);
      if (
        commissions.page_info?.next_page_token ||
        users.page_info?.next_page_token
      )
        throw new ApiError(
          "Os detalhes desta transação excederam o limite de consulta. Revise a importação.",
          422,
        );
      const findTransaction = (items: unknown[]) =>
        items.find((row) => record(row).transaction === transaction);
      rows.push(
        normalizeHistoryPurchase(
          item,
          findTransaction(commissions.items),
          findTransaction(users.items),
        ),
      );
    }
    const next = nextHistoryCursor(
      cursor,
      end,
      page.page_info?.next_page_token,
    );
    const applied = await admin.rpc("apply_hotmart_history_page", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_rows: rows,
      p_next_cursor: next,
      p_observed_at: observedAt,
    });
    if (applied.error)
      throw new ApiError(
        "Não foi possível salvar o lote. Confira se o produto continua vinculado ao projeto e à moeda correta.",
        503,
      );
    return { processed: rows.length, complete: !next };
  } catch (cause) {
    const attempts = job.attempts + 1;
    const terminal =
      attempts >= 3 ||
      (cause instanceof ApiError && [403, 422].includes(cause.status));
    const message =
      cause instanceof ApiError
        ? cause.message
        : "Não foi possível validar o lote da Hotmart. Revise a importação antes de tentar novamente.";
    const failed = await admin
      .from("hotmart_import_jobs")
      .update({
        status: terminal ? "failed" : "queued",
        attempts,
        lease_id: null,
        lease_until: null,
        error_message: message,
        updated_at: new Date().toISOString(),
        run_after: new Date(Date.now() + attempts * 60_000).toISOString(),
      })
      .eq("id", job.id)
      .eq("lease_id", job.lease_id);
    if (failed.error)
      throw new ApiError(
        "Não foi possível registrar a tentativa de importação.",
        503,
      );
    return { processed: 0, failed: terminal, retrying: !terminal };
  }
}

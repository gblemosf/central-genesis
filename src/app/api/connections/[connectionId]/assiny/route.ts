import { z } from "zod";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { readConnectionSecret } from "@/lib/secret-store";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeAssinyPayload } from "@/lib/assiny-webhook";
import { record } from "@/lib/sales-attribution";

const noStore = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request, route: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await route.params;
    z.uuid().parse(connectionId);
    const context = await requireAdmin();
    const { data: connection, error } = await context.supabase.from("integration_connections")
      .select("id,provider,revoked_at,metadata").eq("id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
    if (error) throw new ApiError("Não foi possível consultar a conexão Assiny.", 503);
    if (!connection || connection.provider !== "assiny" || connection.revoked_at) throw new ApiError("Conexão Assiny não encontrada.", 404);
    const search = new URL(request.url).searchParams;
    if (search.get("endpoint") === "true") {
      const credential = decodeProviderCredentials("assiny", await readConnectionSecret(connectionId));
      if (!credential.webhookToken || !/^[a-f0-9]{64}$/.test(credential.webhookToken)) throw new ApiError("Endereço protegido indisponível. Reconfigure a conexão Assiny.", 503);
      const endpoint = new URL(`${getSupabasePublicEnv().url}/functions/v1/assiny-webhook/${connectionId}`);
      endpoint.searchParams.set("token", credential.webhookToken);
      return Response.json({ endpointUrl: endpoint.toString() }, { headers: noStore });
    }
    const receiptId = search.get("receipt");
    if (receiptId) {
      z.uuid().parse(receiptId);
      const result = await context.supabase.from("assiny_webhook_receipts").select("id,state,payload,normalized_payload,review_reason,event_name,received_at")
        .eq("id", receiptId).eq("connection_id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
      if (result.error) throw new ApiError("Não foi possível consultar o evento Assiny.", 503);
      if (!result.data) throw new ApiError("Evento não encontrado.", 404);
      return Response.json({ receipt: result.data }, { headers: noStore });
    }
    const result = await context.supabase.from("assiny_webhook_receipts").select("id,state,review_reason,event_name,received_at,project_id,processed_at")
      .eq("connection_id", connectionId).eq("organization_id", context.organizationId)
      .order("received_at", { ascending: false }).order("id", { ascending: false }).limit(30);
    if (result.error) throw new ApiError("O recebimento Assiny ainda precisa ser publicado no Supabase.", 503);
    const contract = record(record(connection.metadata).assiny_payload_contract);
    return Response.json({ receipts: result.data ?? [], contractReady: contract.version === 1 && contract.amountUnit === "cents" }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(_request: Request, route: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await route.params;
    z.uuid().parse(connectionId);
    const context = await requireAdmin();
    const connection = await context.supabase.from("integration_connections").select("id,provider,revoked_at,metadata")
      .eq("id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
    if (connection.error) throw new ApiError("Não foi possível consultar a Assiny.", 503);
    if (!connection.data || connection.data.provider !== "assiny" || connection.data.revoked_at) throw new ApiError("Conexão Assiny não encontrada.", 404);
    const contract = record(record(connection.data.metadata).assiny_payload_contract);
    if (contract.version !== 1 || contract.amountUnit !== "cents") throw new ApiError("O formato dos eventos Assiny precisa ser validado antes de processar as pendências.", 422);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço de recebimento indisponível.", 503);
    const credentials = decodeProviderCredentials("assiny", await readConnectionSecret(connectionId));
    if (!credentials.webhookToken) throw new ApiError("Credencial de recebimento indisponível.", 503);
    const receipts = await context.supabase.from("assiny_webhook_receipts").select("id,idempotency_key,payload")
      .eq("connection_id", connectionId).eq("organization_id", context.organizationId)
      .in("state", ["awaiting_contract", "unmapped", "failed"])
      .order("last_attempt_at", { nullsFirst: true }).order("received_at").order("id").limit(100);
    if (receipts.error) throw new ApiError("Não foi possível consultar as pendências Assiny.", 503);
    let processed = 0, pending = 0, ignored = 0, tests = 0;
    for (const receipt of receipts.data ?? []) {
      const payload = record(receipt.payload);
      const event = normalizeAssinyPayload(payload, contract);
      const result = await admin.rpc("receive_assiny_normalized", { p_connection_id: connectionId, p_token: credentials.webhookToken,
        p_idempotency_key: receipt.idempotency_key, p_payload: payload, p_normalized: event.value ?? null, p_review_reason: event.reason ?? null });
      if (result.error) throw new ApiError("Uma pendência não pôde ser processada. Os eventos continuam armazenados.", 503);
      const state = record(result.data).state;
      if (state === "processed") processed++; else if (state === "test") tests++; else if (state === "ignored") ignored++; else pending++;
    }
    return Response.json({ processed, pending, ignored, tests, batchLimit: 100, batchFull: receipts.data?.length === 100 }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error); }
}

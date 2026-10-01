import { z } from "zod";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { readConnectionSecret } from "@/lib/secret-store";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePaytPayload, objectValue } from "@/lib/payt-postback";

const noStore = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache" };

export async function GET(request: Request, route: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await route.params;
    z.uuid().parse(connectionId);
    const context = await requireAdmin();
    const { data: connection, error } = await context.supabase.from("integration_connections")
      .select("id,provider,revoked_at,metadata").eq("id", connectionId)
      .eq("organization_id", context.organizationId).maybeSingle();
    if (error) throw new ApiError("Não foi possível consultar a conexão Payt.", 503);
    if (!connection || connection.provider !== "payt" || connection.revoked_at) throw new ApiError("Conexão Payt não encontrada.", 404);
    const search = new URL(request.url).searchParams;
    if (search.get("endpoint") === "true") {
      const credential = decodeProviderCredentials("payt", await readConnectionSecret(connectionId));
      if (!credential.webhookToken || !/^[a-f0-9]{64}$/.test(credential.webhookToken)) throw new ApiError("Endereço protegido indisponível. Reconfigure a conexão Payt.", 503);
      const endpoint = new URL(`${getSupabasePublicEnv().url}/functions/v1/payt-webhook/${connectionId}`);
      endpoint.searchParams.set("token", credential.webhookToken);
      return Response.json({ endpointUrl: endpoint.toString() }, { headers: noStore });
    }
    const receiptId = search.get("receipt");
    if (receiptId) {
      z.uuid().parse(receiptId);
      const result = await context.supabase.from("payt_webhook_receipts").select("id,event_name,state,review_reason,payload,normalized_payload,received_at")
        .eq("id", receiptId).eq("connection_id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
      if (result.error) throw new ApiError("Não foi possível consultar o evento.", 503);
      if (!result.data) throw new ApiError("Evento não encontrado.", 404);
      return Response.json({ receipt: result.data }, { headers: noStore });
    }
    const result = await context.supabase.from("payt_webhook_receipts").select("id,event_name,state,review_reason,received_at,processed_at,project_id")
      .eq("connection_id", connectionId).eq("organization_id", context.organizationId)
      .order("received_at", { ascending: false }).order("id", { ascending: false }).limit(30);
    if (result.error) throw new ApiError("O recebimento Payt ainda precisa ser publicado no Supabase.", 503);
    const metadata = connection.metadata as Record<string, unknown> | null;
    return Response.json({ receipts: result.data ?? [], received: Boolean(metadata?.last_webhook_at),
      contractReady: objectValue(metadata?.payt_payload_contract).version === 1, lastReceivedAt: metadata?.last_webhook_at ?? null }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(_request: Request, route: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await route.params;
    z.uuid().parse(connectionId);
    const context = await requireAdmin();
    const connection = await context.supabase.from("integration_connections").select("id,provider,metadata,revoked_at")
      .eq("id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
    if (connection.error) throw new ApiError("Não foi possível consultar a Payt.", 503);
    if (!connection.data || connection.data.provider !== "payt" || connection.data.revoked_at) throw new ApiError("Conexão Payt não encontrada.", 404);
    const contract = objectValue(connection.data.metadata).payt_payload_contract;
    if (objectValue(contract).version !== 1) throw new ApiError("Os campos do evento PayT V1 precisam ser validados antes de processar as pendências.", 422);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço de recebimento indisponível.", 503);
    const receipts = await context.supabase.from("payt_webhook_receipts").select("id,idempotency_key,payload")
      .eq("connection_id", connectionId).eq("organization_id", context.organizationId)
      .in("state", ["awaiting_contract", "unmapped", "failed"])
      .order("last_attempt_at", { nullsFirst: true }).order("received_at").order("id").limit(100);
    if (receipts.error) throw new ApiError("Não foi possível consultar as pendências Payt.", 503);
    let processed = 0, pending = 0;
    for (const receipt of receipts.data ?? []) {
      const payload = objectValue(receipt.payload);
      const event = normalizePaytPayload(payload, contract);
      const result = await admin.rpc("receive_payt_postback", { p_connection_id: connectionId, p_idempotency_key: receipt.idempotency_key,
        p_payload: payload, p_normalized: event.value ?? null, p_review_reason: event.reason ?? null });
      if (result.error) throw new ApiError("Uma pendência não pôde ser processada. Os eventos continuam armazenados.", 503);
      const state = objectValue(result.data).state;
      if (state === "processed" || state === "test") processed++; else pending++;
    }
    return Response.json({ processed, pending, batchLimit: 100, batchFull: receipts.data?.length === 100 }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error); }
}

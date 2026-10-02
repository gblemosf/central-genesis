import { z } from "zod";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { decodeProviderCredentials } from "@/lib/provider-credentials";
import { readConnectionSecret } from "@/lib/secret-store";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

const noStore = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request, route: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await route.params;
    z.uuid().parse(connectionId);
    const context = await requireAdmin();
    const { data: connection, error } = await context.supabase.from("integration_connections")
      .select("id,provider,revoked_at").eq("id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
    if (error) throw new ApiError("Não foi possível consultar a conexão Assiny.", 503);
    if (!connection || connection.provider !== "assiny" || connection.revoked_at) throw new ApiError("Conexão Assiny não encontrada.", 404);
    const search = new URL(request.url).searchParams;
    if (search.get("endpoint") === "true") {
      const credential = decodeProviderCredentials("assiny", await readConnectionSecret(connectionId));
      if (!credential.webhookToken || !/^[a-f0-9]{64}$/.test(credential.webhookToken)) throw new ApiError("Endereço de preparação indisponível. Reconfigure a conexão Assiny.", 503);
      const endpoint = new URL(`${getSupabasePublicEnv().url}/functions/v1/assiny-webhook/${connectionId}`);
      endpoint.searchParams.set("token", credential.webhookToken);
      return Response.json({ endpointUrl: endpoint.toString(), preparation: true }, { headers: noStore });
    }
    const receiptId = search.get("receipt");
    if (receiptId) {
      z.uuid().parse(receiptId);
      const result = await context.supabase.from("assiny_webhook_receipts").select("id,state,payload,received_at")
        .eq("id", receiptId).eq("connection_id", connectionId).eq("organization_id", context.organizationId).maybeSingle();
      if (result.error) throw new ApiError("Não foi possível consultar o evento Assiny.", 503);
      if (!result.data) throw new ApiError("Evento não encontrado.", 404);
      return Response.json({ receipt: result.data }, { headers: noStore });
    }
    const result = await context.supabase.from("assiny_webhook_receipts").select("id,state,received_at")
      .eq("connection_id", connectionId).eq("organization_id", context.organizationId)
      .order("received_at", { ascending: false }).order("id", { ascending: false }).limit(30);
    if (result.error) throw new ApiError("A preparação Assiny ainda precisa ser publicada no Supabase.", 503);
    return Response.json({ receipts: result.data ?? [], contractReady: false, processed: false }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error); }
}

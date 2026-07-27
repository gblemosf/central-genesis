import "server-only";

import { ApiError } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function storeConnectionSecret(
  connectionId: string,
  secret: string,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);

  const { error } = await admin.rpc("set_connection_secret", {
    p_connection_id: connectionId,
    p_secret: secret,
  });
  if (error) throw new ApiError("Nao foi possivel armazenar a credencial.", 500);
}

export async function readConnectionSecret(connectionId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);

  const { data, error } = await admin.rpc("get_connection_secret", {
    p_connection_id: connectionId,
  });
  if (error || typeof data !== "string") {
    throw new ApiError("Credencial nao encontrada.", 404);
  }
  return data;
}

export async function deleteConnectionSecret(connectionId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);

  const { error } = await admin.rpc("delete_connection_secret", {
    p_connection_id: connectionId,
  });
  if (error) throw new ApiError("Nao foi possivel apagar a credencial.", 500);
}

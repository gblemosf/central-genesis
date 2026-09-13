import "server-only";
import { ApiError } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function googleFormsJobSecret() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new ApiError("Serviço indisponível.", 503);
  const { data, error } = await admin.rpc("get_google_forms_sync_token");
  if (error) throw new ApiError("Não foi possível validar a sincronização.", 503);
  return typeof data === "string" ? data : "";
}

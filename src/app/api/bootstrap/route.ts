import { ApiError, apiErrorResponse } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) throw new ApiError("Supabase nao configurado.", 503);

    const { data, error: claimsError } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    const email = String(data?.claims?.email ?? "").toLowerCase();
    if (claimsError || !userId) throw new ApiError("Sessao invalida.", 401);

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (membershipError) {
      throw new ApiError("Nao foi possivel consultar a organizacao.", 503);
    }
    if (membership) return Response.json({ ready: true });

    const allowedEmails = (process.env.GENESIS_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowedEmails.includes(email)) {
      throw new ApiError(
        "Usuario sem permissao para inicializar a organizacao.",
        403,
      );
    }

    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);
    const { error } = await admin.rpc("bootstrap_organization", {
      organization_name: "Genesis",
      p_user_id: userId,
    });
    if (error) {
      if (error.message.includes("organization already initialized")) {
        throw new ApiError(
          "A organizacao ja existe. Um administrador precisa adicionar este usuario.",
          403,
        );
      }
      throw new ApiError("Nao foi possivel inicializar a organizacao.", 503);
    }

    return Response.json({ ready: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

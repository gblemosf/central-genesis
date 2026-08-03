import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface AdminContext {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string;
}

export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new ApiError("Supabase nao configurado.", 503);

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) throw new ApiError("Sessao invalida.", 401);

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin"])
    .maybeSingle();

  if (error) {
    throw new ApiError("Nao foi possivel validar a permissao.", 503);
  }
  if (!membership) {
    throw new ApiError("Permissao administrativa necessaria.", 403);
  }

  return {
    supabase,
    userId,
    organizationId: String(membership.organization_id),
  };
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Revise os campos informados.",
        issues: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Dados da requisicao invalidos." }, { status: 400 });
  }
  return Response.json({ error: "Erro interno." }, { status: 500 });
}

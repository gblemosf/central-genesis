import { timingSafeEqual } from "node:crypto";
import { ApiError, apiErrorResponse } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncProjectGoogleForm } from "@/lib/google/sync";
import { googleFormsJobSecret } from "@/lib/google/job-auth";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const secret = googleFormsJobSecret();
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret ?? ""}`);
    if (
      !secret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new ApiError("Não autorizado.", 401);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço indisponível.", 503);
    // Expire abandoned leases after twice the maximum execution time.
    const stale = await admin
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message:
          "Sincronização interrompida; será retomada do último lote salvo.",
      })
      .eq("job_type", "google_forms.responses")
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 600_000).toISOString());
    if (stale.error)
      throw new ApiError("Não foi possível consultar as sincronizações.", 503);
    const { data: forms, error } = await admin
      .from("google_forms")
      .select(
        "id,project_id,organization_id,projects!inner(deleted_at),integration_connections!inner(provider,revoked_at)",
      )
      .is("archived_at", null)
      .is("projects.deleted_at", null)
      .is("integration_connections.revoked_at", null)
      .eq("integration_connections.provider", "google_forms")
      .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
      .order("id")
      .limit(1);
    if (error)
      throw new ApiError("Não foi possível consultar os formulários.", 503);
    if (!forms?.length) return Response.json({ processed: 0 });
    const form = forms[0];
    const attempt = await admin
      .from("google_forms")
      .update({ last_sync_attempt_at: new Date().toISOString() })
      .eq("id", form.id);
    if (attempt.error)
      throw new ApiError("Não foi possível iniciar a sincronização.", 503);
    try {
      const result = await syncProjectGoogleForm(
        { supabase: admin, organizationId: form.organization_id },
        form.project_id,
        { googleFormId: form.id, fullSync: false },
      );
      return Response.json({
        processed: result.processed,
        hasMore: result.hasMore,
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409)
        return Response.json({ busy: true });
      throw cause;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

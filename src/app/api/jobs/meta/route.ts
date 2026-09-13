import { timingSafeEqual } from "node:crypto";
import { ApiError, apiErrorResponse } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncProjectMeta } from "@/lib/meta-sync";
import { dateInTimezone, subtractCalendarDays } from "@/lib/dates";
import { presetPeriod } from "@/lib/analysis-filters";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) throw new ApiError("Não autorizado.", 401);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço indisponível.", 503);
    const { data: secret, error } = await admin.rpc("get_meta_sync_job_token");
    if (error) throw new ApiError("Não foi possível validar a atualização.", 503);
    const actual = Buffer.from(authorization), expected = Buffer.from(`Bearer ${secret ?? ""}`);
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError("Não autorizado.", 401);
    const { data: job, error: claimError } = await admin.rpc("claim_meta_sync_job");
    if (claimError) throw new ApiError("Não foi possível iniciar a atualização.", 503);
    if (!job) return Response.json({ idle: true });
    try {
      const until = dateInTimezone(new Date(), job.timezone);
      const since = job.initial ? presetPeriod("6m", until).start : subtractCalendarDays(until, 9);
      const result = await syncProjectMeta({ supabase: admin, organizationId: job.organizationId }, job.projectId, { since, until }, job.runId);
      return Response.json(result);
    } catch (cause) {
      await admin.from("sync_runs").update({ status: "failed", finished_at: new Date().toISOString(),
        error_message: "A Meta não pôde ser atualizada. Confira a conexão; uma nova tentativa ocorrerá automaticamente." }).eq("id", job.runId).eq("status", "running");
      throw cause instanceof ApiError ? cause : new ApiError("Falha ao atualizar Meta.", 503);
    }
  } catch (cause) { return apiErrorResponse(cause); }
}

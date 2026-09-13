import { timingSafeEqual } from "node:crypto";
import { ApiError, apiErrorResponse } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processHotmartHistoryJob } from "@/lib/hotmart-history-worker";
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer "))
      throw new ApiError("Não autorizado.", 401);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço indisponível.", 503);
    const { data: secret, error } = await admin.rpc(
      "get_hotmart_history_job_token",
    );
    if (error)
      throw new ApiError("Não foi possível validar a importação.", 503);
    const actual = Buffer.from(authorization),
      expected = Buffer.from(`Bearer ${secret ?? ""}`);
    if (
      !secret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new ApiError("Não autorizado.", 401);
    const started = Date.now();
    let processed = 0;
    for (let page = 0; page < 10; page++) {
      const result = await processHotmartHistoryJob();
      processed += result.processed;
      if (
        result.idle ||
        result.failed ||
        result.retrying ||
        Date.now() - started > 45_000
      )
        break;
    }
    return Response.json({ processed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

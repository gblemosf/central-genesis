import { z } from "zod";
import {
  ApiError,
  apiErrorResponse,
  requireActiveProject,
  requireAdmin,
} from "@/lib/api-auth";
import { withGoogleAccessToken } from "@/lib/google/forms";
import { fetchLinkedSheet } from "@/lib/google/sheets";
import {
  readConnectionSecret,
  storeConnectionSecret,
} from "@/lib/secret-store";

export async function GET(
  request: Request,
  route: { params: Promise<{ projectId: string; formId: string }> },
) {
  try {
    const { projectId, formId } = await route.params;
    z.uuid().parse(projectId);
    z.uuid().parse(formId);
    const context = await requireAdmin();
    await requireActiveProject(context, projectId);
    const params = new URL(request.url).searchParams;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .parse(params.get("page") ?? 1);
    const sheetId = params.has("sheetId")
      ? z.coerce.number().int().nonnegative().parse(params.get("sheetId"))
      : undefined;
    const { data: form, error } = await context.supabase
      .from("google_forms")
      .select("connection_id,linked_sheet_id")
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId)
      .eq("id", formId)
      .is("archived_at", null)
      .maybeSingle();
    if (error)
      throw new ApiError("Não foi possível consultar o formulário.", 503);
    if (!form)
      throw new ApiError("Formulário não encontrado neste projeto.", 404);
    if (!form.linked_sheet_id)
      throw new ApiError(
        "Este formulário não possui uma planilha vinculada. Vincule-a no Google Forms e sincronize o formulário novamente.",
        422,
      );
    const connection = await context.supabase
      .from("integration_connections")
      .select("id")
      .eq("id", form.connection_id)
      .eq("organization_id", context.organizationId)
      .eq("provider", "google_forms")
      .is("revoked_at", null)
      .maybeSingle();
    if (connection.error || !connection.data)
      throw new ApiError("Conexão Google indisponível.", 422);
    const data = await withGoogleAccessToken(
      {
        raw: await readConnectionSecret(form.connection_id),
        save: (raw) => storeConnectionSecret(form.connection_id, raw),
      },
      (token) => fetchLinkedSheet(form.linked_sheet_id, token, sheetId, page),
    );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

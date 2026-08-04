import {
  ApiError,
  apiErrorResponse,
  requireActiveProject,
  requireAdmin,
} from "@/lib/api-auth";
import { funnelStageUpdateInputSchema } from "@/lib/validators";

async function getStage(
  projectId: string,
  stageId: string,
  context: Awaited<ReturnType<typeof requireAdmin>>,
) {
  await requireActiveProject(context, projectId);
  const { data, error } = await context.supabase
    .from("funnel_stages")
    .select("id,name,stage_type,color,archived_at")
    .eq("id", stageId)
    .eq("project_id", projectId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (error) throw new ApiError("Nao foi possivel consultar a etapa.", 503);
  if (!data) throw new ApiError("Etapa nao encontrada.", 404);
  return data;
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ projectId: string; stageId: string }> },
) {
  try {
    const { projectId, stageId } = await route.params;
    const context = await requireAdmin();
    const input = funnelStageUpdateInputSchema.parse(await request.json());
    const current = await getStage(projectId, stageId, context);
    const { error } = await context.supabase.rpc("update_project_funnel_stage", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_stage_id: stageId,
      p_name: input.name,
      p_stage_type: input.type,
      p_color: input.color,
      p_archived: input.archived ?? Boolean(current.archived_at),
    });
    if (error) throw error;
    return Response.json({ saved: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  route: { params: Promise<{ projectId: string; stageId: string }> },
) {
  try {
    const { projectId, stageId } = await route.params;
    const context = await requireAdmin();
    const current = await getStage(projectId, stageId, context);
    const { error } = await context.supabase.rpc("update_project_funnel_stage", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_stage_id: stageId,
      p_name: current.name,
      p_stage_type: current.stage_type,
      p_color: current.color,
      p_archived: true,
    });
    if (error) throw error;
    return Response.json({ archived: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

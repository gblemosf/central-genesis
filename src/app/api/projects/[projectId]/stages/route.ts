import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  funnelStageInputSchema,
  funnelStageOrderInputSchema,
} from "@/lib/validators";

export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = funnelStageInputSchema.parse(await request.json());
    const { data: stageId, error } = await context.supabase.rpc(
      "create_project_funnel_stage",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_name: input.name,
        p_stage_type: input.type,
        p_color: input.color,
      },
    );
    if (error) throw error;
    return Response.json({ data: { id: stageId } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = funnelStageOrderInputSchema.parse(await request.json());
    const { error } = await context.supabase.rpc("reorder_project_funnel_stages", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_stage_ids: input.stageIds,
    });
    if (error) throw error;
    return Response.json({ saved: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

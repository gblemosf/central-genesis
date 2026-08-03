import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  projectMappingsInputSchema,
  projectProductInputSchema,
} from "@/lib/validators";

export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = projectProductInputSchema.parse(await request.json());
    const { data: productId, error } = await context.supabase.rpc(
      "create_project_product",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_connection_id: input.connectionId,
        p_external_id: input.externalId,
        p_name: input.name,
        p_current_price: input.price,
        p_currency: input.currency,
        p_funnel_stage_id: input.funnelStageId,
      },
    );
    if (error?.code === "23505") {
      throw new ApiError("Ja existe um produto com esse identificador.", 409);
    }
    if (error) throw error;

    return Response.json({ data: { id: productId } }, { status: 201 });
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
    const input = projectMappingsInputSchema.parse(await request.json());
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (projectError) throw new ApiError("Nao foi possivel consultar o projeto.", 503);
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    const { error } = await context.supabase.rpc(
      "replace_project_product_mappings",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_mappings: input.mappings.map((mapping) => ({
          product_id: mapping.productId,
          funnel_stage_id: mapping.funnelStageId,
        })),
      },
    );
    if (error) throw error;

    return Response.json({ saved: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

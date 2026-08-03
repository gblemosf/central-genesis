import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  projectProductArchiveInputSchema,
  projectProductUpdateInputSchema,
} from "@/lib/validators";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ projectId: string; productId: string }> },
) {
  try {
    const { projectId, productId } = await route.params;
    const context = await requireAdmin();
    const body = await request.json();
    const archiveInput = projectProductArchiveInputSchema.safeParse(body);

    if (archiveInput.success && Object.keys(body).length === 1) {
      const { error } = await context.supabase.rpc("set_project_product_archived", {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_product_id: productId,
        p_archived: archiveInput.data.archived,
      });
      if (error) throw error;
      return Response.json({ saved: true });
    }

    const input = projectProductUpdateInputSchema.parse(body);
    const { error } = await context.supabase.rpc("update_project_product", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_product_id: productId,
      p_external_id: input.externalId,
      p_name: input.name,
      p_current_price: input.price,
      p_currency: input.currency,
      p_funnel_stage_id: input.funnelStageId,
    });
    if (error?.code === "23505") {
      throw new ApiError("Ja existe um produto com esse identificador.", 409);
    }
    if (error) throw error;
    return Response.json({ saved: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  route: { params: Promise<{ projectId: string; productId: string }> },
) {
  try {
    const { projectId, productId } = await route.params;
    const context = await requireAdmin();
    const { error } = await context.supabase.rpc("set_project_product_archived", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_product_id: productId,
      p_archived: true,
    });
    if (error) throw error;
    return Response.json({ archived: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

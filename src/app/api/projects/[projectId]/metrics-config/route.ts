import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { projectMetricConfigInputSchema } from "@/lib/validators";

export async function PUT(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = projectMetricConfigInputSchema.parse(await request.json());
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,settings")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (projectError) throw new ApiError("Nao foi possivel consultar o projeto.", 503);
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    const selectedProductIds = [
      input.ticketProductId,
      input.formationProductId,
      input.downsellProductId,
    ].filter((productId): productId is string => Boolean(productId));
    if (selectedProductIds.length) {
      const { data: mappings, error: mappingsError } = await context.supabase
        .from("product_mappings")
        .select("product_id")
        .eq("project_id", projectId)
        .is("effective_to", null)
        .in("product_id", selectedProductIds);
      if (mappingsError) {
        throw new ApiError("Nao foi possivel validar os produtos do projeto.", 503);
      }
      const mappedIds = new Set((mappings ?? []).map((mapping) => mapping.product_id));
      if (selectedProductIds.some((productId) => !mappedIds.has(productId))) {
        throw new ApiError("Um produto selecionado nao pertence ao projeto.", 422);
      }
    }

    const currentSettings =
      project.settings !== null &&
      typeof project.settings === "object" &&
      !Array.isArray(project.settings)
        ? (project.settings as Record<string, unknown>)
        : {};
    const { error: updateError } = await context.supabase
      .from("projects")
      .update({ settings: { ...currentSettings, metrics: input } })
      .eq("id", projectId)
      .eq("organization_id", context.organizationId);
    if (updateError) throw updateError;

    return Response.json({ data: input });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

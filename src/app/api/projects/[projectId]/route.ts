import { revalidatePath } from "next/cache";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { projectUpdateInputSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = projectUpdateInputSchema.parse(await request.json());
    const { data: project, error } = await context.supabase
      .from("projects")
      .update({
        monthly_revenue_target: input.monthlyTarget,
        margin_target: input.marginTarget,
        status: input.status,
      })
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return Response.json({ data: input });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

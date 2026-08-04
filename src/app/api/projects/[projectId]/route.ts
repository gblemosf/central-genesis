import { revalidatePath } from "next/cache";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  projectDeleteInputSchema,
  projectUpdateInputSchema,
} from "@/lib/validators";

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
      .is("deleted_at", null)
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

export async function DELETE(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const body = await request.text();
    const input = projectDeleteInputSchema.parse(body ? JSON.parse(body) : {});
    const { data, error } = input.legacy
      ? await context.supabase.rpc("soft_delete_legacy_project", {
          p_organization_id: context.organizationId,
          p_slug: projectId,
          p_name: input.name,
        })
      : await context.supabase.rpc("soft_delete_project", {
          p_organization_id: context.organizationId,
          p_project_id: projectId,
        });
    if (error?.code === "P0002") throw new ApiError("Projeto nao encontrado.", 404);
    if (error) throw error;
    const project = data as { id: string; name: string } | null;
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    revalidatePath("/");
    revalidatePath("/overview");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return Response.json({ data: { id: project.id, name: project.name } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

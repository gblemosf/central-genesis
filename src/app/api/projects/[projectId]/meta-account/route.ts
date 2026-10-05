import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { projectMetaAccountInputSchema } from "@/lib/validators";

export async function PUT(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = projectMetaAccountInputSchema.parse(await request.json());
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (projectError) throw new ApiError("Nao foi possivel consultar o projeto.", 503);
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    const multiple = "providerAccountIds" in input;
    const { error } = await context.supabase.rpc(
      multiple ? "set_project_meta_accounts" : "set_project_meta_account",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        ...(multiple
          ? { p_provider_account_ids: input.providerAccountIds }
          : { p_provider_account_id: input.providerAccountId }),
      },
    );
    if (error?.code === "23505") {
      throw new ApiError("Esta conta Meta ja esta vinculada a outro projeto.", 409);
    }
    if (error?.code === "22023") {
      throw new ApiError("Selecione contas Meta ativas com a mesma moeda e fuso do projeto.", 422);
    }
    if (error) throw error;

    return Response.json({ saved: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

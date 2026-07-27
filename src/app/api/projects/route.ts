import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { projectInputSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const context = await requireAdmin();
    const input = projectInputSchema.parse(await request.json());

    const { data: project, error: createError } = await context.supabase.rpc(
      "create_project_with_defaults",
      {
        p_organization_id: context.organizationId,
        p_name: input.name,
        p_slug: input.slug,
        p_expert_name: input.expertName,
        p_expert_email: input.expertEmail ?? null,
        p_sales_provider: input.salesProvider,
        p_monthly_target: input.monthlyTarget,
        p_margin_target: input.marginTarget,
        p_meta_connection_id: input.metaConnectionId ?? null,
        p_meta_account_external_id: input.metaAdAccountExternalId ?? null,
      },
    );
    if (createError) throw createError;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("Invalid project response");
    }

    return Response.json({ data: project }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

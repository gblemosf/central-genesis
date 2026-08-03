import { revalidatePath } from "next/cache";
import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { projectInputSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const context = await requireAdmin();
    const input = projectInputSchema.parse(await request.json());

    const { data: project, error: createError } = await context.supabase.rpc(
      "create_project_with_funnel",
      {
        p_organization_id: context.organizationId,
        p_name: input.name,
        p_slug: input.slug,
        p_expert_name: input.expertName,
        p_expert_email: input.expertEmail ?? null,
        p_sales_provider: input.salesProvider,
        p_sales_connection_id: input.salesConnectionId,
        p_monthly_target: input.monthlyTarget,
        p_margin_target: input.marginTarget,
        p_funnel: input.funnel,
        p_meta_connection_id: input.metaConnectionId ?? null,
        p_meta_account_external_id: input.metaAdAccountExternalId ?? null,
      },
    );
    if (createError?.code === "23505") {
      return Response.json(
        { error: "Ja existe um projeto com este identificador." },
        { status: 409 },
      );
    }
    if (createError) throw createError;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("Invalid project response");
    }

    revalidatePath("/");
    revalidatePath("/projects");
    return Response.json({ data: project }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

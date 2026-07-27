import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { connectionWithCredentialInputSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const context = await requireAdmin();
    const input = connectionWithCredentialInputSchema.parse(await request.json());
    const { data, error: createError } = await context.supabase.rpc(
      "create_connection_with_secret",
      {
        p_organization_id: context.organizationId,
        p_name: input.name,
        p_provider: input.provider,
        p_credential: input.credential,
        p_business_id: input.businessId ?? null,
        p_app_id: input.appId ?? null,
        p_system_user_id: input.systemUserId ?? null,
      },
    );
    if (createError) throw createError;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid connection response");
    }

    return Response.json(
      {
        data: {
          id: String(data.id),
          name: String(data.name),
          provider: data.provider,
          status: data.status,
          businessId: data.business_id ? String(data.business_id) : undefined,
          accountCount: 0,
          lastVerifiedAt: null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

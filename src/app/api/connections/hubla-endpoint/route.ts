import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { z } from "zod";

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export async function POST(request: Request) {
  try {
    const context = await requireAdmin();
    const input = inputSchema.parse(await request.json());
    const { data, error } = await context.supabase.rpc(
      "create_hubla_webhook_connection",
      {
        p_organization_id: context.organizationId,
        p_name: input.name,
      },
    );
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid Hubla connection response");
    }

    const supabaseUrl = getSupabasePublicEnv().url;
    return Response.json(
      {
        data: {
          id: String(data.id),
          name: String(data.name),
          provider: "hubla",
          status: "disconnected",
          accountCount: 0,
          productCount: 0,
          lastVerifiedAt: null,
          endpointUrl: `${supabaseUrl}/functions/v1/hubla-webhook/${data.id}`,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { requireAdmin, apiErrorResponse } from "@/lib/api-auth";
import { googleFormSyncInputSchema } from "@/lib/validators";
import { syncProjectGoogleForm } from "@/lib/google/sync";
export const maxDuration = 300;
export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const input = googleFormSyncInputSchema.parse(await request.json());
    const data = await syncProjectGoogleForm(context, projectId, input);
    return Response.json({ data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

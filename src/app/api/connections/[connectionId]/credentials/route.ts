import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  deleteConnectionSecret,
  storeConnectionSecret,
} from "@/lib/secret-store";
import { credentialInputSchema } from "@/lib/validators";

async function assertConnection(connectionId: string) {
  const context = await requireAdmin();
  const { data, error } = await context.supabase
    .from("integration_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (error) throw new ApiError("Nao foi possivel consultar a conexao.", 503);
  if (!data) throw new ApiError("Conexao nao encontrada.", 404);
  return context;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await context.params;
    await assertConnection(connectionId);
    const input = credentialInputSchema.parse(await request.json());
    await storeConnectionSecret(connectionId, input.credential);

    return Response.json({ stored: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await context.params;
    await assertConnection(connectionId);
    await deleteConnectionSecret(connectionId);

    return Response.json({ revoked: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  deleteConnectionSecret,
  readConnectionSecret,
  storeConnectionSecret,
} from "@/lib/secret-store";
import type { Provider } from "@/lib/domain";
import { serializeProviderCredentials } from "@/lib/provider-credentials";
import { credentialInputSchema } from "@/lib/validators";

async function assertConnection(connectionId: string) {
  const context = await requireAdmin();
  const { data, error } = await context.supabase
    .from("integration_connections")
    .select("id,provider")
    .eq("id", connectionId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (error) throw new ApiError("Nao foi possivel consultar a conexao.", 503);
  if (!data) throw new ApiError("Conexao nao encontrada.", 404);
  return { context, connection: data };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await context.params;
    const input = credentialInputSchema.parse(await request.json());
    const result = await assertConnection(connectionId);
    const existing = await readConnectionSecret(connectionId).catch(() => undefined);
    const credential = serializeProviderCredentials(
      result.connection.provider as Provider,
      input.credentials,
      existing,
    );
    await storeConnectionSecret(connectionId, credential);

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

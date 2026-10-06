import { z } from "zod";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { record } from "@/lib/sales-attribution";

const inputSchema = z.object({ archived: z.boolean() }).strict();

export async function PATCH(
  request: Request,
  route: { params: Promise<{ connectionId: string }> },
) {
  try {
    const context = await requireAdmin();
    const { connectionId } = await route.params;
    const input = inputSchema.parse(await request.json());
    const { data: connection, error } = await context.supabase
      .from("integration_connections")
      .select("id,status,revoked_at,metadata")
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (error) throw new ApiError("Não foi possível consultar a conexão.", 503);
    if (!connection) throw new ApiError("Conexão não encontrada.", 404);
    if (connection.status !== "revoked" || !connection.revoked_at) {
      throw new ApiError("Revogue a credencial antes de arquivar a conexão.", 409);
    }

    if (input.archived) {
      // Deleted projects and closed product mappings are historical references.
      // Only current assignments prevent taking a revoked source out of the list.
      const links = await Promise.all([
        context.supabase.from("project_accounts")
          .select("project_id,projects!inner(deleted_at),provider_accounts!inner(connection_id)", { count: "exact", head: true })
          .eq("organization_id", context.organizationId)
          .eq("provider_accounts.connection_id", connectionId)
          .is("projects.deleted_at", null),
        context.supabase.from("product_mappings")
          .select("id,projects!inner(deleted_at),products!inner(connection_id)", { count: "exact", head: true })
          .eq("organization_id", context.organizationId)
          .eq("products.connection_id", connectionId)
          .is("effective_to", null)
          .is("projects.deleted_at", null),
        context.supabase.from("google_forms")
          .select("id,projects!inner(deleted_at)", { count: "exact", head: true })
          .eq("organization_id", context.organizationId)
          .eq("connection_id", connectionId)
          .is("archived_at", null)
          .is("projects.deleted_at", null),
      ]);
      if (links.some(link => link.error || link.count === null)) {
        throw new ApiError("Não foi possível conferir os projetos vinculados.", 503);
      }
      if (links.some(link => (link.count ?? 0) > 0)) {
        throw new ApiError("A conexão ainda está configurada em um projeto não excluído. Remova seus vínculos antes de arquivar.", 409);
      }
    }

    const metadata = record(connection.metadata);
    const archivedAt = input.archived
      ? typeof metadata.genesis_archived_at === "string"
        ? metadata.genesis_archived_at
        : new Date().toISOString()
      : null;
    const nextMetadata = { ...metadata };
    if (archivedAt) nextMetadata.genesis_archived_at = archivedAt;
    else delete nextMetadata.genesis_archived_at;

    // Compare the metadata snapshot to avoid overwriting a concurrent change.
    // Archiving never deletes credentials, catalog, purchases, or project history.
    const saved = await context.supabase.from("integration_connections")
      .update({ metadata: nextMetadata })
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId)
      .eq("status", "revoked")
      .eq("revoked_at", connection.revoked_at)
      .eq("metadata", JSON.stringify(metadata))
      .select("id")
      .maybeSingle();
    if (saved.error) throw new ApiError("Não foi possível salvar o arquivamento.", 503);
    if (!saved.data) throw new ApiError("A conexão mudou durante a operação. Atualize a página e tente novamente.", 409);

    return Response.json({ data: { id: connectionId, archivedAt } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

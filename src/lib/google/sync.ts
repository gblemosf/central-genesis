import "server-only";
import { revalidatePath } from "next/cache";
import {
  ApiError,
  requireActiveProject,
  type AdminContext,
} from "@/lib/api-auth";
import {
  extractGoogleFormId,
  fetchGoogleForm,
  fetchGoogleFormResponsePage,
  withGoogleAccessToken,
} from "@/lib/google/forms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  readConnectionSecret,
  storeConnectionSecret,
} from "@/lib/secret-store";
import { googleFormSyncInputSchema } from "@/lib/validators";
import type { z } from "zod";

interface GoogleFormRow {
  id: string;
  connection_id: string;
  external_form_id: string;
  response_cursor_at: string | null;
  last_response_at: string | null;
  response_page_token: string | null;
  response_page_since: string | null;
  response_pending_cursor_at: string | null;
}

function latestSubmittedAt(responses: { submittedAt: string }[]) {
  return responses.reduce<string | null>((latest, response) => {
    if (!latest || response.submittedAt > latest) return response.submittedAt;
    return latest;
  }, null);
}

async function createSyncRun(input: {
  organizationId: string;
  projectId: string;
  connectionId: string;
  googleFormId: string | null;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("sync_runs")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      connection_id: input.connectionId,
      google_form_id: input.googleFormId,
      job_type: "google_forms.responses",
      status: "running",
      started_at: new Date().toISOString(),
      metadata: {},
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    throw new ApiError(
      "Ja existe uma sincronizacao deste formulario em andamento.",
      409,
    );
  }
  if (error)
    throw new ApiError("Nao foi possivel registrar a sincronizacao.", 503);
  return data?.id ? String(data.id) : null;
}

export async function syncProjectGoogleForm(
  context: Pick<AdminContext, "supabase" | "organizationId">,
  projectId: string,
  input: z.infer<typeof googleFormSyncInputSchema>,
) {
  let googleFormId: string | null = null;
  let syncRunId: string | null = null;
  try {
    await requireActiveProject(context, projectId);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Chave de servidor nao configurada.", 503);

    let connectionId = input.connectionId ?? null;
    let externalFormId = input.formUrl
      ? extractGoogleFormId(input.formUrl)
      : "";
    let formRow: GoogleFormRow | null = null;

    if (input.googleFormId) {
      const { data, error } = await context.supabase
        .from("google_forms")
        .select(
          "id,connection_id,external_form_id,response_cursor_at,last_response_at,response_page_token,response_page_since,response_pending_cursor_at",
        )
        .eq("id", input.googleFormId)
        .eq("project_id", projectId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle();
      if (error)
        throw new ApiError("Nao foi possivel consultar o formulario.", 503);
      if (!data) throw new ApiError("Formulario nao encontrado.", 404);
      formRow = data as GoogleFormRow;
      googleFormId = formRow.id;
      connectionId = formRow.connection_id;
      externalFormId = formRow.external_form_id;
    }

    if (!connectionId) {
      throw new ApiError("Selecione a conexao Google Forms.", 400);
    }

    const { data: connection, error: connectionError } = await context.supabase
      .from("integration_connections")
      .select("id,provider,status")
      .eq("id", connectionId)
      .eq("organization_id", context.organizationId)
      .eq("provider", "google_forms")
      .is("revoked_at", null)
      .maybeSingle();
    if (connectionError)
      throw new ApiError("Nao foi possivel consultar a conexao.", 503);
    if (!connection)
      throw new ApiError("Conexao Google Forms nao encontrada.", 404);

    const rawSecret = await readConnectionSecret(connectionId);
    syncRunId = await createSyncRun({
      organizationId: context.organizationId,
      projectId,
      connectionId,
      googleFormId,
    });
    const syncResult = await withGoogleAccessToken(
      {
        raw: rawSecret,
        save: (nextRaw) => storeConnectionSecret(connectionId, nextRaw),
      },
      async (accessToken) => {
        const form = await fetchGoogleForm(externalFormId, accessToken);
        if (!googleFormId) {
          const { data, error } = await context.supabase.rpc(
            "attach_google_form",
            {
              p_organization_id: context.organizationId,
              p_project_id: projectId,
              p_connection_id: connectionId,
              p_external_form_id: form.formId,
              p_title: form.title,
              p_responder_uri: form.responderUri,
              p_revision_id: form.revisionId,
              p_schema_hash: form.schemaHash,
              p_field_mapping: {},
            },
          );
          if (error) throw error;
          googleFormId = String(data);
          if (syncRunId) {
            await admin
              .from("sync_runs")
              .update({ google_form_id: googleFormId })
              .eq("id", syncRunId);
          }
        }

        const { data: version, error: schemaError } = await admin.rpc(
          "sync_google_form_schema",
          {
            p_google_form_id: googleFormId,
            p_title: form.title,
            p_responder_uri: form.responderUri,
            p_revision_id: form.revisionId,
            p_schema_hash: form.schemaHash,
            p_questions: form.questions,
          },
        );
        if (schemaError) throw schemaError;

        const oldCursor =
          formRow?.response_cursor_at ?? formRow?.last_response_at ?? null;
        const since = formRow?.response_page_token
          ? formRow.response_page_since
          : input.fullSync
            ? null
            : oldCursor
              ? new Date(Date.parse(oldCursor) - 300_000).toISOString()
              : null;
        const batch = await fetchGoogleFormResponsePage(
          form.formId,
          accessToken,
          form.questions,
          since,
          formRow?.response_page_token,
        );
        const responses = batch.responses;

        let processed = 0;
        for (const response of responses) {
          const { error } = await admin.rpc("ingest_google_form_response", {
            p_google_form_id: googleFormId,
            p_response: response,
          });
          if (error) throw error;
          processed += 1;
        }

        return {
          form,
          schemaVersion: Number(version ?? 0),
          processed,
          cursor: latestSubmittedAt([
            ...responses,
            ...(formRow?.response_pending_cursor_at
              ? [{ submittedAt: formRow.response_pending_cursor_at }]
              : []),
          ]),
          nextPageToken: batch.nextPageToken,
          since,
        };
      },
    );

    if (!googleFormId)
      throw new ApiError("Formulario Google nao foi sincronizado.", 500);
    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("google_forms")
      .update({
        last_synced_at: now,
        response_cursor_at: syncResult.nextPageToken
          ? (formRow?.response_cursor_at ?? null)
          : (syncResult.cursor ?? formRow?.response_cursor_at ?? null),
        response_page_token: syncResult.nextPageToken,
        response_page_since: syncResult.nextPageToken ? syncResult.since : null,
        response_pending_cursor_at: syncResult.nextPageToken
          ? syncResult.cursor
          : null,
        linked_sheet_id: syncResult.form.linkedSheetId,
        last_error: null,
      })
      .eq("id", googleFormId)
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId);
    if (updateError) throw updateError;

    if (syncRunId) {
      await admin
        .from("sync_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          records_processed: syncResult.processed,
          error_message: null,
        })
        .eq("id", syncRunId);
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      googleFormId,
      title: syncResult.form.title,
      schemaVersion: syncResult.schemaVersion,
      processed: syncResult.processed,
      hasMore: Boolean(syncResult.nextPageToken),
    };
  } catch (error) {
    if (googleFormId) {
      const admin = createSupabaseAdminClient();
      await admin
        ?.from("google_forms")
        .update({
          last_error:
            error instanceof Error ? error.message : "Falha na sincronizacao.",
        })
        .eq("id", googleFormId);
    }
    if (syncRunId) {
      const admin = createSupabaseAdminClient();
      await admin
        ?.from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message:
            error instanceof Error ? error.message : "Falha na sincronizacao.",
        })
        .eq("id", syncRunId);
    }
    throw error;
  }
}

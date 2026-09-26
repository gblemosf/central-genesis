import { z } from "zod";
import {
  ApiError,
  apiErrorResponse,
  requireActiveProject,
  requireAdmin,
} from "@/lib/api-auth";
import { readAllRows } from "@/lib/project-operations-data";
import { record, text } from "@/lib/sales-attribution";
import type { FormTableData } from "@/lib/form-table";
import { validAnalysisPeriod } from "@/lib/analysis-filters";
import { subtractCalendarDays } from "@/lib/dates";

export async function GET(
  request: Request,
  route: { params: Promise<{ projectId: string; formId: string }> },
) {
  try {
    const { projectId, formId } = await route.params;
    z.uuid().parse(projectId);
    z.uuid().parse(formId);
    const context = await requireAdmin();
    await requireActiveProject(context, projectId);
    const params = new URL(request.url).searchParams;
    const start = params.get("start"), end = params.get("end");
    if ((start !== null || end !== null) && (!start || !end || !validAnalysisPeriod(start, end))) {
      throw new ApiError("Escolha um período válido de até 366 dias.", 400);
    }
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("page") ?? 1);
    const pageSize = 100;
    const scoped = (table: string, columns: string) =>
      context.supabase
        .from(table)
        .select(columns)
        .eq("organization_id", context.organizationId)
        .eq("project_id", projectId)
        .eq("google_form_id", formId);
    const form = await context.supabase
      .from("google_forms")
      .select("id")
      .eq("id", formId)
      .eq("project_id", projectId)
      .eq("organization_id", context.organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (form.error)
      throw new ApiError("Não foi possível consultar o formulário.", 503);
    if (!form.data)
      throw new ApiError("Formulário não encontrado neste projeto.", 404);
    let responsesQuery = context.supabase
      .from("google_form_responses")
      .select("id,last_submitted_at,respondent_email,contact_id,match_status", { count: "exact" })
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId)
      .eq("google_form_id", formId);
    if (start && end) responsesQuery = responsesQuery
      .gte("last_submitted_at", `${start}T00:00:00-03:00`)
      .lt("last_submitted_at", `${subtractCalendarDays(end, -1)}T00:00:00-03:00`);
    const [questions, responses] = await Promise.all([
      readAllRows((from, to) =>
        scoped(
          "google_form_questions",
          "id,external_question_id,title,question_type,position,archived_at",
        )
          .order("position")
          .order("id")
          .range(from, to),
      ),
      responsesQuery
        .order("last_submitted_at", { ascending: false })
        .order("id")
        .range((page - 1) * pageSize, page * pageSize - 1),
    ]);
    if (responses.error)
      throw new ApiError("Não foi possível carregar as respostas.", 503);
    const ids = (responses.data ?? []).map((row) => row.id);
    const answers = ids.length
      ? await readAllRows((from, to) =>
          scoped(
            "google_form_answers",
            "google_form_response_id,google_form_question_id,value,question_title_snapshot",
          )
            .in("google_form_response_id", ids)
            .order("google_form_response_id")
            .order("google_form_question_id")
            .range(from, to),
        )
      : [];
    const byResponse = new Map<
      string,
      Record<string, { value: unknown; title: string }>
    >();
    for (const answer of answers) {
      const id = text(answer.google_form_response_id);
      const values = byResponse.get(id) ?? {};
      values[text(answer.google_form_question_id)] = {
        value: answer.value,
        title: text(answer.question_title_snapshot),
      };
      byResponse.set(id, values);
    }
    const data: FormTableData = {
      columns: questions.map((row) => ({
        id: text(row.id),
        externalId: text(row.external_question_id),
        title: text(row.title),
        type: text(row.question_type),
        position: Number(row.position),
        archived: Boolean(row.archived_at),
      })),
      rows: (responses.data ?? []).map((raw) => {
        const row = record(raw);
        return {
          id: text(row.id),
          submittedAt: text(row.last_submitted_at),
          email: text(row.respondent_email),
          contactId: text(row.contact_id) || null,
          matchStatus: text(row.match_status),
          answers: byResponse.get(text(row.id)) ?? {},
        };
      }),
      total: responses.count ?? 0,
      page,
      pageSize,
    };
    return Response.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

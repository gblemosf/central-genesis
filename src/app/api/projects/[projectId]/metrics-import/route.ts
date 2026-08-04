import { revalidatePath } from "next/cache";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  MetricsCsvError,
  parseMetricsCsv,
  type SalesMetricsImportRow,
  type TrafficMetricsImportRow,
} from "@/lib/metrics-csv";

const maxFileSize = 5 * 1024 * 1024;

function csvFile(formData: FormData, field: string) {
  const value = formData.get(field);
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > maxFileSize) {
    throw new ApiError(`${value.name}: o arquivo excede o limite de 5 MB.`, 413);
  }
  if (!value.name.toLowerCase().endsWith(".csv")) {
    throw new ApiError(`${value.name}: selecione um arquivo CSV.`, 422);
  }
  return value;
}

async function parseFile(
  file: File | null,
  kind: "traffic",
): Promise<TrafficMetricsImportRow[]>;
async function parseFile(
  file: File | null,
  kind: "sales",
): Promise<SalesMetricsImportRow[]>;
async function parseFile(file: File | null, kind: "traffic" | "sales") {
  if (!file) return [];
  try {
    const text = await file.text();
    return kind === "traffic"
      ? parseMetricsCsv(text, "traffic")
      : parseMetricsCsv(text, "sales");
  } catch (error) {
    if (error instanceof MetricsCsvError) {
      throw new ApiError(`${file.name}: ${error.message}`, 422);
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const formData = await request.formData();
    const trafficFile = csvFile(formData, "trafficFile");
    const salesFile = csvFile(formData, "salesFile");
    if (!trafficFile && !salesFile) {
      throw new ApiError("Envie ao menos uma planilha CSV.", 422);
    }

    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,settings")
      .eq("id", projectId)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (projectError) throw new ApiError("Nao foi possivel consultar o projeto.", 503);
    if (!project) throw new ApiError("Projeto nao encontrado.", 404);

    const [trafficRows, salesRows] = await Promise.all([
      parseFile(trafficFile, "traffic"),
      parseFile(salesFile, "sales"),
    ]);
    const dates = [...trafficRows, ...salesRows].map((row) => row.date).sort();
    let periodStart = dates[0];
    let periodEnd = dates.at(-1)!;
    const settings =
      project.settings !== null &&
      typeof project.settings === "object" &&
      !Array.isArray(project.settings)
        ? (project.settings as Record<string, unknown>)
        : {};
    const metrics =
      settings.metrics !== null &&
      typeof settings.metrics === "object" &&
      !Array.isArray(settings.metrics)
        ? (settings.metrics as Record<string, unknown>)
        : {};
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const currentStart =
      typeof metrics.periodStart === "string" && datePattern.test(metrics.periodStart)
        ? metrics.periodStart
        : null;
    const currentEnd =
      typeof metrics.periodEnd === "string" && datePattern.test(metrics.periodEnd)
        ? metrics.periodEnd
        : null;
    if (currentStart && currentEnd) {
      const expandedStart = currentStart < periodStart ? currentStart : periodStart;
      const expandedEnd = currentEnd > periodEnd ? currentEnd : periodEnd;
      const expandedDays =
        (Date.parse(`${expandedEnd}T00:00:00Z`) -
          Date.parse(`${expandedStart}T00:00:00Z`)) /
        86_400_000;
      if (expandedDays <= 365) {
        periodStart = expandedStart;
        periodEnd = expandedEnd;
      }
    }
    const periodDays =
      (Date.parse(`${periodEnd}T00:00:00Z`) -
        Date.parse(`${periodStart}T00:00:00Z`)) /
      86_400_000;
    if (periodDays > 365) {
      throw new ApiError("As planilhas devem cobrir no maximo 366 dias.", 422);
    }

    const { error: importError } = await context.supabase.rpc(
      "import_project_csv_metrics",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_traffic: trafficRows,
        p_sales: salesRows,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      },
    );
    if (importError) {
      throw new ApiError("Nao foi possivel importar as metricas do projeto.", 503);
    }

    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return Response.json({
      data: {
        trafficRows: trafficRows.length,
        salesRows: salesRows.length,
        periodStart,
        periodEnd,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

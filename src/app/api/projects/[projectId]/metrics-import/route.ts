import { revalidatePath } from "next/cache";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { inspectMetricsCsv } from "@/lib/metrics-csv";

const maxFileSize = 5 * 1024 * 1024;

function csvFile(formData: FormData) {
  const value = formData.get("metricsFile");
  if (!(value instanceof File) || value.size === 0) {
    throw new ApiError("Envie a planilha diaria em CSV.", 422);
  }
  if (value.size > maxFileSize) {
    throw new ApiError(`${value.name}: o arquivo excede o limite de 5 MB.`, 413);
  }
  if (!value.name.toLowerCase().endsWith(".csv")) {
    throw new ApiError(`${value.name}: selecione um arquivo CSV.`, 422);
  }
  return value;
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function storageFilename(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-180) || "metricas-diarias.csv";
}

export async function POST(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const file = csvFile(await request.formData());
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    const inspection = inspectMetricsCsv(new TextDecoder().decode(buffer));
    if (inspection.errors.length) {
      return Response.json(
        {
          error: "Existem linhas invalidas no arquivo.",
          issues: inspection.errors.map((error) => ({
            file: file.name,
            line: error.line,
            message: error.message,
          })),
        },
        { status: 422 },
      );
    }
    if (!inspection.rows.length) {
      throw new ApiError("A planilha nao possui linhas validas.", 422);
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

    const existingRequest = await context.supabase
      .from("metric_imports")
      .select("id,content_sha256,storage_path")
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId)
      .eq("content_sha256", hash)
      .maybeSingle();
    if (existingRequest.error) {
      throw new ApiError("Nao foi possivel consultar o historico de importacoes.", 503);
    }

    const dates = inspection.rows.map((row) => row.data.date).sort();
    let periodStart = dates[0];
    let periodEnd = dates.at(-1)!;
    const settings = project.settings !== null &&
        typeof project.settings === "object" &&
        !Array.isArray(project.settings)
      ? project.settings as Record<string, unknown>
      : {};
    const metrics = settings.metrics !== null &&
        typeof settings.metrics === "object" &&
        !Array.isArray(settings.metrics)
      ? settings.metrics as Record<string, unknown>
      : {};
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const currentStart = typeof metrics.periodStart === "string" &&
        datePattern.test(metrics.periodStart)
      ? metrics.periodStart
      : null;
    const currentEnd = typeof metrics.periodEnd === "string" &&
        datePattern.test(metrics.periodEnd)
      ? metrics.periodEnd
      : null;
    if (currentStart && currentEnd) {
      const expandedStart = currentStart < periodStart ? currentStart : periodStart;
      const expandedEnd = currentEnd > periodEnd ? currentEnd : periodEnd;
      const expandedDays = (
        Date.parse(`${expandedEnd}T00:00:00Z`) -
        Date.parse(`${expandedStart}T00:00:00Z`)
      ) / 86_400_000;
      if (expandedDays <= 365) {
        periodStart = expandedStart;
        periodEnd = expandedEnd;
      }
    }
    const periodDays = (
      Date.parse(`${periodEnd}T00:00:00Z`) -
      Date.parse(`${periodStart}T00:00:00Z`)
    ) / 86_400_000;
    if (periodDays > 365) {
      throw new ApiError("A planilha deve cobrir no maximo 366 dias.", 422);
    }

    const importId = crypto.randomUUID();
    const storagePath = existingRequest.data?.storage_path ??
      `${context.organizationId}/${projectId}/${importId}/${storageFilename(file.name)}`;
    let uploaded = false;
    if (!existingRequest.data) {
      const upload = await context.supabase.storage
        .from("metric-imports")
        .upload(storagePath, buffer, { contentType: "text/csv", upsert: false });
      if (upload.error) {
        throw new ApiError("Nao foi possivel preservar o arquivo original.", 503);
      }
      uploaded = true;
    }

    const payload = {
      id: importId,
      filename: file.name,
      storagePath,
      sha256: hash,
      delimiter: inspection.delimiter,
      headers: inspection.headers,
      rows: inspection.rows.map((row) => ({
        line: row.line,
        raw: row.raw,
        data: {
          date: row.data.date,
          investment: row.data.invest,
          impressions: row.data.impressions,
          clicks: row.data.clicks,
          page_views: row.data.pageviews,
          checkouts: row.data.checkouts,
          core_sales: row.data.core,
          order_bump_1_sales: row.data.ob1,
          order_bump_2_sales: row.data.ob2,
          order_bump_3_sales: row.data.ob3,
        },
      })),
    };
    const { data: importResult, error: importError } = await context.supabase.rpc(
      "import_project_daily_metrics",
      {
        p_organization_id: context.organizationId,
        p_project_id: projectId,
        p_file: payload,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      },
    );
    if (importError) {
      if (uploaded) await context.supabase.storage.from("metric-imports").remove([storagePath]);
      throw new ApiError("Nao foi possivel importar as metricas do projeto.", 503);
    }

    const result = importResult as {
      duplicate?: boolean;
      rowsWritten?: number;
    } | null;
    if (result?.duplicate && uploaded) {
      await context.supabase.storage.from("metric-imports").remove([storagePath]);
    }

    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return Response.json({
      data: {
        dailyRows: Number(result?.rowsWritten ?? 0),
        duplicate: Boolean(result?.duplicate),
        periodStart,
        periodEnd,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { z } from "zod";
import {
  ApiError,
  apiErrorResponse,
  requireActiveProject,
  requireAdmin,
} from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { historyRequestSchema } from "@/lib/hotmart-history";
type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const context = await requireAdmin();
    const { projectId } = await params;
    await requireActiveProject(context, projectId);
    const query = new URL(request.url).searchParams;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(query.get("page") || 1);
    const start = query.get("start"),
      end = query.get("end"),
      product = query.get("productId");
    const status = query.get("status");
    let rows = context.supabase
      .from("hotmart_history_records")
      .select("*", { count: "exact" })
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId);
    if (start)
      rows = rows.gte(
        "ordered_at",
        `${z.iso.date().parse(start)}T00:00:00-03:00`,
      );
    if (end)
      rows = rows.lte(
        "ordered_at",
        `${z.iso.date().parse(end)}T23:59:59.999-03:00`,
      );
    if (product) rows = rows.eq("product_id", z.uuid().parse(product));
    if (status) rows = rows.eq("purchase_status", status);
    const [products, jobs, records] = await Promise.all([
      context.supabase
        .from("product_mappings")
        .select(
          "product_id,products!inner(id,name,external_id,integration_connections!inner(provider,revoked_at))",
        )
        .eq("organization_id", context.organizationId)
        .eq("project_id", projectId)
        .is("effective_to", null)
        .eq("products.integration_connections.provider", "hotmart")
        .is("products.integration_connections.revoked_at", null),
      context.supabase
        .from("hotmart_import_jobs")
        .select(
          "id,product_id,start_at,end_at,status,processed,pages,error_message,created_at,updated_at,finished_at",
        )
        .eq("organization_id", context.organizationId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      rows
        .order("ordered_at", { ascending: false })
        .order("id")
        .range((page - 1) * 50, page * 50 - 1),
    ]);
    if (products.error || jobs.error || records.error)
      throw new ApiError("Não foi possível consultar as importações.", 503);
    return Response.json(
      {
        products: products.data.map((row) => row.products),
        jobs: jobs.data,
        records: records.data,
        total: records.count,
        page,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const context = await requireAdmin();
    const { projectId } = await params;
    await requireActiveProject(context, projectId);
    const input = historyRequestSchema.parse(await request.json());
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço indisponível.", 503);
    const result = await admin.rpc("start_hotmart_history_import", {
      p_organization_id: context.organizationId,
      p_project_id: projectId,
      p_product_id: input.productId,
      p_requested_by: context.userId,
      p_start: input.start,
      p_end: input.end,
    });
    if (result.error)
      throw new ApiError(
        result.error.code === "22023"
          ? result.error.message
          : "Não foi possível iniciar a importação.",
        422,
      );
    return Response.json({ id: result.data }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const context = await requireAdmin();
    const { projectId } = await params;
    await requireActiveProject(context, projectId);
    const { id } = z.object({ id: z.uuid() }).parse(await request.json());
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ApiError("Serviço indisponível.", 503);
    const result = await admin
      .from("hotmart_import_jobs")
      .update({
        status: "queued",
        attempts: 0,
        error_message: null,
        run_after: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .eq("project_id", projectId)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (result.error || !result.data)
      throw new ApiError(
        "Esta importação não pode ser retomada. Confira se já há outra em andamento.",
        409,
      );
    return Response.json({ id: result.data.id }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

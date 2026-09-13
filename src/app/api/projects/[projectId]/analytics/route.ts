import { z } from "zod";
import { apiErrorResponse, requireActiveProject, requireAdmin } from "@/lib/api-auth";
import { getProjectAnalytics, getProjectCatalog } from "@/lib/data";

const periodSchema = z.object({ periodStart: z.iso.date(), periodEnd: z.iso.date() }).refine(
  (period) => {
    const days = (Date.parse(period.periodEnd) - Date.parse(period.periodStart)) / 86_400_000;
    return days >= 0 && days <= 365;
  }, "Selecione um período de até 366 dias.",
);

export async function GET(request: Request, route: { params: Promise<{ projectId: string }> }) {
  try {
    const context = await requireAdmin();
    const { projectId } = await route.params;
    await requireActiveProject(context, projectId);
    const period = periodSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const catalog = await getProjectCatalog(projectId);
    const data = await getProjectAnalytics(projectId, catalog, period);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

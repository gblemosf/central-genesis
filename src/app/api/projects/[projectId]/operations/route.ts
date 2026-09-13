import { z } from "zod";
import {
  apiErrorResponse,
  requireActiveProject,
  requireAdmin,
  ApiError,
} from "@/lib/api-auth";
import { dateInTimezone, subtractCalendarDays } from "@/lib/dates";
import { loadProjectOperations } from "@/lib/project-operations-data";

export async function GET(
  request: Request,
  route: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await route.params;
    z.uuid().parse(projectId);
    const context = await requireAdmin();
    await requireActiveProject(context, projectId);
    const params = new URL(request.url).searchParams;
    const today = dateInTimezone(new Date());
    const start = z.iso
      .date()
      .parse(params.get("start") ?? subtractCalendarDays(today, 30));
    const end = z.iso.date().parse(params.get("end") ?? today);
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (days < 0 || days > 366)
      throw new ApiError("Escolha um período de até 366 dias.", 400);
    const data = await loadProjectOperations(
      context,
      projectId,
      start,
      subtractCalendarDays(end, -1),
    );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

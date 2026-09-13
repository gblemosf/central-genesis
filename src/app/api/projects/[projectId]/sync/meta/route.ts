import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import { syncProjectMeta } from "@/lib/meta-sync";
import { z } from "zod";
export const maxDuration = 180;

const syncInputSchema = z
  .object({
    days: z.number().int().min(1).max(366).optional(),
    since: z.iso.date().optional(),
    until: z.iso.date().optional(),
  })
  .superRefine((input, context) => {
    if (Boolean(input.since) !== Boolean(input.until)) {
      context.addIssue({
        code: "custom",
        path: [input.since ? "until" : "since"],
        message: "Informe o inicio e o fim do periodo.",
      });
      return;
    }
    if (input.since && input.until) {
      const days =
        (Date.parse(`${input.until}T00:00:00Z`) -
          Date.parse(`${input.since}T00:00:00Z`)) /
        86_400_000;
      if (days < 0 || days > 365) {
        context.addIssue({
          code: "custom",
          path: ["until"],
          message: "O periodo deve ter entre 1 e 366 dias.",
        });
      }
    }
  });

export async function POST(request: Request, route: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await route.params;
    const context = await requireAdmin();
    const body = syncInputSchema.parse(await request.json().catch(() => ({})));
    return Response.json(await syncProjectMeta(context, projectId, body));
  } catch (error) { return apiErrorResponse(error); }
}

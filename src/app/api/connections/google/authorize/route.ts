import { cookies } from "next/headers";
import { apiErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  createGoogleOAuthState,
  getGoogleAuthorizationUrl,
  isGoogleOAuthConfigured,
} from "@/lib/google/oauth";

const stateCookieName = "genesis_google_oauth_state";

export async function GET(request: Request) {
  if (!isGoogleOAuthConfigured()) {
    const integrationsUrl = new URL("/integrations", request.url);
    integrationsUrl.searchParams.set("googleForms", "not_configured");
    return Response.redirect(integrationsUrl);
  }

  try {
    const context = await requireAdmin();
    const state = createGoogleOAuthState(context.userId, context.organizationId);
    const cookieStore = await cookies();
    cookieStore.set(stateCookieName, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return Response.redirect(getGoogleAuthorizationUrl(request.url, state));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

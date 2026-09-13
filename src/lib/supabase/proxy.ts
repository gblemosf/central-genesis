import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  const env = getSupabasePublicEnv();
  const pathname = request.nextUrl.pathname;
  const publicPaths = ["/login", "/auth", "/api/webhooks", "/privacy", "/terms", "/data-deletion"];
  const isPublicRoute = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  // Webhooks and the scheduled Forms job authenticate themselves with dedicated tokens.
  if (isPublicRoute || pathname === "/about" || pathname === "/api/jobs/google-forms") return NextResponse.next({ request });

  const isApiRoute = pathname === "/api" || pathname.startsWith("/api/");
  const loginUrl = new URL("/login", request.url);
  if (!env.configured) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Supabase nao configurado." }, { status: 503 });
    }
    return env.demoMode
      ? NextResponse.next({ request })
      : NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    const denied = isApiRoute
      ? NextResponse.json({ error: "Sessao invalida. Entre novamente." }, { status: 401 })
      : NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) denied.headers.set(header, value);
    }
    return denied;
  }

  return response;
}

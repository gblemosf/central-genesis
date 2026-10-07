import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Fixed local destination: never forward a caller-supplied redirect or auth code.
  const destination = new URL("/auth/reset-password", url.origin);
  destination.searchParams.set("error", "invalid_link");
  const code = url.searchParams.get("code");
  if (code && !url.searchParams.has("error")) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        // PKCE also verifies the cookie created when recovery was requested.
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error && data.user && data.session) destination.search = "";
      }
    } catch {
      // Do not log one-time codes or provider errors containing credentials.
    }
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

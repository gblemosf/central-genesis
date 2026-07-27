import { AppShell } from "@/components/app-shell";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const env = getSupabasePublicEnv();
  const supabase = await createSupabaseServerClient();
  let userLabel = "Modo demonstracao";

  if (supabase) {
    const { data } = await supabase.auth.getClaims();
    userLabel =
      String(data?.claims?.email ?? data?.claims?.sub ?? "Equipe Genesis");
  }

  return (
    <AppShell userLabel={userLabel} demoMode={env.demoMode}>
      {children}
    </AppShell>
  );
}

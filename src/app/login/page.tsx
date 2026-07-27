import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return <LoginForm demoMode={getSupabasePublicEnv().demoMode} />;
}

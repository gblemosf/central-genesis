import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Redefinir senha", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  let userId: string | null = null;
  if (!params.error) {
    try {
      const supabase = await createSupabaseServerClient();
      const result = await supabase?.auth.getUser();
      if (result?.data.user && !result.error) userId = result.data.user.id;
    } catch {
      userId = null;
    }
  }
  return <ResetPasswordForm userId={userId} />;
}

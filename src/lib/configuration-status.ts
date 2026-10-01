import "server-only";
import { databaseRequirements, type DatabaseCheck } from "@/lib/configuration-catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getDatabaseChecks(): Promise<DatabaseCheck[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return databaseRequirements.map((item) => ({ ...item, ready: false, error: "Banco indisponível neste ambiente." }));
  // HEAD can succeed even for missing PostgREST tables. GET limit(0) checks
  // schema/permissions without fetching private rows or bypassing user RLS.
  const results = await Promise.all(databaseRequirements.map((item) => supabase.from(item.table).select(item.column).limit(0)));
  return databaseRequirements.map((item, index) => ({ ...item, ready: !results[index].error, error: results[index].error?.message ?? "" }));
}

export async function getSetupObservations() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { formsCount: null, latestMetaAutomaticAt: null };
  const [forms, meta] = await Promise.all([
    supabase.from("google_forms").select("id", { count: "exact" }).limit(0),
    supabase.from("sync_runs").select("finished_at").eq("job_type", "meta_auto").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1),
  ]);
  return { formsCount: forms.error ? null : forms.count, latestMetaAutomaticAt: meta.error ? null : meta.data?.[0]?.finished_at ?? null };
}

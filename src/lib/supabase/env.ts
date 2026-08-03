export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const configured = Boolean(url && key);
  const demoMode =
    !configured &&
    (process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
      process.env.NODE_ENV === "development");

  return {
    configured,
    demoMode,
    url: url ?? "",
    key: key ?? "",
  };
}

export function getSupabaseSecretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

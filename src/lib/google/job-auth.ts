import "server-only";
import { createHmac } from "node:crypto";
import { getSupabaseSecretKey } from "@/lib/supabase/env";

export function googleFormsJobSecret() {
  const configured = process.env.GOOGLE_FORMS_SYNC_SECRET?.trim();
  if (configured) return configured;
  const serverKey = getSupabaseSecretKey();
  // Domain separation creates a job-specific token without transmitting the database key.
  return serverKey
    ? createHmac("sha256", serverKey)
        .update(
          `genesis:google-forms-sync:v1:${process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""}`,
        )
        .digest("hex")
    : "";
}

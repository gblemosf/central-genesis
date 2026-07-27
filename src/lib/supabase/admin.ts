import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  getSupabasePublicEnv,
  getSupabaseSecretKey,
} from "@/lib/supabase/env";

export function createSupabaseAdminClient() {
  const env = getSupabasePublicEnv();
  const secretKey = getSupabaseSecretKey();
  if (!env.configured || !secretKey) return null;

  return createClient(env.url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

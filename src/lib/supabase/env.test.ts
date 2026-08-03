import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSupabasePublicEnv,
  getSupabaseSecretKey,
} from "@/lib/supabase/env";

afterEach(() => vi.unstubAllEnvs());

describe("getSupabasePublicEnv", () => {
  it("nunca ativa demonstracao quando o Supabase esta configurado", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    expect(getSupabasePublicEnv().demoMode).toBe(false);
  });

  it("ativa demonstracao local somente sem Supabase", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(getSupabasePublicEnv().demoMode).toBe(true);
  });

  it("exige URL e publishable key para considerar a conexao pronta", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    expect(getSupabasePublicEnv().configured).toBe(false);
  });
});

describe("getSupabaseSecretKey", () => {
  it("prioriza a secret key atual", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_current");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role");

    expect(getSupabaseSecretKey()).toBe("sb_secret_current");
  });

  it("mantem a service role legada somente como alternativa de servidor", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role");

    expect(getSupabaseSecretKey()).toBe("legacy-service-role");
  });
});

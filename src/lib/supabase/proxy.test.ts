import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getClaims, createServerClient } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { updateSession } from "@/lib/supabase/proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  createServerClient.mockReturnValue({ auth: { getClaims } });
  getClaims.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("session proxy", () => {
  it("responde JSON 401 para uma operacao com sessao expirada", async () => {
    const response = await updateSession(new NextRequest("http://localhost/api/projects", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Sessao invalida. Entre novamente." });
  });

  it("responde JSON 503 quando a API nao esta configurada", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await updateSession(new NextRequest("http://localhost/api/projects"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Supabase nao configurado." });
  });

  it("redireciona paginas protegidas para o login sem copiar a query", async () => {
    const response = await updateSession(new NextRequest("http://localhost/projects?private=value"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it.each(["/login", "/about", "/privacy", "/terms", "/data-deletion", "/api/webhooks/hotmart/test", "/api/jobs/google-forms"])(
    "mantem %s independente da disponibilidade do login", async (path) => {
      getClaims.mockRejectedValue(new Error("Auth unavailable"));
      const response = await updateSession(new NextRequest(`http://localhost${path}`));

      expect(response.status).toBe(200);
      expect(getClaims).not.toHaveBeenCalled();
    },
  );

  it.each(["/login-private", "/about-private", "/about/private"])("nao trata %s como pagina publica", async (path) => {
    const response = await updateSession(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(307);
  });

  it("keeps other job paths behind session authentication", async () => {
    const response = await updateSession(new NextRequest("http://localhost/api/jobs/google-forms-private"));
    expect(response.status).toBe(401);
  });

  it("preserva cookies removidos ao rejeitar uma sessao", async () => {
    createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll([
            { name: "expired-session", value: "", options: { maxAge: 0, path: "/" } },
          ], { "Cache-Control": "private, no-store" });
          return { data: null };
        },
      },
    }));
    const response = await updateSession(new NextRequest("http://localhost/projects"));

    expect(response.cookies.get("expired-session")?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("permite operacoes autenticadas", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-id" } } });
    const response = await updateSession(new NextRequest("http://localhost/api/projects"));
    expect(response.status).toBe(200);
  });
});

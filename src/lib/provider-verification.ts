import "server-only";

import type { Provider } from "@/lib/domain";

interface VerificationResult {
  ok: boolean;
  accountName?: string;
  error?: string;
}

export async function verifyProviderCredential(
  provider: Provider,
  credential: string,
): Promise<VerificationResult> {
  if (provider !== "meta") {
    return {
      ok: false,
      error: `Validacao automatica para ${provider} ainda nao esta disponivel.`,
    };
  }

  const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
  const response = await fetch(
    `https://graph.facebook.com/${version}/me?fields=id,name`,
    {
      headers: { Authorization: `Bearer ${credential}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) {
    return { ok: false, error: "A Meta recusou a credencial." };
  }

  const data = (await response.json()) as { name?: string; id?: string };
  return { ok: true, accountName: data.name ?? data.id ?? "Meta System User" };
}

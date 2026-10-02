import "server-only";

import { ApiError } from "@/lib/api-auth";
import type { Provider } from "@/lib/domain";

export interface ProviderCredentialFields {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  basicToken?: string;
  hottok?: string;
  accountId?: string;
  webhookToken?: string;
}

interface StoredProviderCredentials extends ProviderCredentialFields {
  version: 1;
  provider: Provider;
}

const requiredFields: Record<Provider, (keyof ProviderCredentialFields)[]> = {
  meta: ["accessToken"],
  hotmart: ["clientId", "clientSecret", "basicToken", "hottok"],
  eduzz: ["accessToken"],
  kiwify: ["clientId", "clientSecret", "accountId"],
  hubla: ["webhookToken"],
  payt: ["webhookToken"],
  assiny: ["webhookToken"],
  google_forms: [],
};

export function decodeProviderCredentials(
  provider: Provider,
  raw: string,
): ProviderCredentialFields {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredProviderCredentials>;
    if (parsed.version === 1 && parsed.provider === provider) {
      return {
        accessToken: parsed.accessToken,
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        basicToken: parsed.basicToken,
        hottok: parsed.hottok,
        accountId: parsed.accountId,
        webhookToken: parsed.webhookToken,
      };
    }
  } catch {
    // Secrets created before provider bundles were stored as one opaque value.
  }

  if (provider === "meta" || provider === "eduzz") return { accessToken: raw };
  if (provider === "hotmart") return { hottok: raw };
  if (provider === "hubla" || provider === "payt" || provider === "assiny") return { webhookToken: raw };
  return {};
}

export function serializeProviderCredentials(
  provider: Provider,
  credentials: ProviderCredentialFields,
  existingRaw?: string,
) {
  const existing = existingRaw
    ? decodeProviderCredentials(provider, existingRaw)
    : {};
  const merged = Object.fromEntries(
    Object.entries({ ...existing, ...credentials }).filter(([, value]) => value),
  ) as ProviderCredentialFields;

  const missing = requiredFields[provider].filter((field) => !merged[field]);
  if ((provider === "payt" || provider === "assiny") && merged.webhookToken && !/^[a-f0-9]{64}$/.test(merged.webhookToken)) {
    throw new ApiError(`O token de recebimento ${provider === "assiny" ? "Assiny" : "Payt"} precisa conter 64 caracteres hexadecimais.`, 422);
  }
  if (missing.length > 0) {
    throw new ApiError(
      `Preencha as credenciais obrigatorias: ${missing.join(", ")}.`,
      422,
    );
  }

  return JSON.stringify({ version: 1, provider, ...merged });
}

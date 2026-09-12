import "server-only";

import { ApiError } from "@/lib/api-auth";

interface MetaPage<T> {
  data?: T[];
  paging?: { next?: string };
}

interface MetaErrorPayload {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

function validateMetaUrl(url: URL) {
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw new ApiError("A Meta retornou uma URL invalida.", 502);
  }
}

async function metaApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as MetaErrorPayload | null;
  const code = payload?.error?.code;
  const subcode = payload?.error?.error_subcode;
  const details = [code ? `codigo ${code}` : null, subcode ? `subcodigo ${subcode}` : null]
    .filter(Boolean)
    .join(", ");
  const message = payload?.error?.message?.trim();
  return new ApiError(
    `${fallback}${message ? ` ${message}` : ""}${details ? ` (${details})` : ""}`,
    502,
  );
}

export async function fetchMetaCollection<T>(
  initialUrl: URL,
  credential: string,
  errorMessage: string,
) {
  const rows: T[] = [];
  let nextUrl: URL | null = initialUrl;
  let pages = 0;

  while (nextUrl) {
    validateMetaUrl(nextUrl);
    if (++pages > 100) {
      throw new ApiError("A paginacao da Meta excedeu o limite seguro.", 502);
    }

    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${credential}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await metaApiError(response, errorMessage);

    const payload = (await response.json()) as MetaPage<T>;
    if (!Array.isArray(payload?.data)) {
      throw new ApiError("A Meta retornou uma resposta sem uma lista de dados valida.", 502);
    }
    rows.push(...payload.data);
    nextUrl = payload.paging?.next ? new URL(payload.paging.next) : null;
  }

  return rows;
}

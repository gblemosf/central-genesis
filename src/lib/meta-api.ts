import "server-only";

import { ApiError } from "@/lib/api-auth";

interface MetaPage<T> {
  data?: T[];
  paging?: { next?: string };
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
    if (nextUrl.protocol !== "https:" || nextUrl.hostname !== "graph.facebook.com") {
      throw new ApiError("A Meta retornou uma URL de paginacao invalida.", 502);
    }
    if (++pages > 100) {
      throw new ApiError("A paginacao da Meta excedeu o limite seguro.", 502);
    }

    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${credential}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new ApiError(errorMessage, 502);

    const payload = (await response.json()) as MetaPage<T>;
    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ? new URL(payload.paging.next) : null;
  }

  return rows;
}

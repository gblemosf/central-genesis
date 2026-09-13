import "server-only";

import type { Provider } from "@/lib/domain";
import { verifyGoogleRefreshToken } from "@/lib/google/oauth";
import {
  decodeProviderCredentials,
  type ProviderCredentialFields,
} from "@/lib/provider-credentials";

export interface VerificationResult {
  ok: boolean;
  accountName?: string;
  error?: string;
  mode?: "remote" | "webhook";
}

export interface ProviderProduct {
  externalId: string;
  name: string;
  price: number;
  currency: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export interface ProviderProductSync {
  products: ProviderProduct[];
  complete: boolean;
}

async function jsonRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as unknown;
  return { response, data };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export async function hotmartAccessToken(credentials: ProviderCredentialFields) {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.basicToken) {
    throw new Error("Credenciais OAuth da Hotmart incompletas.");
  }
  const query = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  // Hotmart documents these OAuth credentials in the query string; never log this URL.
  const { response, data } = await jsonRequest(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials.basicToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  const accessToken = stringValue(objectValue(data).access_token);
  if (!response.ok || !accessToken) throw new Error("A Hotmart recusou as credenciais OAuth.");
  return accessToken;
}

async function kiwifyAccessToken(credentials: ProviderCredentialFields) {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("Credenciais da Kiwify incompletas.");
  }
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  const { response, data } = await jsonRequest(
    "https://public-api.kiwify.com/v1/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const accessToken = stringValue(objectValue(data).access_token);
  if (!response.ok || !accessToken) throw new Error("A Kiwify recusou as credenciais.");
  return accessToken;
}

export async function verifyProviderCredential(
  provider: Provider,
  rawCredential: string,
): Promise<VerificationResult> {
  const credentials = decodeProviderCredentials(provider, rawCredential);

  try {
    if (provider === "meta") {
      if (!credentials.accessToken) throw new Error("Token Meta ausente.");
      const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
      const { response, data } = await jsonRequest(
        `https://graph.facebook.com/${version}/me?fields=id,name`,
        { headers: { Authorization: `Bearer ${credentials.accessToken}` } },
      );
      const account = objectValue(data);
      if (!response.ok) throw new Error("A Meta recusou a credencial.");
      return {
        ok: true,
        accountName: stringValue(account.name || account.id, "Meta System User"),
        mode: "remote",
      };
    }

    if (provider === "hotmart") {
      const accessToken = await hotmartAccessToken(credentials);
      const { response, data } = await jsonRequest(
        "https://developers.hotmart.com/user/api/v1/me",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const account = objectValue(data);
      if (!response.ok) throw new Error("A Hotmart nao autorizou o acesso a conta.");
      return {
        ok: true,
        accountName: stringValue(account.name || account.email || account.id, "Hotmart"),
        mode: "remote",
      };
    }

    if (provider === "kiwify") {
      if (!credentials.accountId) throw new Error("ID da conta Kiwify ausente.");
      const accessToken = await kiwifyAccessToken(credentials);
      const { response } = await jsonRequest(
        "https://public-api.kiwify.com/v1/products?page_size=1&page_number=1",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-kiwify-account-id": credentials.accountId,
          },
        },
      );
      if (!response.ok) throw new Error("A Kiwify nao autorizou o acesso aos produtos.");
      return { ok: true, accountName: `Conta ${credentials.accountId}`, mode: "remote" };
    }

    if (provider === "eduzz") {
      if (!credentials.accessToken) throw new Error("Token OAuth da Eduzz ausente.");
      const { response, data } = await jsonRequest("https://api.eduzz.com/accounts/v1/me", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });
      const account = objectValue(data);
      if (!response.ok) throw new Error("A Eduzz recusou o token OAuth.");
      return {
        ok: true,
        accountName: stringValue(account.name || account.email || account.id, "Eduzz"),
        mode: "remote",
      };
    }

    if (provider === "google_forms") {
      await verifyGoogleRefreshToken(rawCredential);
      return {
        ok: true,
        accountName: "Google Forms autorizado",
        mode: "remote",
      };
    }

    if (!credentials.webhookToken) throw new Error("Token de webhook da Hubla ausente.");
    return {
      ok: true,
      accountName: "Webhook Hubla configurado",
      mode: "webhook",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "A plataforma recusou a credencial.",
    };
  }
}

export async function listProviderProducts(
  provider: Provider,
  rawCredential: string,
): Promise<ProviderProductSync> {
  const credentials = decodeProviderCredentials(provider, rawCredential);
  if (provider === "hotmart") return listHotmartProducts(credentials);
  if (provider === "kiwify") return listKiwifyProducts(credentials);
  if (provider === "eduzz") return listEduzzProducts(credentials);
  throw new Error("Esta plataforma nao oferece catalogo publico para sincronizacao.");
}

async function listHotmartProducts(credentials: ProviderCredentialFields) {
  const accessToken = await hotmartAccessToken(credentials);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const products: Record<string, unknown>[] = [];
  let pageToken = "";
  let complete = false;

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ max_results: "50" });
    if (pageToken) query.set("page_token", pageToken);
    const { response, data } = await jsonRequest(
      `https://developers.hotmart.com/products/api/v1/products?${query}`,
      { headers },
    );
    if (!response.ok) throw new Error("Nao foi possivel listar os produtos Hotmart.");
    const payload = objectValue(data);
    const items = Array.isArray(payload.items) ? payload.items.map(objectValue) : [];
    products.push(...items);
    pageToken = stringValue(objectValue(payload.page_info).next_page_token);
    if (!pageToken || items.length === 0) {
      complete = true;
      break;
    }
  }

  const result: ProviderProduct[] = [];
  for (const product of products) {
    const ucode = stringValue(product.ucode);
    const externalId = stringValue(product.id || ucode);
    if (!externalId) continue;
    let price = 0;
    let currency = "BRL";
    if (ucode) {
      const { response, data } = await jsonRequest(
        `https://developers.hotmart.com/products/api/v1/products/${encodeURIComponent(ucode)}/offers?max_results=50`,
        { headers },
      );
      if (response.ok) {
        const offers = Array.isArray(objectValue(data).items)
          ? (objectValue(data).items as unknown[]).map(objectValue)
          : [];
        const offer = offers.find((item) => item.is_main_offer === true) ?? offers[0];
        const offerPrice = objectValue(offer?.price);
        price = numberValue(offerPrice.value);
        currency = stringValue(offerPrice.currency_code, "BRL").toUpperCase();
      }
    }
    result.push({
      externalId,
      name: stringValue(product.name, externalId),
      price,
      currency,
      active: product.status === "ACTIVE",
      metadata: { providerStatus: product.status, ucode, format: product.format },
    });
  }
  return { products: result, complete };
}

async function listKiwifyProducts(credentials: ProviderCredentialFields) {
  if (!credentials.accountId) throw new Error("ID da conta Kiwify ausente.");
  const accessToken = await kiwifyAccessToken(credentials);
  const products: ProviderProduct[] = [];
  let complete = false;
  for (let page = 1; page <= 20; page += 1) {
    const { response, data } = await jsonRequest(
      `https://public-api.kiwify.com/v1/products?page_size=100&page_number=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-kiwify-account-id": credentials.accountId,
        },
      },
    );
    if (!response.ok) throw new Error("Nao foi possivel listar os produtos Kiwify.");
    const payload = objectValue(data);
    const items = Array.isArray(payload.data) ? payload.data.map(objectValue) : [];
    for (const item of items) {
      const externalId = stringValue(item.id);
      if (!externalId) continue;
      products.push({
        externalId,
        name: stringValue(item.name, externalId),
        price: numberValue(item.price),
        currency: stringValue(item.currency, "BRL").toUpperCase(),
        active: item.status === "active",
        metadata: { providerStatus: item.status, type: item.type, paymentType: item.payment_type },
      });
    }
    const pagination = objectValue(payload.pagination);
    const total = numberValue(pagination.count);
    if (items.length === 0 || (total > 0 && products.length >= total) || items.length < 100) {
      complete = true;
      break;
    }
  }
  return { products, complete };
}

async function listEduzzProducts(credentials: ProviderCredentialFields) {
  if (!credentials.accessToken) throw new Error("Token OAuth da Eduzz ausente.");
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
  };
  const products: ProviderProduct[] = [];
  let complete = false;
  for (let page = 1; page <= 50; page += 1) {
    const { response, data } = await jsonRequest(
      `https://api.eduzz.com/myeduzz/v1/products?page=${page}&itemsPerPage=100`,
      { headers },
    );
    if (!response.ok) throw new Error("Nao foi possivel listar os produtos Eduzz.");
    const payload = objectValue(data);
    const items = Array.isArray(payload.items) ? payload.items.map(objectValue) : [];
    for (const item of items) {
      const externalId = stringValue(item.id);
      if (!externalId) continue;
      const payment = objectValue(item.payment);
      const price = objectValue(payment.price);
      products.push({
        externalId,
        name: stringValue(item.name, externalId),
        price: numberValue(price.value),
        currency: stringValue(price.currency, "BRL").toUpperCase(),
        active: item.status === "active",
        metadata: { providerStatus: item.status, type: item.type, paymentType: payment.type },
      });
    }
    const pages = numberValue(payload.pages, page);
    if (items.length === 0 || page >= pages) {
      complete = true;
      break;
    }
  }
  return { products, complete };
}

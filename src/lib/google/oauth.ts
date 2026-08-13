import "server-only";

import crypto from "node:crypto";
import { ApiError } from "@/lib/api-auth";

export const GOOGLE_FORMS_SCOPES = [
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
] as const;

export interface GoogleOAuthTokens {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleCredentialBundle {
  version: 1;
  provider: "google_forms";
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
}

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

function googleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
}

export function isGoogleOAuthConfigured() {
  return Boolean(
    googleClientId() &&
      googleClientSecret() &&
      process.env.GOOGLE_REDIRECT_URI?.trim(),
  );
}

export function getGoogleRedirectUri(requestUrl?: string) {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (!requestUrl) throw new ApiError("GOOGLE_REDIRECT_URI nao configurado.", 503);

  const url = new URL(requestUrl);
  return `${url.origin}/api/connections/google/callback`;
}

export function assertGoogleOAuthConfigured(requestUrl?: string) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  const redirectUri = getGoogleRedirectUri(requestUrl);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ApiError("Credenciais OAuth do Google nao configuradas.", 503);
  }
  return { clientId, clientSecret, redirectUri };
}

export function createGoogleOAuthState(userId: string, organizationId: string) {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const issuedAt = Date.now();
  return Buffer.from(
    JSON.stringify({ nonce, userId, organizationId, issuedAt }),
    "utf8",
  ).toString("base64url");
}

export function parseGoogleOAuthState(rawState: string) {
  try {
    const parsed = JSON.parse(
      Buffer.from(rawState, "base64url").toString("utf8"),
    ) as Partial<{
      nonce: string;
      userId: string;
      organizationId: string;
      issuedAt: number;
    }>;
    if (
      !parsed.nonce ||
      !parsed.userId ||
      !parsed.organizationId ||
      typeof parsed.issuedAt !== "number"
    ) {
      throw new Error("invalid state");
    }
    return parsed as {
      nonce: string;
      userId: string;
      organizationId: string;
      issuedAt: number;
    };
  } catch {
    throw new ApiError("Estado OAuth invalido.", 400);
  }
}

export function getGoogleAuthorizationUrl(requestUrl: string, state: string) {
  const { clientId, redirectUri } = assertGoogleOAuthConfigured(requestUrl);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_FORMS_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as
    | (GoogleOAuthTokens & { error?: string; error_description?: string })
    | null;

  if (!response.ok || !data?.access_token) {
    throw new ApiError(
      data?.error_description ?? data?.error ?? "Google recusou a autorizacao.",
      422,
    );
  }
  return data;
}

export async function exchangeGoogleAuthorizationCode(
  requestUrl: string,
  code: string,
) {
  const { clientId, clientSecret, redirectUri } = assertGoogleOAuthConfigured(requestUrl);
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new ApiError("Credenciais OAuth do Google nao configuradas.", 503);
  }
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  );
}

export async function verifyGoogleRefreshToken(rawCredential: string) {
  const credential = decodeGoogleCredential(rawCredential);
  const refreshed = await refreshGoogleAccessToken(credential.refreshToken);
  return refreshed.scope ?? credential.scope ?? "";
}

export function serializeGoogleCredential(
  tokens: GoogleOAuthTokens,
  existingRefreshToken?: string,
): string {
  const refreshToken = tokens.refresh_token ?? existingRefreshToken;
  if (!refreshToken) {
    throw new ApiError(
      "O Google nao retornou refresh token. Revogue o acesso e autorize novamente.",
      422,
    );
  }
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : undefined;

  return JSON.stringify({
    version: 1,
    provider: "google_forms",
    refreshToken,
    accessToken: tokens.access_token,
    expiresAt,
    scope: tokens.scope,
    tokenType: tokens.token_type,
  } satisfies GoogleCredentialBundle);
}

export function decodeGoogleCredential(raw: string): GoogleCredentialBundle {
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleCredentialBundle>;
    if (parsed.version === 1 && parsed.provider === "google_forms" && parsed.refreshToken) {
      return parsed as GoogleCredentialBundle;
    }
  } catch {
    // fall through
  }
  throw new ApiError("Credencial Google Forms invalida.", 422);
}

export function getRefreshTokenFromGoogleCredential(raw: string) {
  try {
    return decodeGoogleCredential(raw).refreshToken;
  } catch {
    return undefined;
  }
}

import { isCognitoConfigured, runtimeConfig } from './runtime-config';

const VERIFIER_KEY = 'smart-report-pkce-verifier';
const ID_TOKEN_KEY = 'smart-report-id-token';
const REFRESH_TOKEN_KEY = 'smart-report-refresh-token';
const TOKEN_EXPIRY_SKEW_SECONDS = 60;
export const AUTH_SESSION_CLEARED_EVENT = 'smart-report-auth-session-cleared';

let refreshPromise: Promise<string | null> | null = null;

export interface DisplayIdentity {
  email: string;
}

interface IdTokenClaims {
  email?: string;
  exp?: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function decodeClaims(token: string): IdTokenClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as IdTokenClaims;
  } catch {
    return null;
  }
}

function tokenIsUsable(token: string): boolean {
  const claims = decodeClaims(token);
  return typeof claims?.exp === 'number'
    && claims.exp > Math.floor(Date.now() / 1_000) + TOKEN_EXPIRY_SKEW_SECONDS;
}

export function clearAuthSession(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));
}

export async function beginSignIn(): Promise<void> {
  if (!isCognitoConfigured()) {
    throw new Error('Cognito is not configured in this environment.');
  }
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await challengeFor(verifier);
  const query = new URLSearchParams({
    client_id: runtimeConfig.userPoolClientId!,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: runtimeConfig.redirectUri!,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(`https://${runtimeConfig.cognitoDomain}/oauth2/authorize?${query}`);
}

export async function completeSignIn(): Promise<DisplayIdentity | null> {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code || !isCognitoConfigured()) {
    const existing = await getIdToken();
    return existing ? decodeIdentity(existing) : null;
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error('The sign-in verifier is missing. Please start sign-in again.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: runtimeConfig.userPoolClientId!,
    code,
    redirect_uri: runtimeConfig.redirectUri!,
    code_verifier: verifier,
  });
  const response = await fetch(`https://${runtimeConfig.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error('Cognito sign-in could not be completed.');
  }
  const tokens = (await response.json()) as { id_token?: string; refresh_token?: string };
  if (!tokens.id_token) {
    throw new Error('Cognito did not return an identity token.');
  }
  sessionStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  if (tokens.refresh_token) sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
  return decodeIdentity(tokens.id_token);
}

export function signOut(): void {
  clearAuthSession();
  if (isCognitoConfigured()) {
    const query = new URLSearchParams({
      client_id: runtimeConfig.userPoolClientId!,
      logout_uri: runtimeConfig.redirectUri!,
    });
    window.location.assign(`https://${runtimeConfig.cognitoDomain}/logout?${query}`);
    return;
  }
  window.location.reload();
}

export async function getIdToken(): Promise<string | null> {
  const token = sessionStorage.getItem(ID_TOKEN_KEY);
  if (token && tokenIsUsable(token)) return token;
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (!token && !refreshToken) return null;
  if (!refreshToken || !isCognitoConfigured()) {
    clearAuthSession();
    return null;
  }
  if (!refreshPromise) {
    refreshPromise = refreshIdToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function refreshIdToken(): Promise<string | null> {
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken || !isCognitoConfigured()) {
    clearAuthSession();
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: runtimeConfig.userPoolClientId!,
      refresh_token: refreshToken,
    });
    const response = await fetch(`https://${runtimeConfig.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      clearAuthSession();
      return null;
    }
    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token || !tokenIsUsable(tokens.id_token)) {
      clearAuthSession();
      return null;
    }
    sessionStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
    return tokens.id_token;
  } catch {
    clearAuthSession();
    return null;
  }
}

function decodeIdentity(token: string): DisplayIdentity {
  const claims = decodeClaims(token);
  return { email: claims?.email ?? 'Cognito user' };
}

import { isCognitoConfigured, runtimeConfig } from './runtime-config';

const VERIFIER_KEY = 'smart-report-pkce-verifier';
const ID_TOKEN_KEY = 'smart-report-id-token';

export interface DisplayIdentity {
  email: string;
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
  const existing = sessionStorage.getItem(ID_TOKEN_KEY);
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code || !isCognitoConfigured()) {
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
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error('Cognito did not return an identity token.');
  }
  sessionStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  sessionStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
  return decodeIdentity(tokens.id_token);
}

export function signOut(): void {
  sessionStorage.removeItem(ID_TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
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

export function getIdToken(): string | null {
  return sessionStorage.getItem(ID_TOKEN_KEY);
}

function decodeIdentity(token: string): DisplayIdentity {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized)) as { email?: string };
    return { email: claims.email ?? 'Cognito user' };
  } catch {
    return { email: 'Cognito user' };
  }
}

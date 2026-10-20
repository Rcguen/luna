const AUTH_QUERY_KEYS = ['code', 'error', 'error_code', 'error_description', 'error_uri', 'type'];
const AUTH_HASH_KEYS = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description', 'error_uri'];

/** Return the app root for both local Vite and the /luna/ Pages deployment. */
export function authRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export type AuthCallbackError = { code: string; description: string } | null;

/** Read Supabase callback errors before removing them from the visible URL. */
export function readAuthCallbackError(): AuthCallbackError {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const params = [...url.searchParams, ...hash];
  const values = new Map(params);
  const code = values.get('error_code') || values.get('error') || '';
  const description = values.get('error_description') || '';
  return code || description ? { code, description } : null;
}

/** Remove one-time Supabase callback parameters while preserving /luna/. */
export function cleanAuthCallbackUrl(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of AUTH_QUERY_KEYS) if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (AUTH_HASH_KEYS.some((key) => hash.has(key))) { url.hash = ''; changed = true; }
  if (changed) window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function formatAuthError(error: AuthCallbackError | { message?: string; code?: string } | null): { message: string; expired: boolean } {
  if (!error) return { message: '', expired: false };
  const code = ('code' in error ? error.code : '') || '';
  const raw = ('description' in error ? error.description : error.message) || '';
  const expired = code === 'otp_expired' || /expired|invalid.*link|already.*used/i.test(raw);
  if (expired) return { message: 'That email link is invalid, expired, or already used. Request a new confirmation email and try again.', expired: true };
  return { message: raw || 'Authentication could not be completed. Please try again.', expired: false };
}

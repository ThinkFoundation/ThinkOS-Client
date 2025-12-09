import { API_BASE_URL } from "../constants";

// Token storage - initialized when backend is ready
let appToken: string | null = null;

/**
 * Initialize the API token from Electron.
 * Called when backend-ready event fires.
 */
export function initializeApiToken(token: string) {
  appToken = token;
}

/**
 * Get the current app token.
 * Used by SSE connections that need direct access to the token.
 */
export function getAppToken(): string | null {
  // Try to get from Electron API if not already set
  if (!appToken && window.electronAPI?.getAppToken) {
    appToken = window.electronAPI.getAppToken();
  }
  return appToken;
}

/**
 * Wrapper around fetch that automatically includes the X-App-Token header.
 * Use this instead of fetch() for all backend API calls.
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);

  const token = getAppToken();
  if (token) {
    headers.set("X-App-Token", token);
  }

  return fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
}

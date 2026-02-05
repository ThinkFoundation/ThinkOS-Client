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

// ============================================================================
// Memory Links API
// ============================================================================

export interface MemoryLink {
  id: number;
  memory_id: number;
  title: string | null;
  type: string;
  link_type: "manual" | "auto";
  relevance_score: number | null;
  created_at: string;
}

export interface CreateLinkRequest {
  target_memory_id: number;
  link_type?: "manual" | "auto";
  relevance_score?: number;
}

/**
 * Create a bidirectional link between two memories.
 */
export async function createLink(
  memoryId: number,
  targetId: number,
  linkType: "manual" | "auto" = "manual",
  relevanceScore?: number
): Promise<MemoryLink> {
  const response = await apiFetch(`/api/memories/${memoryId}/links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target_memory_id: targetId,
      link_type: linkType,
      relevance_score: relevanceScore,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to create link" }));
    throw new Error(error.detail || "Failed to create link");
  }

  return response.json();
}

/**
 * Delete a bidirectional link between two memories.
 */
export async function deleteLink(memoryId: number, targetId: number): Promise<void> {
  const response = await apiFetch(`/api/memories/${memoryId}/links/${targetId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to delete link" }));
    throw new Error(error.detail || "Failed to delete link");
  }
}

/**
 * Get all links for a memory.
 */
export async function getMemoryLinks(memoryId: number): Promise<MemoryLink[]> {
  const response = await apiFetch(`/api/memories/${memoryId}/links`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to fetch links" }));
    throw new Error(error.detail || "Failed to fetch links");
  }

  return response.json();
}

// ============================================================================
// Memory Link Suggestions API
// ============================================================================

export interface MemorySuggestion {
  memory_id: number;
  title: string | null;
  summary: string | null;
  type: string;
  relevance: number; // 0.0-1.0
}

/**
 * Get AI-suggested memories to link based on semantic similarity.
 */
export async function getMemorySuggestions(
  memoryId: number,
  limit: number = 5,
  minRelevance: number = 0.6
): Promise<MemorySuggestion[]> {
  const response = await apiFetch(
    `/api/memories/${memoryId}/suggestions?limit=${limit}&min_relevance=${minRelevance}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch suggestions");
  }

  const data = await response.json();
  return data.suggestions;
}

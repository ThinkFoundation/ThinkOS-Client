import { API_BASE_URL } from "../constants";

/**
 * Custom error class that includes HTTP status code.
 * Allows callers to handle specific HTTP errors (e.g., 409 Conflict).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
    throw new ApiError(error.detail || "Failed to create link", response.status);
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

// ============================================================================
// Graph Visualization API
// ============================================================================

export interface GraphNode {
  id: number;
  title: string;
  type: "web" | "note" | "voice_memo" | "audio" | "video" | "document";
  summary: string | null;
  created_at: string;
  connection_count: number;
}

export interface GraphLink {
  source: number;
  target: number;
  link_type: "manual" | "auto";
  relevance_score: number | null;
  created_at: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  total_nodes: number;
  total_links: number;
}

export interface GraphFilters {
  type?: string;
  date_range?: string;
  include_isolated?: boolean;
  limit?: number;
}

/**
 * Fetch graph data for visualization.
 */
export async function getGraphData(filters: GraphFilters = {}): Promise<GraphData> {
  const params = new URLSearchParams();

  if (filters.type && filters.type !== "all") {
    params.append("type", filters.type);
  }
  if (filters.date_range && filters.date_range !== "all") {
    params.append("date_range", filters.date_range);
  }
  if (filters.include_isolated !== undefined) {
    params.append("include_isolated", String(filters.include_isolated));
  }
  if (filters.limit) {
    params.append("limit", String(filters.limit));
  }

  const response = await apiFetch(`/api/graph/data?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch graph data");
  }

  return response.json();
}

// ============================================================================
// Graph Analytics API
// ============================================================================

export interface CentralityMetrics {
  degree: Record<number, number>;
  betweenness: Record<number, number>;
  closeness: Record<number, number>;
  eigenvector: Record<number, number>;
}

export interface TopNode {
  node_id: number;
  score: number;
  title: string;
  type: string;
}

export interface Community {
  communities: number[][];
  modularity: number;
  num_communities: number;
  community_labels?: string[];
}

export interface GraphStatistics {
  num_nodes: number;
  num_edges: number;
  num_components: number;
  density: number;
  average_degree: number;
  diameter: number | null;
  clustering_coefficient: number;
  type_distribution: Record<string, number>;
  link_type_distribution: Record<string, number>;
}

export interface PathResult {
  path: number[];
  length: number;
  exists: boolean;
  node_titles: string[];
}

export type CentralityMetric = "degree" | "betweenness" | "closeness" | "eigenvector";

/**
 * Build query parameters for analytics endpoints.
 */
function buildAnalyticsParams(filters: GraphFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.type && filters.type !== "all") {
    params.append("memory_type", filters.type);
  }
  if (filters.date_range && filters.date_range !== "all") {
    params.append("date_range", filters.date_range);
  }
  if (filters.include_isolated !== undefined) {
    params.append("include_isolated", String(filters.include_isolated));
  }

  return params;
}

/**
 * Get all centrality metrics for all nodes.
 */
export async function getCentralityMetrics(filters: GraphFilters = {}): Promise<CentralityMetrics> {
  const params = buildAnalyticsParams(filters);
  const response = await apiFetch(`/api/analytics/centrality?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch centrality metrics");
  }

  return response.json();
}

/**
 * Get top N nodes ranked by centrality metric.
 */
export async function getTopNodes(
  metric: CentralityMetric,
  limit: number = 10,
  filters: GraphFilters = {}
): Promise<TopNode[]> {
  const params = buildAnalyticsParams(filters);
  params.append("metric", metric);
  params.append("limit", String(limit));

  const response = await apiFetch(`/api/analytics/top-nodes?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch top nodes");
  }

  return response.json();
}

/**
 * Detect communities in the graph.
 */
export async function getCommunities(filters: GraphFilters = {}): Promise<Community> {
  const params = buildAnalyticsParams(filters);
  const response = await apiFetch(`/api/analytics/communities?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch communities");
  }

  return response.json();
}

/**
 * Get graph-level statistics.
 */
export async function getGraphStatistics(filters: GraphFilters = {}): Promise<GraphStatistics> {
  const params = buildAnalyticsParams(filters);
  const response = await apiFetch(`/api/analytics/statistics?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch graph statistics");
  }

  return response.json();
}

/**
 * Find shortest path(s) between two nodes.
 */
export async function findPath(
  source: number,
  target: number,
  allPaths: boolean = false,
  filters: GraphFilters = {}
): Promise<PathResult | PathResult[]> {
  const params = buildAnalyticsParams(filters);
  params.append("source", String(source));
  params.append("target", String(target));
  params.append("all_paths", String(allPaths));

  const response = await apiFetch(`/api/analytics/path?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to find path");
  }

  return response.json();
}

// ============================================================================
// Insights API (Phase 5: Intelligent Knowledge Discovery)
// ============================================================================

export interface LinkRecommendation {
  source_id: number;
  target_id: number;
  source_title: string;
  target_title: string;
  confidence: number; // 0.0-1.0
  semantic_score: number;
  structural_score: number;
  reason: string;
  impact: string;
}

export interface HealthMetrics {
  connectivity: number; // 0-100
  balance: number; // 0-100
  coverage: number; // 0-100
}

export interface GrowthMetrics {
  links_last_week: number;
  links_last_month: number;
  trend: "increasing" | "stable" | "decreasing";
}

export interface HealthData {
  health_score: number; // 0-100
  metrics: HealthMetrics;
  growth: GrowthMetrics;
  issues: string[];
  recommendations: string[];
}


/**
 * Get intelligent link recommendations using hybrid scoring.
 */
export async function getLinkRecommendations(
  limit: number = 20,
  minConfidence: number = 0.6,
  filters: GraphFilters = {}
): Promise<LinkRecommendation[]> {
  const params = buildAnalyticsParams(filters);
  params.append("limit", String(limit));
  params.append("min_confidence", String(minConfidence));

  const response = await apiFetch(`/api/insights/recommendations?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch recommendations");
  }

  return response.json();
}

/**
 * Get comprehensive knowledge graph health metrics.
 */
export async function getKnowledgeHealth(filters: GraphFilters = {}): Promise<HealthData> {
  const params = buildAnalyticsParams(filters);
  const response = await apiFetch(`/api/insights/health?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch health data");
  }

  return response.json();
}

/**
 * Create multiple AI-recommended links in batch.
 */
export async function batchCreateLinks(
  links: Array<{ source_id: number; target_id: number; confidence: number }>
): Promise<{ created: number; failed: number; errors: string[] }> {
  const response = await apiFetch("/api/insights/auto-link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ links }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to create links" }));
    throw new Error(error.detail || "Failed to create links");
  }

  return response.json();
}

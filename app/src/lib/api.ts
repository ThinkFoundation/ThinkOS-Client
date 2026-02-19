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
    params.append("memory_type", filters.type);
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

// ============================================================================
// Skills API
// ============================================================================

export interface SkillParameter {
  id: string;
  label: string;
  description?: string;
  type: "select" | "boolean" | "string" | "number";
  options?: string[];
  default: unknown;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  logo: string | null;
  version: string;
  category: string;
  tags: string[];
  parameters: SkillParameter[];
  input: {
    type: string;
    accepts: string[] | null;
  };
  prompt?: {
    system: string;
    user_template: string;
  };
  source?: string;
  hidden?: boolean;
  author_name?: string | null;
  author_url?: string | null;
  output_format?: string;
  created_at?: string;
  updated_at?: string;
  triggers?: SkillTrigger[];
}

export interface SkillExecution {
  id: number;
  skill_id: string;
  skill_name: string;
  skill_icon: string;
  skill_logo: string | null;
  memory_id: number;
  trigger_type: string;
  parameters: Record<string, unknown> | null;
  status: "running" | "completed" | "failed";
  result: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SkillExecuteRequest {
  skill_id: string;
  memory_id: number;
  parameters?: Record<string, unknown>;
}

export async function getSkills(): Promise<Skill[]> {
  const response = await apiFetch("/api/skills");
  if (!response.ok) {
    throw new Error("Failed to fetch skills");
  }
  return response.json();
}

export async function getSkillWithPrompt(skillId: string): Promise<Skill> {
  const response = await apiFetch(`/api/skills/${skillId}`);
  if (!response.ok) {
    throw new Error("Failed to fetch skill details");
  }
  return response.json();
}

export async function toggleSkillVisibility(
  skillId: string,
  hidden: boolean
): Promise<void> {
  const response = await apiFetch(`/api/skills/${skillId}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
  if (!response.ok) {
    throw new Error("Failed to update skill visibility");
  }
}

export async function getSkillExecutions(
  memoryId: number
): Promise<SkillExecution[]> {
  const response = await apiFetch(
    `/api/skills/executions?memory_id=${memoryId}`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch skill executions");
  }
  return response.json();
}

// ============================================================================
// Skills API — Phase 2 Extensions
// ============================================================================

export interface SkillListItem extends Skill {
  source: "builtin" | "user";
  hidden: boolean;
  execution_count: number;
  last_executed_at: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillCreateRequest {
  name: string;
  description: string;
  icon: string;
  logo?: string | null;
  category: string;
  tags: string[];
  input_type: string;
  input_accepts: string[] | null;
  parameters: SkillParameter[];
  prompt_system: string;
  prompt_user_template: string;
  output_format?: string;
  author_name?: string | null;
  author_url?: string | null;
}

export type SkillUpdateRequest = Partial<SkillCreateRequest>;

export interface SkillTestRequest {
  memory_id: number;
  prompt_system: string;
  prompt_user_template: string;
  parameters: SkillParameter[] | null;
  parameter_values: Record<string, unknown>;
  input_accepts: string[] | null;
  output_format?: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  parsed?: { name: string; id: string } | null;
}

export interface SkillImportRequest {
  definition: string;
  conflict_resolution: "replace" | "copy";
}

export interface ExecutionHistoryItem extends SkillExecution {
  memory_title: string;
  memory_type: string;
  duration_seconds: number | null;
}

export interface ExecutionHistoryResponse {
  executions: ExecutionHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SkillsListFilters {
  include_hidden?: boolean;
  source?: "builtin" | "user";
  category?: string;
  search?: string;
}

export interface ExecutionHistoryFilters {
  skill_id?: string;
  memory_id?: number;
  status?: "completed" | "failed";
  search?: string;
  limit?: number;
  offset?: number;
}

export async function getSkillsList(
  filters: SkillsListFilters = {}
): Promise<SkillListItem[]> {
  const params = new URLSearchParams();
  if (filters.include_hidden) params.set("include_hidden", "true");
  if (filters.source) params.set("source", filters.source);
  if (filters.category) params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);
  const response = await apiFetch(`/api/skills?${params}`);
  if (!response.ok) throw new Error("Failed to fetch skills");
  return response.json();
}

export async function createSkill(
  data: SkillCreateRequest
): Promise<SkillListItem> {
  const response = await apiFetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to create skill" }));
    throw new ApiError(error.detail || "Failed to create skill", response.status);
  }
  return response.json();
}

export async function updateSkill(
  id: string,
  data: SkillUpdateRequest
): Promise<SkillListItem> {
  const response = await apiFetch(`/api/skills/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to update skill" }));
    throw new ApiError(error.detail || "Failed to update skill", response.status);
  }
  return response.json();
}

export async function deleteSkill(id: string): Promise<void> {
  const response = await apiFetch(`/api/skills/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to delete skill" }));
    throw new ApiError(error.detail || "Failed to delete skill", response.status);
  }
}

export async function validateSkillDefinition(
  definition: string
): Promise<SkillValidationResult> {
  const response = await apiFetch("/api/skills/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  if (!response.ok) throw new Error("Failed to validate skill");
  return response.json();
}

export async function importSkill(
  req: SkillImportRequest
): Promise<SkillListItem> {
  const response = await apiFetch("/api/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to import skill" }));
    throw new ApiError(error.detail?.message || error.detail || "Failed to import skill", response.status);
  }
  return response.json();
}

export async function exportSkill(id: string): Promise<Blob> {
  const response = await apiFetch(`/api/skills/${id}/export`);
  if (!response.ok) throw new Error("Failed to export skill");
  return response.blob();
}

export async function getExecutionHistory(
  filters: ExecutionHistoryFilters = {}
): Promise<ExecutionHistoryResponse> {
  const params = new URLSearchParams();
  if (filters.skill_id) params.set("skill_id", filters.skill_id);
  if (filters.memory_id) params.set("memory_id", String(filters.memory_id));
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const response = await apiFetch(`/api/skills/executions?${params}`);
  if (!response.ok) throw new Error("Failed to fetch execution history");
  return response.json();
}

// ============================================================================
// Skill Triggers API (Phase 3)
// ============================================================================

export interface TriggerRule {
  field: string;
  op: string;
  value: string | number | boolean;
}

export interface TriggerConditions {
  operator: "AND" | "OR";
  rules: TriggerRule[];
}

export interface SkillTrigger {
  id: number;
  skill_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  event_type: string;
  conditions: TriggerConditions;
  parameters: Record<string, unknown> | null;
  execution_count: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TriggerCreateRequest {
  name: string;
  description?: string;
  event_type?: string;
  conditions: TriggerConditions;
  parameters?: Record<string, unknown>;
}

export interface TriggerUpdateRequest {
  name?: string;
  description?: string;
  conditions?: TriggerConditions;
  parameters?: Record<string, unknown>;
  enabled?: boolean;
}

export interface TriggerPreviewResult {
  matching_count: number;
  matching_memories: Array<{
    id: number;
    title: string | null;
    type: string;
    tags: string[];
  }>;
  total_memories: number;
}

export async function getTriggers(skillId: string): Promise<SkillTrigger[]> {
  const response = await apiFetch(`/api/skills/${skillId}/triggers`);
  if (!response.ok) throw new Error("Failed to fetch triggers");
  return response.json();
}

export async function createTrigger(
  skillId: string,
  data: TriggerCreateRequest
): Promise<SkillTrigger> {
  const response = await apiFetch(`/api/skills/${skillId}/triggers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Failed to create trigger" }));
    throw new ApiError(
      error.detail || "Failed to create trigger",
      response.status
    );
  }
  return response.json();
}

export async function updateTrigger(
  triggerId: number,
  data: TriggerUpdateRequest
): Promise<SkillTrigger> {
  const response = await apiFetch(`/api/skills/triggers/${triggerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Failed to update trigger" }));
    throw new ApiError(
      error.detail || "Failed to update trigger",
      response.status
    );
  }
  return response.json();
}

export async function deleteTrigger(triggerId: number): Promise<void> {
  const response = await apiFetch(`/api/skills/triggers/${triggerId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete trigger");
}

export async function toggleTriggerEnabled(
  triggerId: number,
  enabled: boolean
): Promise<SkillTrigger> {
  const response = await apiFetch(`/api/skills/triggers/${triggerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error("Failed to toggle trigger");
  return response.json();
}

export async function previewTrigger(
  conditions: TriggerConditions
): Promise<TriggerPreviewResult> {
  const response = await apiFetch("/api/skills/triggers/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conditions }),
  });
  if (!response.ok) throw new Error("Failed to preview trigger");
  return response.json();
}

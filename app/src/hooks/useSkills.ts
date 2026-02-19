import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSkills,
  getSkillExecutions,
  getSkillsList,
  getSkillWithPrompt,
  getExecutionHistory,
  createSkill as apiCreateSkill,
  updateSkill as apiUpdateSkill,
  deleteSkill as apiDeleteSkill,
  importSkill as apiImportSkill,
  toggleSkillVisibility as apiToggleVisibility,
  apiFetch,
  type Skill,
  type SkillExecution,
  type SkillExecuteRequest,
  type SkillListItem,
  type SkillsListFilters,
  type SkillCreateRequest,
  type SkillUpdateRequest,
  type SkillImportRequest,
  type SkillTestRequest,
  type ExecutionHistoryItem,
  type ExecutionHistoryFilters,
  getTriggers,
  createTrigger as apiCreateTrigger,
  updateTrigger as apiUpdateTrigger,
  deleteTrigger as apiDeleteTrigger,
  toggleTriggerEnabled as apiToggleTrigger,
  previewTrigger as apiPreviewTrigger,
  type SkillTrigger,
  type TriggerCreateRequest,
  type TriggerUpdateRequest,
  type TriggerConditions,
  type TriggerPreviewResult,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// SSE stream parsing helper (shared by useSkillExecution and useSkillTest)
// ---------------------------------------------------------------------------

interface SSECallbacks {
  onMeta: (data: Record<string, unknown>) => void;
  onToken: (content: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks,
) {
  const decoder = new TextDecoder();
  let sseBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "meta") {
              callbacks.onMeta(data);
            } else if (data.type === "token") {
              callbacks.onToken(data.content);
            } else if (data.type === "done") {
              callbacks.onDone();
            } else if (data.type === "error") {
              callbacks.onError(data.message);
            }
          } catch (e) {
            console.warn("Failed to parse skill SSE data:", line.slice(6), e);
          }
        }
      }
    }

    // Process remaining buffer
    if (sseBuffer.startsWith("data: ")) {
      try {
        const data = JSON.parse(sseBuffer.slice(6));
        if (data.type === "token") {
          callbacks.onToken(data.content);
        } else if (data.type === "done") {
          callbacks.onDone();
        } else if (data.type === "error") {
          callbacks.onError(data.message);
        }
      } catch {
        // Ignore incomplete final chunk
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Phase 1 hooks (unchanged)
// ---------------------------------------------------------------------------

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSkills();
      setSkills(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return { skills, isLoading, error, refresh: loadSkills };
}

// --- useSkillExecution: State machine for executing a skill ---

type ExecutionState = "idle" | "running" | "done" | "error";

export function useSkillExecution() {
  const [state, setState] = useState<ExecutionState>("idle");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [contentSource, setContentSource] = useState<string | null>(null);
  const [contentWarning, setContentWarning] = useState<string | null>(null);
  const [skillName, setSkillName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (request: SkillExecuteRequest) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    setState("running");
    setResult("");
    setError(null);
    setExecutionId(null);
    setContentSource(null);
    setContentWarning(null);
    setSkillName(null);

    let content = "";

    try {
      const res = await apiFetch("/api/skills/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error("Failed to execute skill");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      await parseSSEStream(reader, {
        onMeta: (data) => {
          if (data.execution_id) setExecutionId(data.execution_id as number);
          if (data.skill_name) setSkillName(data.skill_name as string);
          if (data.content_source) setContentSource(data.content_source as string);
          if (data.content_warning) setContentWarning(data.content_warning as string);
        },
        onToken: (token) => {
          content += token;
          setResult(content);
        },
        onDone: () => setState("done"),
        onError: (message) => {
          setError(message);
          setState("error");
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Execution failed");
      setState("error");
    }
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setState("idle");
    setResult("");
    setError(null);
    setExecutionId(null);
    setContentSource(null);
    setContentWarning(null);
    setSkillName(null);
  }, []);

  return {
    state,
    result,
    error,
    executionId,
    contentSource,
    contentWarning,
    skillName,
    execute,
    reset,
  };
}

// --- useSkillHistory: Load execution history for a memory ---

export function useSkillHistory(memoryId: number | null) {
  const [executions, setExecutions] = useState<SkillExecution[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!memoryId) return;
    setIsLoading(true);
    try {
      const data = await getSkillExecutions(memoryId);
      setExecutions(data);
    } catch {
      // Silent failure - history may not exist yet
    } finally {
      setIsLoading(false);
    }
  }, [memoryId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return { executions, isLoading, refresh: loadHistory };
}

// ---------------------------------------------------------------------------
// Phase 2 hooks
// ---------------------------------------------------------------------------

// --- useSkillsList: Skills list with filtering ---

export function useSkillsList(filters: SkillsListFilters = {}) {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSkillsList(filters);
      setSkills(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return { skills, isLoading, error, refresh: loadSkills };
}

// --- useSkillDetail: Single skill with prompt + recent executions ---

export function useSkillDetail(skillId: string | null) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<ExecutionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!skillId) {
      setSkill(null);
      setRecentExecutions([]);
      return;
    }
    setIsLoading(true);
    try {
      const [skillData, historyData] = await Promise.all([
        getSkillWithPrompt(skillId),
        getExecutionHistory({ skill_id: skillId, limit: 10 }),
      ]);
      setSkill(skillData);
      setRecentExecutions(historyData.executions);
    } catch {
      setSkill(null);
      setRecentExecutions([]);
    } finally {
      setIsLoading(false);
    }
  }, [skillId]);

  useEffect(() => {
    load();
  }, [load]);

  return { skill, recentExecutions, isLoading, refresh: load };
}

// --- useSkillMutations: CRUD + import + toggle visibility ---

export function useSkillMutations() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (data: SkillCreateRequest): Promise<SkillListItem> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiCreateSkill(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create skill";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const update = useCallback(async (id: string, data: SkillUpdateRequest): Promise<SkillListItem> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiUpdateSkill(id, data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update skill";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiDeleteSkill(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete skill";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const importSkillFn = useCallback(async (req: SkillImportRequest): Promise<SkillListItem> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiImportSkill(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to import skill";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleVisibility = useCallback(async (id: string, hidden: boolean): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiToggleVisibility(id, hidden);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to toggle visibility";
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { create, update, remove, importSkill: importSkillFn, toggleVisibility, isLoading, error };
}

// --- useExecutionHistory: Paginated global history ---

export function useExecutionHistory(filters: ExecutionHistoryFilters) {
  const [executions, setExecutions] = useState<ExecutionHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const filtersKey = JSON.stringify(filters);
  const offsetRef = useRef(0);

  const load = useCallback(async (reset = false) => {
    setIsLoading(true);
    try {
      const currentOffset = reset ? 0 : offsetRef.current;
      const data = await getExecutionHistory({
        ...filters,
        offset: currentOffset,
      });
      if (reset) {
        setExecutions(data.executions);
      } else {
        setExecutions((prev) => [...prev, ...data.executions]);
      }
      setTotal(data.total);
      offsetRef.current = currentOffset + data.executions.length;
      setHasMore(currentOffset + data.executions.length < data.total);
    } catch {
      // Silent failure
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    offsetRef.current = 0;
    load(true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      load(false);
    }
  }, [isLoading, hasMore, load]);

  const refresh = useCallback(() => {
    offsetRef.current = 0;
    load(true);
  }, [load]);

  return { executions, total, isLoading, hasMore, loadMore, refresh };
}

// --- useSkillTest: Test execution state machine (no DB tracking) ---

export function useSkillTest() {
  const [state, setState] = useState<ExecutionState>("idle");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contentSource, setContentSource] = useState<string | null>(null);
  const [contentWarning, setContentWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (request: SkillTestRequest) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    setState("running");
    setResult("");
    setError(null);
    setContentSource(null);
    setContentWarning(null);

    let content = "";

    try {
      const res = await apiFetch("/api/skills/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error("Failed to test skill");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      await parseSSEStream(reader, {
        onMeta: (data) => {
          if (data.content_source) setContentSource(data.content_source as string);
          if (data.content_warning) setContentWarning(data.content_warning as string);
        },
        onToken: (token) => {
          content += token;
          setResult(content);
        },
        onDone: () => setState("done"),
        onError: (message) => {
          setError(message);
          setState("error");
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Test failed");
      setState("error");
    }
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setState("idle");
    setResult("");
    setError(null);
    setContentSource(null);
    setContentWarning(null);
  }, []);

  return { state, result, error, contentSource, contentWarning, execute, reset };
}

// ---------------------------------------------------------------------------
// Phase 3 hooks: Triggers
// ---------------------------------------------------------------------------

export function useTriggers(skillId: string | null) {
  const [triggers, setTriggers] = useState<SkillTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!skillId) {
      setTriggers([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await getTriggers(skillId);
      setTriggers(data);
    } catch {
      setTriggers([]);
    } finally {
      setIsLoading(false);
    }
  }, [skillId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (data: TriggerCreateRequest) => {
      if (!skillId) throw new Error("No skill selected");
      const result = await apiCreateTrigger(skillId, data);
      await load();
      return result;
    },
    [skillId, load]
  );

  const update = useCallback(
    async (triggerId: number, data: TriggerUpdateRequest) => {
      const result = await apiUpdateTrigger(triggerId, data);
      await load();
      return result;
    },
    [load]
  );

  const remove = useCallback(
    async (triggerId: number) => {
      await apiDeleteTrigger(triggerId);
      await load();
    },
    [load]
  );

  const toggle = useCallback(
    async (triggerId: number, enabled: boolean) => {
      const result = await apiToggleTrigger(triggerId, enabled);
      await load();
      return result;
    },
    [load]
  );

  return { triggers, isLoading, refresh: load, create, update, remove, toggle };
}

export function useTriggerPreview(conditions: TriggerConditions | null) {
  const [preview, setPreview] = useState<TriggerPreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conditions || !conditions.rules.length) {
      setPreview(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const result = await apiPreviewTrigger(conditions);
        setPreview(result);
      } catch {
        setPreview(null);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(conditions)]);

  return { preview, isLoading };
}

import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";

export type ReembedJobStatus =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ReembedJobState {
  jobId: string | null;
  status: ReembedJobStatus;
  progress: number;
  processed: number;
  failed: number;
  total: number;
  error: string | null;
  isNew: boolean;
}

interface UseReembedJobOptions {
  pollInterval?: number;
  onComplete?: (processed: number, failed: number) => void;
  onError?: (error: string) => void;
}

interface UseReembedJobReturn extends ReembedJobState {
  startJob: () => Promise<void>;
  cancelJob: () => Promise<void>;
  reset: () => void;
  isActive: boolean;
}

const initialState: ReembedJobState = {
  jobId: null,
  status: "idle",
  progress: 0,
  processed: 0,
  failed: 0,
  total: 0,
  error: null,
  isNew: false,
};

export function useReembedJob({
  pollInterval = 500,
  onComplete,
  onError,
}: UseReembedJobOptions = {}): UseReembedJobReturn {
  const [state, setState] = useState<ReembedJobState>(initialState);
  const pollIntervalRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state for async operations
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollJobStatus = useCallback(
    async (jobId: string) => {
      try {
        const res = await apiFetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const job = await res.json();

        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          status: job.status as ReembedJobStatus,
          progress: job.progress,
          processed: job.processed,
          failed: job.failed,
          total: job.total,
          error: job.error,
        }));

        // Check if job is done
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          stopPolling();

          if (job.status === "completed") {
            onComplete?.(job.processed, job.failed);
          } else if (job.status === "failed" && job.error) {
            onError?.(job.error);
          }
        }
      } catch (err) {
        console.error("Failed to poll job status:", err);
        // Don't stop polling on transient errors
      }
    },
    [stopPolling, onComplete, onError]
  );

  const startJob = useCallback(async () => {
    try {
      // Reset state
      setState({ ...initialState, status: "pending" });

      const res = await apiFetch("/api/jobs/reembed", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        jobId: data.id,
        status: data.status as ReembedJobStatus,
        isNew: data.is_new,
      }));

      // Start polling
      pollIntervalRef.current = window.setInterval(() => {
        pollJobStatus(data.id);
      }, pollInterval);

      // Also poll immediately
      pollJobStatus(data.id);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to start re-embed job";

      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        status: "failed",
        error: errorMsg,
      }));
      onError?.(errorMsg);
    }
  }, [pollInterval, pollJobStatus, onError]);

  const cancelJob = useCallback(async () => {
    if (!state.jobId) return;

    try {
      const res = await apiFetch(`/api/jobs/${state.jobId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      stopPolling();

      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        status: "cancelled",
      }));
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  }, [state.jobId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState(initialState);
  }, [stopPolling]);

  const isActive =
    state.status === "pending" || state.status === "running";

  return {
    ...state,
    startJob,
    cancelJob,
    reset,
    isActive,
  };
}

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../constants";

export interface ProviderStatus {
  provider: "ollama" | "openai";
  model: string;
  status: "running" | "offline" | "ready" | "no-key";
  status_label: string;
}

interface UseProviderStatusOptions {
  pollInterval?: number;
  enabled?: boolean;
}

interface UseProviderStatusReturn {
  status: ProviderStatus | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useProviderStatus({
  pollInterval = 30000,
  enabled = true,
}: UseProviderStatusOptions = {}): UseProviderStatusReturn {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/provider-status`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    fetchStatus();

    intervalRef.current = window.setInterval(fetchStatus, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, pollInterval, fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refetch: fetchStatus,
  };
}

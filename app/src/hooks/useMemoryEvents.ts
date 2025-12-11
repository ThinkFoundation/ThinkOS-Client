import { useEffect, useRef, useCallback } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { API_BASE_URL } from "../constants";
import { getAppToken } from "@/lib/api";

export type MemoryEventType =
  | "connected"
  | "memory_created"
  | "memory_updated"
  | "memory_deleted"
  | "conversation_created"
  | "conversation_updated"
  | "conversation_deleted";

export interface MemoryEventData {
  type: MemoryEventType;
  memory_id?: number;
  data?: unknown;
}

interface UseMemoryEventsOptions {
  onMemoryCreated?: (memoryId: number, data: unknown) => void;
  onMemoryUpdated?: (memoryId: number, data: unknown) => void;
  onMemoryDeleted?: (memoryId: number) => void;
  onConversationCreated?: (conversationId: number, data: unknown) => void;
  onConversationUpdated?: (conversationId: number, data: unknown) => void;
  onConversationDeleted?: (conversationId: number) => void;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
  enabled?: boolean;
}

export function useMemoryEvents({
  onMemoryCreated,
  onMemoryUpdated,
  onMemoryDeleted,
  onConversationCreated,
  onConversationUpdated,
  onConversationDeleted,
  onConnected,
  onError,
  enabled = true,
}: UseMemoryEventsOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Abort existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const token = getAppToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["X-App-Token"] = token;
    }

    fetchEventSource(`${API_BASE_URL}/api/memories/events`, {
      signal: abortController.signal,
      headers,
      onmessage(event) {
        try {
          if (!event.data) return; // Skip empty events
          const data: MemoryEventData = JSON.parse(event.data);

          switch (data.type) {
            case "connected":
              onConnected?.();
              break;
            case "memory_created":
              if (data.memory_id !== undefined) {
                onMemoryCreated?.(data.memory_id, data.data);
              }
              break;
            case "memory_updated":
              if (data.memory_id !== undefined) {
                onMemoryUpdated?.(data.memory_id, data.data);
              }
              break;
            case "memory_deleted":
              if (data.memory_id !== undefined) {
                onMemoryDeleted?.(data.memory_id);
              }
              break;
            case "conversation_created":
              if (data.memory_id !== undefined) {
                onConversationCreated?.(data.memory_id, data.data);
              }
              break;
            case "conversation_updated":
              if (data.memory_id !== undefined) {
                onConversationUpdated?.(data.memory_id, data.data);
              }
              break;
            case "conversation_deleted":
              if (data.memory_id !== undefined) {
                onConversationDeleted?.(data.memory_id);
              }
              break;
          }
        } catch (err) {
          console.error("Failed to parse SSE event:", err);
        }
      },
      onerror(error) {
        onError?.(error);
        // Reconnect after delay (fetchEventSource handles this automatically,
        // but we add a delay to prevent rapid reconnection attempts)
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 3000);
        // Throw to stop the current connection
        throw error;
      },
      openWhenHidden: true, // Keep connection open when tab is hidden
    });
  }, [
    enabled,
    onMemoryCreated,
    onMemoryUpdated,
    onMemoryDeleted,
    onConversationCreated,
    onConversationUpdated,
    onConversationDeleted,
    onConnected,
    onError,
  ]);

  useEffect(() => {
    connect();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);
}

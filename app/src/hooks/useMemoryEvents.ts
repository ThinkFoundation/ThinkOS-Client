import { useEffect, useRef, useCallback } from "react";
import { API_BASE_URL } from "../constants";

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
  onError?: (error: Event) => void;
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`${API_BASE_URL}/api/memories/events`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
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
    };

    eventSource.onerror = (error) => {
      onError?.(error);
      eventSource.close();

      // Reconnect after delay
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };
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
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);
}

import { useState, useEffect, useCallback } from "react";
import { useMemoryEvents } from "./useMemoryEvents";
import { apiFetch } from "@/lib/api";
import type { Conversation } from "@/types/chat";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await apiFetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Listen for conversation events via SSE
  useMemoryEvents({
    onConversationCreated: (id, data) => {
      const conversation = data as Conversation;
      setConversations((prev) => {
        if (prev.some((c) => c.id === conversation.id)) return prev;
        return [conversation, ...prev];
      });
    },
    onConversationUpdated: (id, data) => {
      const eventData = data as { title?: string; pinned?: boolean };
      if (eventData) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...(eventData.title !== undefined && { title: eventData.title }),
                  ...(eventData.pinned !== undefined && { pinned: eventData.pinned }),
                  updated_at: new Date().toISOString(),
                }
              : c
          )
        );
      }
    },
    onConversationDeleted: (id) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
  });

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const deleteConversation = async (id: number) => {
    try {
      const res = await apiFetch(`/api/conversations/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        // State will be updated via SSE event
        return true;
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
    return false;
  };

  const togglePinConversation = async (id: number, pinned: boolean) => {
    try {
      const res = await apiFetch(`/api/conversations/${id}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (res.ok) {
        // State will be updated via SSE event
        return true;
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
    return false;
  };

  const refreshConversations = () => {
    setIsLoading(true);
    fetchConversations();
  };

  return {
    conversations,
    isLoading,
    deleteConversation,
    togglePinConversation,
    refreshConversations,
  };
}

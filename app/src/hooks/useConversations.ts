import { useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from "../constants";
import { useMemoryEvents } from "./useMemoryEvents";
import type { Conversation } from "@/types/chat";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/conversations`);
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
      const eventData = data as { title?: string };
      if (eventData && "title" in eventData) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id
              ? { ...c, title: eventData.title!, updated_at: new Date().toISOString() }
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
      const res = await fetch(`${API_BASE_URL}/api/conversations/${id}`, {
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

  const refreshConversations = () => {
    setIsLoading(true);
    fetchConversations();
  };

  return {
    conversations,
    isLoading,
    deleteConversation,
    refreshConversations,
  };
}

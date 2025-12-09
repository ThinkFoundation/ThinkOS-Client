import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { Conversation, ChatMessage, ConversationDetail, SourceMemory } from "@/types/chat";

interface ConversationContextType {
  currentConversationId: number | null;
  messages: ChatMessage[];
  allSources: SourceMemory[];
  isLoadingMessages: boolean;
  pendingMessage: string | null;
  selectConversation: (conversation: Conversation | null) => void;
  startNewChat: () => void;
  setCurrentConversationId: (id: number | null) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string | number, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  setPendingMessage: (message: string | null) => void;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const loadConversation = useCallback(async (conversationId: number) => {
    setIsLoadingMessages(true);
    try {
      const res = await apiFetch(`/api/conversations/${conversationId}`);
      if (res.ok) {
        const data: ConversationDetail = await res.json();
        setMessages(
          data.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.created_at || ""),
            sources: m.sources || [],
          }))
        );
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Aggregate all sources from messages, deduplicated by id
  const allSources = useMemo(() => {
    const sourceMap = new Map<number, SourceMemory>();
    for (const msg of messages) {
      if (msg.sources) {
        for (const src of msg.sources) {
          if (!sourceMap.has(src.id)) {
            sourceMap.set(src.id, src);
          }
        }
      }
    }
    return Array.from(sourceMap.values());
  }, [messages]);

  const selectConversation = useCallback(
    (conversation: Conversation | null) => {
      if (conversation) {
        setCurrentConversationId(conversation.id);
        loadConversation(conversation.id);
      } else {
        setCurrentConversationId(null);
        setMessages([]);
      }
    },
    [loadConversation]
  );

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
  }, []);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string | number, updates: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <ConversationContext.Provider
      value={{
        currentConversationId,
        messages,
        allSources,
        isLoadingMessages,
        pendingMessage,
        selectConversation,
        startNewChat,
        setCurrentConversationId,
        addMessage,
        updateMessage,
        clearMessages,
        setPendingMessage,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error("useConversation must be used within a ConversationProvider");
  }
  return context;
}

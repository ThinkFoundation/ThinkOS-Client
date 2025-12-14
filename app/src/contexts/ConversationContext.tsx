import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { Conversation, ChatMessage, ConversationDetail, SourceMemory, TokenUsage } from "@/types/chat";

interface ConversationContextType {
  currentConversationId: number | null;
  messages: ChatMessage[];
  allSources: SourceMemory[];
  isLoadingMessages: boolean;
  pendingMessage: string | null;
  contextUsage: TokenUsage | null;  // Latest message only (for context window %)
  billingUsage: TokenUsage | null;  // Cumulative (for cost tracking)
  contextWindow: number;
  selectConversation: (conversation: Conversation | null) => void;
  startNewChat: () => void;
  setCurrentConversationId: (id: number | null) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string | number, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  setPendingMessage: (message: string | null) => void;
  updateUsage: (usage: TokenUsage | null, contextWindow?: number) => void;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<TokenUsage | null>(null);  // Latest only
  const [billingUsage, setBillingUsage] = useState<TokenUsage | null>(null);  // Cumulative
  const [contextWindow, setContextWindow] = useState(128000);

  const updateUsage = useCallback((newUsage: TokenUsage | null, newContextWindow?: number) => {
    if (newUsage) {
      // Context usage = latest message only (for context window %)
      setContextUsage(newUsage);

      // Billing usage = accumulate across conversation (for cost tracking)
      setBillingUsage((prev) =>
        prev
          ? {
              prompt_tokens: prev.prompt_tokens + newUsage.prompt_tokens,
              completion_tokens: prev.completion_tokens + newUsage.completion_tokens,
              total_tokens: prev.total_tokens + newUsage.total_tokens,
            }
          : newUsage
      );
    } else {
      setContextUsage(null);
      setBillingUsage(null);
    }
    if (newContextWindow) {
      setContextWindow(newContextWindow);
    }
  }, []);

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

        // Get usage from messages
        const assistantMessages = data.messages.filter(
          (m) => m.role === "assistant" && m.total_tokens
        );

        // Context usage = last assistant message only (current context window state)
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        if (lastAssistant) {
          setContextUsage({
            prompt_tokens: lastAssistant.prompt_tokens || 0,
            completion_tokens: lastAssistant.completion_tokens || 0,
            total_tokens: lastAssistant.total_tokens || 0,
          });
        } else {
          setContextUsage(null);
        }

        // Billing usage = sum of all (total tokens consumed)
        const totalBilling = assistantMessages.reduce(
          (acc, m) => ({
            prompt_tokens: acc.prompt_tokens + (m.prompt_tokens || 0),
            completion_tokens: acc.completion_tokens + (m.completion_tokens || 0),
            total_tokens: acc.total_tokens + (m.total_tokens || 0),
          }),
          { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        );
        setBillingUsage(totalBilling.total_tokens > 0 ? totalBilling : null);

        // Set context window from response (use actual model's context window)
        if (data.context_window) {
          setContextWindow(data.context_window);
        }
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
        setContextUsage(null);
        setBillingUsage(null);
      }
    },
    [loadConversation]
  );

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
    setContextUsage(null);
    setBillingUsage(null);
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
        contextUsage,
        billingUsage,
        contextWindow,
        selectConversation,
        startNewChat,
        setCurrentConversationId,
        addMessage,
        updateMessage,
        clearMessages,
        setPendingMessage,
        updateUsage,
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

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { Conversation, ChatMessage, ConversationDetail, SourceMemory, TokenUsage, AttachedMemory } from "@/types/chat";

interface ConversationContextType {
  currentConversationId: number | null;
  messages: ChatMessage[];
  allSources: SourceMemory[];
  isLoadingMessages: boolean;
  pendingMessage: string | null;
  estimatedTokens: number;  // Estimated conversation tokens (stable, grows with messages)
  billingUsage: TokenUsage | null;  // Cumulative (for cost tracking)
  contextWindow: number;
  attachedMemories: AttachedMemory[];
  selectConversation: (conversation: Conversation | null) => void;
  startNewChat: () => void;
  setCurrentConversationId: (id: number | null) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string | number, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  setPendingMessage: (message: string | null) => void;
  updateContextWindow: (contextWindow: number) => void;
  addAttachedMemory: (memory: AttachedMemory) => void;
  removeAttachedMemory: (memoryId: number) => void;
  clearAttachedMemories: () => void;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

// Estimate tokens from text (~4 chars per token is a common approximation)
const SYSTEM_PROMPT_TOKENS = 80; // Approximate tokens for the system prompt

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [billingUsage, setBillingUsage] = useState<TokenUsage | null>(null);  // Cumulative
  const [contextWindow, setContextWindow] = useState(128000);
  const [attachedMemories, setAttachedMemories] = useState<AttachedMemory[]>([]);

  // Estimate conversation tokens from messages (stable, grows with conversation)
  const estimatedTokens = useMemo(() => {
    const messageTokens = messages.reduce((acc, msg) => acc + estimateTokens(msg.content), 0);
    return SYSTEM_PROMPT_TOKENS + messageTokens;
  }, [messages]);

  const updateContextWindow = useCallback((newContextWindow: number) => {
    setContextWindow(newContextWindow);
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

        // Billing usage = sum of all assistant message tokens (for cost tracking)
        const assistantMessages = data.messages.filter(
          (m) => m.role === "assistant" && m.total_tokens
        );
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

  // Aggregate all sources from conversation, deduplicated by id
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
        setBillingUsage(null);
      }
    },
    [loadConversation]
  );

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
    setBillingUsage(null);
    setAttachedMemories([]);
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

  const addAttachedMemory = useCallback((memory: AttachedMemory) => {
    setAttachedMemories((prev) => {
      // Prevent duplicates
      if (prev.some((m) => m.id === memory.id)) return prev;
      return [...prev, memory];
    });
  }, []);

  const removeAttachedMemory = useCallback((memoryId: number) => {
    setAttachedMemories((prev) => prev.filter((m) => m.id !== memoryId));
  }, []);

  const clearAttachedMemories = useCallback(() => {
    setAttachedMemories([]);
  }, []);

  return (
    <ConversationContext.Provider
      value={{
        currentConversationId,
        messages,
        allSources,
        isLoadingMessages,
        pendingMessage,
        estimatedTokens,
        billingUsage,
        contextWindow,
        attachedMemories,
        selectConversation,
        startNewChat,
        setCurrentConversationId,
        addMessage,
        updateMessage,
        clearMessages,
        setPendingMessage,
        updateContextWindow,
        addAttachedMemory,
        removeAttachedMemory,
        clearAttachedMemories,
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

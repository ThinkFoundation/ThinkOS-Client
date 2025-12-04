import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { API_BASE_URL } from "@/constants";
import type { Conversation, ChatMessage, ConversationDetail } from "@/types/chat";

interface ConversationContextType {
  currentConversationId: number | null;
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  selectConversation: (conversation: Conversation | null) => void;
  startNewChat: () => void;
  setCurrentConversationId: (id: number | null) => void;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const loadConversation = useCallback(async (conversationId: number) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}`);
      if (res.ok) {
        const data: ConversationDetail = await res.json();
        setMessages(
          data.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.created_at || ""),
          }))
        );
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

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

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <ConversationContext.Provider
      value={{
        currentConversationId,
        messages,
        isLoadingMessages,
        selectConversation,
        startNewChat,
        setCurrentConversationId,
        addMessage,
        clearMessages,
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

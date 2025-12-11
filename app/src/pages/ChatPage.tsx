import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatSourcesPanel } from "@/components/ChatSourcesPanel";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";
import type { ChatMessage } from "@/types/chat";

export default function ChatPage() {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isStartingNewChatRef = useRef(false);

  const {
    currentConversationId,
    messages,
    allSources,
    isLoadingMessages,
    pendingMessage,
    setCurrentConversationId,
    addMessage,
    updateMessage,
    selectConversation,
    startNewChat,
    setPendingMessage,
  } = useConversation();

  const { conversations } = useConversations();

  // Core chat submission logic
  const submitChat = useCallback(async (messageText: string, conversationId: number | null) => {
    if (!messageText.trim()) return;

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText.trim(),
      timestamp: new Date(),
    };

    const assistantMessageId = crypto.randomUUID();

    addMessage(userMessage);
    setMessage("");
    setIsLoading(true);

    // Add empty assistant message for streaming
    addMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    });

    try {
      const res = await apiFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversation_id: conversationId,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to connect");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "meta") {
                // Update conversation ID and sources
                if (data.conversation_id && !conversationId) {
                  setCurrentConversationId(data.conversation_id);
                }
                updateMessage(assistantMessageId, {
                  sources: data.sources || [],
                  searched: data.searched || false,
                });
              } else if (data.type === "token") {
                content += data.content;
                updateMessage(assistantMessageId, { content });
              } else if (data.type === "done") {
                updateMessage(assistantMessageId, { isStreaming: false });
              } else if (data.type === "error") {
                updateMessage(assistantMessageId, {
                  content: data.message,
                  error: true,
                  isStreaming: false,
                });
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (err) {
      updateMessage(assistantMessageId, {
        content: "Failed to connect to the server",
        error: true,
        isStreaming: false,
      });
      console.error("Chat failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, updateMessage, setCurrentConversationId]);

  // Handler for manual chat input
  const handleChat = useCallback(() => {
    submitChat(message, currentConversationId);
  }, [message, currentConversationId, submitChat]);

  // Effect 1: Handle pending message from navigation (e.g., from HomePage)
  useEffect(() => {
    if (!pendingMessage || isStartingNewChatRef.current) return;

    isStartingNewChatRef.current = true;
    const msgToSend = pendingMessage;
    setPendingMessage(null);
    startNewChat();
    submitChat(msgToSend, null).finally(() => {
      isStartingNewChatRef.current = false;
    });
  }, [pendingMessage, setPendingMessage, startNewChat, submitChat]);

  // Effect 2: Auto-load most recent conversation on mount (when no pending message)
  useEffect(() => {
    if (isStartingNewChatRef.current) return;
    if (currentConversationId || messages.length > 0) return;
    if (conversations.length === 0) return;

    selectConversation(conversations[0]);
  }, [currentConversationId, conversations, messages.length, selectConversation]);

  return (
    <div className="flex h-full">
      {/* Chat history sidebar */}
      <ChatSidebar />

      {/* Chat content */}
      <div className="flex-1 flex flex-col">
        {/* Messages area */}
        {isLoadingMessages ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Loading messages...</p>
          </div>
        ) : (
          <ChatMessageList messages={messages} isLoading={isLoading} />
        )}

        {/* Sources panel */}
        <ChatSourcesPanel sources={allSources} />

        {/* Floating input at bottom */}
        <div className="flex-none p-4">
          <div className="max-w-2xl mx-auto">
            <ChatInput
              value={message}
              onChange={setMessage}
              onSubmit={handleChat}
              isLoading={isLoading}
              placeholder="Type your message..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

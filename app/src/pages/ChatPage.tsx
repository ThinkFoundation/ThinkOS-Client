import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatSourcesPanel } from "@/components/ChatSourcesPanel";
import { ContextUsageIndicator } from "@/components/ContextUsageIndicator";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";
import type { ChatMessage } from "@/types/chat";

export default function ChatPage() {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isStartingNewChatRef = useRef(false);
  const wantsNewChatRef = useRef(false);

  // Track pending conversation creation to prevent race conditions
  const pendingConversationRef = useRef<{
    promise: Promise<number>;
    resolve: (id: number) => void;
  } | null>(null);

  const {
    currentConversationId,
    messages,
    allSources,
    isLoadingMessages,
    pendingMessage,
    contextUsage,
    billingUsage,
    contextWindow,
    setCurrentConversationId,
    addMessage,
    updateMessage,
    selectConversation,
    startNewChat,
    setPendingMessage,
    updateUsage,
  } = useConversation();

  const { conversations } = useConversations();

  // Wrapper for starting new chat that prevents auto-load from immediately re-selecting
  const handleStartNewChat = useCallback(() => {
    wantsNewChatRef.current = true;
    startNewChat();
  }, [startNewChat]);

  // Core chat submission logic
  const submitChat = useCallback(async (messageText: string, conversationId: number | null) => {
    if (!messageText.trim()) return;

    // Clear new chat flag since user is now sending a message
    wantsNewChatRef.current = false;

    // FIX: Handle conversation ID race condition
    // If no conversation ID and another message is already creating one, wait for it
    let effectiveConversationId = conversationId;
    if (!effectiveConversationId && pendingConversationRef.current) {
      effectiveConversationId = await pendingConversationRef.current.promise;
    }

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

    // Set up pending conversation promise if this is a new conversation
    let resolveConversation: (id: number) => void = () => {};
    if (!effectiveConversationId) {
      const pending = {
        promise: null as unknown as Promise<number>,
        resolve: null as unknown as (id: number) => void,
      };
      pending.promise = new Promise<number>((resolve) => {
        pending.resolve = resolve;
        resolveConversation = resolve;
      });
      pendingConversationRef.current = pending;
    }

    try {
      const res = await apiFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversation_id: effectiveConversationId,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to connect");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let content = "";
      // FIX: Buffer for incomplete SSE lines (prevents dropped JSON when split across chunks)
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new chunk to buffer
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");

        // Keep the last potentially incomplete line in buffer
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "meta") {
                // Update conversation ID and sources
                if (data.conversation_id && !effectiveConversationId) {
                  setCurrentConversationId(data.conversation_id);
                  // Resolve pending conversation promise for any waiting messages
                  resolveConversation(data.conversation_id);
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
                // Update usage from stream response
                if (data.usage) {
                  updateUsage(data.usage, data.context_window);
                }
              } else if (data.type === "error") {
                updateMessage(assistantMessageId, {
                  content: data.message,
                  error: true,
                  isStreaming: false,
                });
              }
            } catch (e) {
              // Log parse errors for debugging (was silently swallowed)
              console.warn("Failed to parse SSE data:", line.slice(6), e);
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (sseBuffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(sseBuffer.slice(6));
          if (data.type === "token") {
            content += data.content;
            updateMessage(assistantMessageId, { content });
          } else if (data.type === "done") {
            updateMessage(assistantMessageId, { isStreaming: false });
            if (data.usage) {
              updateUsage(data.usage, data.context_window);
            }
          }
        } catch {
          // Ignore incomplete final chunk
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
      // Clear pending conversation ref
      pendingConversationRef.current = null;
    }
  }, [addMessage, updateMessage, setCurrentConversationId, updateUsage]);

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
    if (wantsNewChatRef.current) return;
    if (currentConversationId || messages.length > 0) return;
    if (conversations.length === 0) return;

    selectConversation(conversations[0]);
  }, [currentConversationId, conversations, messages.length, selectConversation]);

  return (
    <div className="flex h-full">
      {/* Chat history sidebar */}
      <ChatSidebar onNewChat={handleStartNewChat} />

      {/* Chat content */}
      <div className="flex-1 flex flex-col">
        {/* Messages area */}
        {isLoadingMessages ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Loading messages...</p>
          </div>
        ) : (
          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            onSendMessage={(msg) => submitChat(msg, currentConversationId)}
          />
        )}

        {/* Sources panel */}
        <ChatSourcesPanel sources={allSources} />

        {/* Floating input at bottom */}
        <div className="flex-none p-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ChatInput
                  value={message}
                  onChange={setMessage}
                  onSubmit={handleChat}
                  isLoading={isLoading}
                  placeholder="Type your message..."
                />
              </div>
              <ContextUsageIndicator
                contextUsage={contextUsage}
                billingUsage={billingUsage}
                contextWindow={contextWindow}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

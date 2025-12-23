import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatSourcesPanel } from "@/components/ChatSourcesPanel";
import { ContextUsageIndicator } from "@/components/ContextUsageIndicator";
import { AttachedMemoryChips } from "@/components/AttachedMemoryChips";
import { useConversation } from "@/contexts/ConversationContext";
import { useConversations } from "@/hooks/useConversations";
import type { ChatMessage } from "@/types/chat";
import { FileText, Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [followupSuggestions, setFollowupSuggestions] = useState<string[]>([]);
  const isStartingNewChatRef = useRef(false);
  const wantsNewChatRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();

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
    estimatedTokens,
    billingUsage,
    contextWindow,
    attachedMemories,
    setCurrentConversationId,
    addMessage,
    updateMessage,
    selectConversation,
    startNewChat,
    setPendingMessage,
    updateContextWindow,
    removeAttachedMemory,
    clearAttachedMemories,
  } = useConversation();

  const { conversations, deleteConversation, togglePinConversation } = useConversations();

  // Get current conversation details for title bar
  const currentConversation = useMemo(() => {
    if (!currentConversationId) return null;
    return conversations.find((c) => c.id === currentConversationId) || null;
  }, [currentConversationId, conversations]);

  // Wrapper for starting new chat that prevents auto-load from immediately re-selecting
  const handleStartNewChat = useCallback(() => {
    wantsNewChatRef.current = true;
    startNewChat();
  }, [startNewChat]);

  // Handle delete conversation
  const handleDeleteConversation = useCallback(async () => {
    if (!currentConversationId) return;
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    const success = await deleteConversation(currentConversationId);
    if (success) {
      handleStartNewChat();
    }
  }, [currentConversationId, deleteConversation, handleStartNewChat]);

  // Handle toggle pin
  const handleTogglePin = useCallback(async () => {
    if (!currentConversation) return;
    await togglePinConversation(currentConversation.id, !currentConversation.pinned);
  }, [currentConversation, togglePinConversation]);

  // Core chat submission logic
  const submitChat = useCallback(async (messageText: string, conversationId: number | null) => {
    if (!messageText.trim()) return;

    // Clear new chat flag since user is now sending a message
    wantsNewChatRef.current = false;

    // Clear previous follow-up suggestions when sending a new message
    setFollowupSuggestions([]);

    // Capture attached memories before clearing (they're consumed with this message)
    const memoriesToSend = [...attachedMemories];
    clearAttachedMemories();

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
      let pendingResolve: (id: number) => void;
      const pendingPromise = new Promise<number>((resolve) => {
        pendingResolve = resolve;
        resolveConversation = resolve;
      });
      pendingConversationRef.current = {
        promise: pendingPromise,
        resolve: pendingResolve!,
      };
    }

    try {
      const res = await apiFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversation_id: effectiveConversationId,
          attached_memory_ids: memoriesToSend.length > 0 ? memoriesToSend.map((m) => m.id) : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to connect");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader available");

      try {
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
                  setIsLoading(false); // Stop loading before follow-ups arrive
                  // Update context window from stream response
                  if (data.context_window) {
                    updateContextWindow(data.context_window);
                  }
                } else if (data.type === "error") {
                  updateMessage(assistantMessageId, {
                    content: data.message,
                    error: true,
                    isStreaming: false,
                  });
                } else if (data.type === "followups") {
                  // LLM-generated follow-up suggestions
                  if (data.suggestions && Array.isArray(data.suggestions)) {
                    setFollowupSuggestions(data.suggestions);
                  }
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
              setIsLoading(false);
              if (data.context_window) {
                updateContextWindow(data.context_window);
              }
            }
          } catch {
            // Ignore incomplete final chunk
          }
        }
      } finally {
        // Always close the reader to prevent resource leaks
        reader.cancel().catch(() => {});
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
  }, [addMessage, updateMessage, setCurrentConversationId, updateContextWindow, attachedMemories, clearAttachedMemories]);

  // Handler for manual chat input
  const handleChat = useCallback(() => {
    submitChat(message, currentConversationId);
  }, [message, currentConversationId, submitChat]);

  // Effect: Handle ?new=true param from navigation (e.g., from HomePage "New Conversation")
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      wantsNewChatRef.current = true;
      startNewChat();
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, startNewChat]);

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
    if (attachedMemories.length > 0) return; // Don't auto-load if memories attached
    if (currentConversationId || messages.length > 0) return;
    if (conversations.length === 0) return;

    selectConversation(conversations[0]);
  }, [currentConversationId, conversations, messages.length, selectConversation, attachedMemories.length]);

  return (
    <div className="flex h-full">
      {/* Chat history sidebar */}
      <ChatSidebar onNewChat={handleStartNewChat} />

      {/* Chat content */}
      <div className="flex-1 flex flex-col">
        {/* Title bar - shown when a conversation is selected */}
        {currentConversation && (
          <div className="flex-none border-b bg-background/50 backdrop-blur-sm">
            <div className="flex items-center gap-3 px-4 py-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-muted-foreground truncate block">
                  {currentConversation.title || "New conversation"}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleTogglePin}
                  title={currentConversation.pinned ? "Unpin conversation" : "Pin conversation"}
                >
                  <Pin
                    className={cn(
                      "h-4 w-4",
                      currentConversation.pinned
                        ? "text-primary fill-primary"
                        : "text-muted-foreground"
                    )}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleDeleteConversation}
                  title="Delete conversation"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        )}

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
            followupSuggestions={followupSuggestions}
          />
        )}

        {/* Sources panel */}
        <ChatSourcesPanel sources={allSources} />

        {/* Floating input at bottom */}
        <div className="flex-none p-4">
          <div className="max-w-2xl mx-auto">
            {/* Attached memory chips */}
            {attachedMemories.length > 0 && (
              <AttachedMemoryChips
                memories={attachedMemories}
                onRemove={removeAttachedMemory}
                className="mb-2"
              />
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ChatInput
                  value={message}
                  onChange={setMessage}
                  onSubmit={handleChat}
                  isLoading={isLoading}
                  placeholder={
                    attachedMemories.length > 0
                      ? `Ask about ${attachedMemories[0].title}...`
                      : "Type your message..."
                  }
                />
              </div>
              <ContextUsageIndicator
                estimatedTokens={estimatedTokens}
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

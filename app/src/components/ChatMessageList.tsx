import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ChatMessage } from "./ChatMessage";
import { PromptChips } from "./PromptChips";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

// Fallback prompts in case API fails
const FALLBACK_PROMPTS = [
  "Summarize what I learned recently",
  "What connections exist between my memories?",
];

interface QuickPrompt {
  id: string;
  text: string;
  type: "special" | "dynamic";
}

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isLoading?: boolean;
  onSendMessage?: (message: string) => void;
  followupSuggestions?: string[];
}

export function ChatMessageList({
  messages,
  isLoading,
  onSendMessage,
  followupSuggestions = [],
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [quickPrompts, setQuickPrompts] = useState<string[]>(FALLBACK_PROMPTS);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);

  // Fetch dynamic quick prompts when chat is empty (mount or new chat)
  const isEmptyChat = messages.length === 0;
  useEffect(() => {
    if (!isEmptyChat) return;

    async function fetchSuggestions() {
      setIsLoadingPrompts(true);
      try {
        const res = await apiFetch("/api/chat/suggestions");
        if (res.ok) {
          const data = await res.json();
          const prompts =
            data.quick_prompts?.map((p: QuickPrompt) => p.text) || [];
          if (prompts.length > 0) {
            setQuickPrompts(prompts);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch suggestions, using fallbacks");
      } finally {
        setIsLoadingPrompts(false);
      }
    }
    fetchSuggestions();
  }, [isEmptyChat]);

  // Check if any message is currently streaming
  const hasStreamingMessage = messages.some((m) => m.isStreaming);

  // Get the last assistant message for showing follow-ups
  const lastMessage = messages[messages.length - 1];

  // Show follow-ups only when we have LLM-generated suggestions
  const showFollowups =
    !isLoading &&
    !hasStreamingMessage &&
    lastMessage?.role === "assistant" &&
    !lastMessage.error &&
    onSendMessage &&
    followupSuggestions.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        // Use instant scroll during streaming to avoid janky smooth scrolling
        behavior: hasStreamingMessage ? "auto" : "smooth",
      });
    }
  }, [messages, isLoading, hasStreamingMessage]);

  // Only show loading indicator before streaming starts
  const showLoading = isLoading && !hasStreamingMessage;

  // Show quick prompts when chat is empty
  if (messages.length === 0 && !isLoading && onSendMessage) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center">
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <p className="text-muted-foreground text-sm mb-6">
            Start a conversation or try one of these:
          </p>
          {isLoadingPrompts ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading suggestions...</span>
            </div>
          ) : (
            <PromptChips
              prompts={quickPrompts}
              onSelect={onSendMessage}
              variant="glass"
              className="justify-center max-w-md"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {showLoading && (
        <div className="flex justify-start animate-slide-up">
          <div className="bg-muted p-3 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Search className="h-3 w-3" />
              <span>Searching memories...</span>
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          </div>
        </div>
      )}
      {showFollowups && onSendMessage && (
        <PromptChips
          prompts={followupSuggestions}
          onSelect={onSendMessage}
          className="animate-slide-up"
        />
      )}
    </div>
  );
}

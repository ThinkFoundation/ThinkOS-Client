import { useEffect, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { PromptChips } from "./PromptChips";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

const QUICK_PROMPTS = [
  "Summarize what I learned recently",
  "What connections exist between my memories?",
  "Help me recall something about...",
  "What are the key insights from my notes?",
];

const FOLLOWUP_PROMPTS = [
  "Tell me more about this",
  "How does this relate to my other memories?",
  "Can you summarize the key points?",
];

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isLoading?: boolean;
  onSendMessage?: (message: string) => void;
}

export function ChatMessageList({
  messages,
  isLoading,
  onSendMessage,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check if any message is currently streaming
  const hasStreamingMessage = messages.some((m) => m.isStreaming);

  // Get the last assistant message for showing follow-ups
  const lastMessage = messages[messages.length - 1];
  const showFollowups =
    !isLoading &&
    !hasStreamingMessage &&
    lastMessage?.role === "assistant" &&
    !lastMessage.error &&
    onSendMessage;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isLoading]);

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
          <PromptChips
            prompts={QUICK_PROMPTS}
            onSelect={onSendMessage}
            variant="glass"
            className="justify-center max-w-md"
          />
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
          prompts={FOLLOWUP_PROMPTS}
          onSelect={onSendMessage}
          className="animate-slide-up"
        />
      )}
    </div>
  );
}

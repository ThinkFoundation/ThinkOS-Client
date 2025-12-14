import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import { glass } from "@/lib/design-tokens";
import type { ChatMessage as ChatMessageType } from "@/types/chat";
import { ChatMessageActions } from "./ChatMessageActions";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  if (message.error) {
    return (
      <div className="flex justify-start animate-slide-up">
        <div className="max-w-[80%] p-4 rounded-2xl bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex animate-slide-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className="relative max-w-[80%]">
        {/* Message actions - only for assistant messages */}
        {!isUser && <ChatMessageActions message={message} />}

        {/* Message bubble */}
        <div
          className={cn(
            "p-4 rounded-2xl",
            isUser
              ? "bg-primary text-primary-foreground"
              : cn(glass.base, glass.hover)
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="chat-prose text-sm">
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

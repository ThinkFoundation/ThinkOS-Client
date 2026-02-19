import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import { Zap, CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { glass } from "@/lib/design-tokens";
import { ChatMessageActions } from "./ChatMessageActions";
import type { ChatMessage } from "@/types/chat";

interface ChatSkillResultProps {
  message: ChatMessage;
}

export function ChatSkillResult({ message }: ChatSkillResultProps) {
  const navigate = useNavigate();
  const meta = message.metadata;
  const isStreaming = !!message.isStreaming;
  const isComplete = !isStreaming && !!message.content;

  return (
    <div className="group flex justify-start animate-slide-up">
      <div className="relative max-w-[80%]">
        <ChatMessageActions message={message} />

        <div className={cn("rounded-2xl overflow-hidden", glass.base)}>
          {/* Skill badge header — gradient */}
          <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-white/20 dark:border-white/[0.04] overflow-hidden">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/8 to-transparent" />

            <div className="relative flex items-center gap-2 flex-1 min-w-0">
              {meta?.skill_icon && (
                <span className="text-sm leading-none flex-shrink-0">{meta.skill_icon}</span>
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-primary truncate">
                  {meta?.skill_name || "Skill Result"}
                </span>
                {meta?.memory_title && (
                  <span className="text-[10px] text-muted-foreground/40 truncate">
                    on &ldquo;{meta.memory_title}&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Status indicator */}
            <div className="relative flex-shrink-0">
              {isComplete ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-500" />
                  {isStreaming && (
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            <div className="chat-prose text-sm">
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          </div>

          {/* Footer — proper button */}
          {meta?.memory_id && !isStreaming && (
            <div className="px-4 py-2.5 border-t border-white/20 dark:border-white/[0.04]">
              <button
                onClick={() => navigate(`/memories?open=${meta.memory_id}`)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200",
                  "text-muted-foreground/50 hover:text-primary",
                  glass.card,
                  "hover:shadow-sm hover:shadow-primary/10"
                )}
              >
                View in Memory Detail
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

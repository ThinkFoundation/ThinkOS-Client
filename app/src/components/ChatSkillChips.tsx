import { Zap, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { glass } from "@/lib/design-tokens";
import type { SkillSuggestion } from "@/types/chat";

interface ChatSkillChipsProps {
  suggestions: SkillSuggestion[];
  onExecute: (suggestion: SkillSuggestion) => void;
  isExecuting?: boolean;
  className?: string;
}

export function ChatSkillChips({
  suggestions,
  onExecute,
  isExecuting = false,
  className,
}: ChatSkillChipsProps) {
  if (!suggestions.length) return null;

  return (
    <div className={cn("animate-slide-up", className)}>
      {/* Section header — matches SkillDetail pattern */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-3 w-0.5 rounded-full bg-amber-500" />
        <Zap className="h-3 w-3 text-amber-500" />
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
          Suggested Skills
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.skill_id}-${suggestion.memory_id}`}
            onClick={() => onExecute(suggestion)}
            disabled={isExecuting}
            className={cn(
              "group/chip flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-xl text-xs transition-all duration-200 animate-fade-in-up",
              "border-l-2 border-l-amber-500/30",
              glass.elevated,
              "hover:shadow-lg hover:shadow-primary/10 hover:scale-[1.02] hover:-translate-y-0.5",
              "disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:translate-y-0",
              isExecuting && "animate-pulse"
            )}
            style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
          >
            {isExecuting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/60 flex-shrink-0" />
            ) : (
              <span className="text-sm leading-none flex-shrink-0">{suggestion.skill_icon}</span>
            )}
            <div className="flex flex-col items-start min-w-0">
              <span className="font-medium truncate">{suggestion.skill_name}</span>
              {suggestion.memory_title && (
                <span className="text-[10px] text-muted-foreground/40 truncate max-w-[180px]">
                  on &ldquo;{suggestion.memory_title}&rdquo;
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

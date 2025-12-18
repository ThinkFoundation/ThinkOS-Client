import { X, Globe, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { chips } from "@/lib/design-tokens";
import type { AttachedMemory } from "@/types/chat";

interface AttachedMemoryChipsProps {
  memories: AttachedMemory[];
  onRemove: (memoryId: number) => void;
  className?: string;
}

export function AttachedMemoryChips({
  memories,
  onRemove,
  className,
}: AttachedMemoryChipsProps) {
  if (memories.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {memories.map((memory) => (
        <span
          key={memory.id}
          className={cn(
            chips.base,
            chips.primary,
            "inline-flex items-center gap-1.5 pl-2.5 pr-1.5"
          )}
        >
          {memory.type === "web" ? (
            <Globe className="h-3 w-3 shrink-0" />
          ) : (
            <FileText className="h-3 w-3 shrink-0" />
          )}
          <span className="max-w-[150px] truncate">{memory.title}</span>
          <button
            onClick={() => onRemove(memory.id)}
            className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
            title="Remove from context"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

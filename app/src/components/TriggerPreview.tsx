import { Loader2, Database, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { glass, memoryTypeColors, getMemoryTypeColor } from "@/lib/design-tokens";
import { useTriggerPreview } from "@/hooks/useSkills";
import type { TriggerConditions } from "@/lib/api";

interface TriggerPreviewProps {
  conditions: TriggerConditions | null;
}

export default function TriggerPreview({ conditions }: TriggerPreviewProps) {
  const { preview, isLoading } = useTriggerPreview(conditions);

  if (!conditions || !conditions.rules.length) return null;

  const matchRatio =
    preview && preview.total_memories > 0
      ? preview.matching_count / preview.total_memories
      : 0;

  return (
    <div className={cn("rounded-xl p-3 space-y-3", glass.overlay)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Database className="h-3 w-3 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Preview
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-3 w-32 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-1 w-full rounded-full bg-muted/30 animate-pulse" />
          <div className="h-3 w-24 rounded-full bg-muted/40 animate-pulse" />
        </div>
      ) : preview ? (
        <>
          {/* Count + ratio bar */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className={cn("font-semibold", preview.matching_count > 0 ? "text-primary" : "text-muted-foreground/50")}>
                {preview.matching_count}
              </span>
              <span className="text-muted-foreground/40"> of </span>
              <span className="font-semibold text-foreground/70">
                {preview.total_memories}
              </span>
              <span className="text-muted-foreground/40"> memories match</span>
            </p>
            <div className="h-1 w-full rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/40 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(matchRatio * 100, preview.matching_count > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>

          {/* Matching memories list */}
          {preview.matching_memories.length > 0 && (
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {preview.matching_memories.map((m) => {
                const color = getMemoryTypeColor(m.type);
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 text-[11px] py-0.5"
                  >
                    <div className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", color.bg)} />
                    <span className="truncate text-muted-foreground">
                      {m.title || "Untitled"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/30 flex-shrink-0 ml-auto">
                      {m.type}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Zero matches info */}
          {preview.matching_count === 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
              <Info className="h-3 w-3" />
              No memories match these conditions
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

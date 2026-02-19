import {
  ZapOff,
  Pencil,
  Trash2,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { glass, chips } from "@/lib/design-tokens";
import type { SkillTrigger } from "@/lib/api";

interface TriggerListProps {
  triggers: SkillTrigger[];
  onEdit: (trigger: SkillTrigger) => void;
  onDelete: (triggerId: number) => void;
  onToggle: (triggerId: number, enabled: boolean) => void;
}

function formatConditionSummary(trigger: SkillTrigger): string {
  const { conditions } = trigger;
  if (!conditions.rules.length) return "No conditions";

  const parts = conditions.rules.map((r) => {
    const op = r.op.replace(/_/g, " ");
    return `${r.field} ${op} ${String(r.value)}`;
  });

  if (parts.length === 1) return parts[0];
  const join = conditions.operator === "AND" ? " & " : " | ";
  return parts.join(join);
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export default function TriggerList({
  triggers,
  onEdit,
  onDelete,
  onToggle,
}: TriggerListProps) {
  if (!triggers.length) {
    return (
      <div className={cn("rounded-xl p-6 text-center", glass.card)}>
        <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
          <ZapOff className="h-4 w-4 text-muted-foreground/30" />
        </div>
        <p className="text-sm text-muted-foreground/50">
          No triggers yet. Add one to automate this skill.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl p-2 space-y-1", glass.card)}>
      {triggers.map((trigger, index) => (
        <div
          key={trigger.id}
          className={cn(
            "group flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all duration-200 animate-fade-in-up",
            "hover:bg-white/30 dark:hover:bg-white/[0.03]",
            !trigger.enabled && "opacity-50"
          )}
          style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
        >
          {/* Status dot */}
          <button
            onClick={() => onToggle(trigger.id, !trigger.enabled)}
            className="flex-shrink-0 group/dot"
            title={trigger.enabled ? "Disable trigger" : "Enable trigger"}
          >
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full transition-all duration-200",
                trigger.enabled
                  ? "bg-emerald-500 shadow-sm shadow-emerald-500/50 group-hover/dot:ring-2 group-hover/dot:ring-emerald-500/20"
                  : "bg-muted-foreground/30 group-hover/dot:ring-2 group-hover/dot:ring-muted-foreground/10"
              )}
            />
          </button>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-medium truncate",
                !trigger.enabled && "line-through text-muted-foreground/50"
              )}
            >
              {trigger.name}
            </p>
            <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">
              {formatConditionSummary(trigger)}
            </p>
          </div>

          {/* Stats pill */}
          <div className="flex items-center gap-1.5 rounded-full bg-white/30 dark:bg-white/[0.03] px-2 py-1 flex-shrink-0">
            <Activity className="h-2.5 w-2.5 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
              {trigger.execution_count}
            </span>
            <span className="text-[10px] text-muted-foreground/30">&middot;</span>
            <span className="text-[10px] text-muted-foreground/40">
              {formatRelativeDate(trigger.last_triggered_at)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              onClick={() => onEdit(trigger)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-500"
              onClick={() => onDelete(trigger.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

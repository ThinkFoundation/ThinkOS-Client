import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  X,
  Pencil,
  Download,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { glass, chips } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSkillDetail, useSkillMutations, useTriggers } from "@/hooks/useSkills";
import { exportSkill } from "@/lib/api";
import type { ExecutionHistoryItem, SkillTrigger, TriggerCreateRequest, TriggerUpdateRequest } from "@/lib/api";
import TriggerList from "./TriggerList";
import TriggerEditor from "./TriggerEditor";

interface SkillDetailProps {
  skillId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExecutionItem({ execution }: { execution: ExecutionHistoryItem }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-white/30 dark:hover:bg-white/[0.03] transition-colors text-sm">
      <div className="flex-1 min-w-0">
        <button
          onClick={() => navigate(`/memories?open=${execution.memory_id}`)}
          className="text-xs truncate block max-w-full hover:text-primary hover:underline transition-colors"
        >
          {execution.memory_title || "Untitled"}
        </button>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {formatDateTime(execution.created_at)}
          {execution.duration_seconds != null && ` \u00b7 ${execution.duration_seconds}s`}
        </p>
      </div>
      {execution.status === "completed" ? (
        <div className={cn("h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0", "bg-emerald-500/10")}>
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        </div>
      ) : (
        <div className={cn("h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0", "bg-red-500/10")}>
          <XCircle className="h-3 w-3 text-red-500" />
        </div>
      )}
    </div>
  );
}

export default function SkillDetail({
  skillId,
  isOpen,
  onClose,
  onDeleted,
  onUpdated,
}: SkillDetailProps) {
  const navigate = useNavigate();
  const { skill, recentExecutions, isLoading } = useSkillDetail(
    isOpen ? skillId : null
  );
  const mutations = useSkillMutations();
  const triggerOps = useTriggers(isOpen ? skillId : null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [triggerEditorOpen, setTriggerEditorOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<SkillTrigger | null>(null);
  const [isSavingTrigger, setIsSavingTrigger] = useState(false);

  const handleExport = async () => {
    if (!skill) return;
    try {
      const blob = await exportSkill(skill.id);
      // Try Electron save dialog first
      if (window.electronAPI?.saveSkillFile) {
        const text = await blob.text();
        const safeName = skill.name.toLowerCase().replace(/\s+/g, "-") + ".think-skill";
        const result = await window.electronAPI.saveSkillFile(text, safeName);
        if (result.success) {
          toast.success("Skill exported");
        }
      } else {
        // Browser fallback
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${skill.name.toLowerCase().replace(/\s+/g, "-")}.think-skill`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Skill exported");
      }
    } catch {
      toast.error("Failed to export skill");
    }
  };

  const handleToggleVisibility = async () => {
    if (!skill) return;
    try {
      await mutations.toggleVisibility(skill.id, !skill.hidden);
      onUpdated();
      toast.success(skill.hidden ? "Skill is now visible" : "Skill hidden");
    } catch {
      toast.error("Failed to toggle visibility");
    }
  };

  const handleDelete = async () => {
    if (!skill) return;
    try {
      await mutations.remove(skill.id);
      setShowDeleteDialog(false);
      onDeleted();
      toast.success("Skill deleted");
    } catch {
      toast.error("Failed to delete skill");
    }
  };

  const handleEditTrigger = (trigger: SkillTrigger) => {
    setEditingTrigger(trigger);
    setTriggerEditorOpen(true);
  };

  const handleDeleteTrigger = async (triggerId: number) => {
    try {
      await triggerOps.remove(triggerId);
      toast.success("Trigger deleted");
    } catch {
      toast.error("Failed to delete trigger");
    }
  };

  const handleToggleTrigger = async (triggerId: number, enabled: boolean) => {
    try {
      await triggerOps.toggle(triggerId, enabled);
      toast.success(enabled ? "Trigger enabled" : "Trigger disabled");
    } catch {
      toast.error("Failed to toggle trigger");
    }
  };

  const handleSaveTrigger = async (data: TriggerCreateRequest | TriggerUpdateRequest) => {
    setIsSavingTrigger(true);
    try {
      if (editingTrigger) {
        await triggerOps.update(editingTrigger.id, data);
        toast.success("Trigger updated");
      } else {
        await triggerOps.create(data as TriggerCreateRequest);
        toast.success("Trigger created");
      }
      setTriggerEditorOpen(false);
      setEditingTrigger(null);
    } catch {
      toast.error(editingTrigger ? "Failed to update trigger" : "Failed to create trigger");
    } finally {
      setIsSavingTrigger(false);
    }
  };

  if (!isOpen) return null;

  const panel = (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-300" />

      {/* Panel */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-full max-w-md",
          "transform transition-all duration-300 ease-out",
          isOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-full bg-background/95 dark:bg-background/98 backdrop-blur-2xl border-l border-white/40 dark:border-white/[0.06] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl shadow-sm shadow-black/5 dark:shadow-black/20 border-b border-white/40 dark:border-white/[0.06] px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {skill && (
                <>
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {skill.logo ? (
                      <img src={skill.logo} alt="" className="h-5 w-5 rounded object-cover" />
                    ) : (
                      <span className="text-base">{skill.icon}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="font-semibold text-sm truncate block">{skill.name}</span>
                    <span className="text-[10px] text-muted-foreground/50 block">
                      v{skill.version}
                    </span>
                  </div>
                </>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {isLoading || !skill ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="px-5 py-5 space-y-6">
              {/* Description */}
              <p className="text-sm text-muted-foreground">
                {skill.description}
              </p>

              {/* Info Block */}
              <div className={cn("rounded-xl p-4 divide-y divide-white/30 dark:divide-white/[0.04]", glass.card)}>
                <div className="flex justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                  <span className="text-muted-foreground">Category</span>
                  <span className={cn(chips.base, chips.primary, "text-[10px]")}>
                    {skill.category}
                  </span>
                </div>
                {skill.tags && skill.tags.length > 0 && (
                  <div className="flex justify-between text-sm items-start py-2.5 first:pt-0 last:pb-0">
                    <span className="text-muted-foreground flex-shrink-0">Tags</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(chips.base, chips.glass, "text-[10px]")}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {skill.author_name && (
                  <div className="flex justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                    <span className="text-muted-foreground">Author</span>
                    <span>{skill.author_name}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                  <span className="text-muted-foreground">Source</span>
                  <span className="capitalize">
                    {skill.source ?? "builtin"}
                  </span>
                </div>
                <div className="flex justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(skill.created_at ?? null)}</span>
                </div>
              </div>

              {/* Parameters */}
              {skill.parameters && skill.parameters.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <div className="h-px w-3 bg-primary/40" />
                    Parameters ({skill.parameters.length})
                  </h3>
                  <div className={cn("rounded-xl p-3 space-y-2", glass.card)}>
                    {skill.parameters.map((p) => (
                      <div key={p.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.label}</span>
                          <span className="text-[10px] text-muted-foreground/50 px-1.5 py-0.5 rounded bg-muted/50">
                            {p.type}
                          </span>
                        </div>
                        {p.type === "select" && p.options && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.options.join(" / ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt Preview */}
              {skill.prompt && (
                <div>
                  <button
                    onClick={() => setShowFullPrompt(!showFullPrompt)}
                    className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2 hover:text-muted-foreground transition-colors"
                  >
                    <div className="h-px w-3 bg-primary/40" />
                    {showFullPrompt ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Prompt Preview
                  </button>
                  {showFullPrompt && (
                    <div className={cn("rounded-xl p-3 space-y-3", glass.card)}>
                      <div>
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">
                          System
                        </p>
                        <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-32 overflow-y-auto">
                          {skill.prompt.system}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">
                          Template
                        </p>
                        <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-32 overflow-y-auto">
                          {skill.prompt.user_template}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Automation */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest flex items-center gap-2">
                    <div className="h-px w-3 bg-primary/40" />
                    <Zap className="h-3 w-3" />
                    Automation
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-primary/70 hover:text-primary"
                    onClick={() => {
                      setEditingTrigger(null);
                      setTriggerEditorOpen(true);
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Trigger
                  </Button>
                </div>
                <TriggerList
                  triggers={triggerOps.triggers}
                  onEdit={handleEditTrigger}
                  onDelete={handleDeleteTrigger}
                  onToggle={handleToggleTrigger}
                />
              </div>

              {/* Actions */}
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <div className="h-px w-3 bg-primary/40" />
                  Actions
                </h3>
                <div className="flex flex-wrap gap-2">
                  {skill.source === "user" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/skills/${skill.id}/edit`)}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    className="gap-1.5 hover:shadow-sm hover:shadow-primary/10 transition-all duration-200"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleVisibility}
                    className="gap-1.5 hover:shadow-sm hover:shadow-primary/10 transition-all duration-200"
                  >
                    {skill.hidden ? (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        Show
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        Hide
                      </>
                    )}
                  </Button>
                  {skill.source === "user" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                      className="gap-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/20 transition-all duration-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              {/* Recent Executions */}
              {recentExecutions.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <div className="h-px w-3 bg-primary/40" />
                    <Clock className="h-3 w-3" />
                    Recent Executions
                  </h3>
                  <div className={cn("rounded-xl p-2", glass.card)}>
                    {recentExecutions.map((ex) => (
                      <ExecutionItem key={ex.id} execution={ex} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );

  return createPortal(
    <>
      {panel}

      {/* Dialogs rendered outside the onClick={onClose} tree to prevent
          React synthetic event propagation from closing the panel */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{skill?.name}"? This will also
              delete all execution results for this skill.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TriggerEditor
        isOpen={triggerEditorOpen}
        onClose={() => {
          setTriggerEditorOpen(false);
          setEditingTrigger(null);
        }}
        onSave={handleSaveTrigger}
        trigger={editingTrigger}
        isSaving={isSavingTrigger}
      />
    </>,
    document.body
  );
}

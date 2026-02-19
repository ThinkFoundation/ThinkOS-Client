import { useState, useEffect, useCallback } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { glass } from "@/lib/design-tokens";
import TriggerPreview from "./TriggerPreview";
import type {
  SkillTrigger,
  TriggerRule,
  TriggerConditions,
  TriggerCreateRequest,
  TriggerUpdateRequest,
} from "@/lib/api";

const FIELDS = [
  { value: "type", label: "Type" },
  { value: "tags", label: "Tags" },
  { value: "title", label: "Title" },
  { value: "url", label: "URL" },
  { value: "content_length", label: "Content Length" },
  { value: "has_transcript", label: "Has Transcript" },
  { value: "media_source", label: "Media Source" },
];

const TEXT_OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "starts_with", label: "starts with" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const NUMERIC_OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

const BOOLEAN_OPERATORS = [
  { value: "equals", label: "equals" },
];

function getOperatorsForField(field: string) {
  if (field === "content_length") return NUMERIC_OPERATORS;
  if (field === "has_transcript") return BOOLEAN_OPERATORS;
  return TEXT_OPERATORS;
}

function isValueless(op: string): boolean {
  return op === "is_empty" || op === "is_not_empty";
}

const TYPE_VALUES = ["web", "note", "voice_memo", "audio", "video", "document"];
const BOOLEAN_VALUES = ["true", "false"];
const MEDIA_SOURCE_VALUES = ["recording", "upload"];

function getPresetValues(field: string): string[] | null {
  if (field === "type") return TYPE_VALUES;
  if (field === "has_transcript") return BOOLEAN_VALUES;
  if (field === "media_source") return MEDIA_SOURCE_VALUES;
  return null;
}

interface TriggerEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TriggerCreateRequest | TriggerUpdateRequest) => Promise<void>;
  trigger?: SkillTrigger | null;
  isSaving?: boolean;
}

const emptyRule: TriggerRule = { field: "type", op: "equals", value: "" };

const selectClass = cn(
  "h-9 rounded-lg border border-white/40 dark:border-white/[0.06]",
  "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm",
  "px-2.5 text-sm",
  "focus:outline-none focus:ring-1 focus:ring-ring",
  "min-w-0 flex-1"
);

export default function TriggerEditor({
  isOpen,
  onClose,
  onSave,
  trigger,
  isSaving = false,
}: TriggerEditorProps) {
  const isEditMode = !!trigger;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [operator, setOperator] = useState<"AND" | "OR">("AND");
  const [rules, setRules] = useState<TriggerRule[]>([{ ...emptyRule }]);

  useEffect(() => {
    if (isOpen) {
      if (trigger) {
        setName(trigger.name);
        setDescription(trigger.description || "");
        setOperator(trigger.conditions.operator);
        setRules(
          trigger.conditions.rules.length
            ? trigger.conditions.rules.map((r) => ({ ...r }))
            : [{ ...emptyRule }]
        );
      } else {
        setName("");
        setDescription("");
        setOperator("AND");
        setRules([{ ...emptyRule }]);
      }
    }
  }, [isOpen, trigger]);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, { ...emptyRule }]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const updateRule = useCallback(
    (index: number, patch: Partial<TriggerRule>) => {
      setRules((prev) =>
        prev.map((r, i) => {
          if (i !== index) return r;
          const updated = { ...r, ...patch };
          if (patch.field && patch.field !== r.field) {
            const ops = getOperatorsForField(patch.field);
            updated.op = ops[0].value;
            updated.value = "";
          }
          if (patch.op && isValueless(patch.op)) {
            updated.value = "";
          }
          return updated;
        })
      );
    },
    []
  );

  const conditions: TriggerConditions | null =
    rules.length > 0 && rules.some((r) => r.field)
      ? { operator, rules }
      : null;

  const canSave =
    name.trim().length > 0 &&
    rules.length > 0 &&
    rules.every(
      (r) => r.field && r.op && (isValueless(r.op) || String(r.value).length > 0)
    );

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      conditions: { operator, rules },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
            className="max-w-lg max-h-[85vh] overflow-y-auto"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit Trigger" : "New Trigger"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Modify when this skill runs automatically."
              : "Define conditions for automatic skill execution on memory save."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Auto-summarize web articles"
              className="text-sm focus:border-l-2 focus:border-l-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Description
              <span className="text-muted-foreground/40 ml-1">(optional)</span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When should this trigger fire?"
              className="text-sm focus:border-l-2 focus:border-l-primary"
            />
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-muted-foreground">
                Conditions
              </label>
              {rules.length > 1 && (
                <div className={cn("inline-flex rounded-full p-0.5", glass.card)}>
                  {(["AND", "OR"] as const).map((op) => (
                    <button
                      key={op}
                      onClick={() => setOperator(op)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide transition-all duration-200",
                        operator === op
                          ? "bg-primary/15 text-primary shadow-sm"
                          : "text-muted-foreground/40 hover:text-muted-foreground/60"
                      )}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {rules.map((rule, index) => {
                const ops = getOperatorsForField(rule.field);
                const presets = getPresetValues(rule.field);
                const valueless = isValueless(rule.op);

                return (
                  <div key={index}>
                    {/* AND/OR divider between rules */}
                    {index > 0 && (
                      <div className="flex items-center gap-2 py-0">
                        <div className="flex-1 h-px bg-muted-foreground/10" />
                        <span className="text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-widest">
                          {operator}
                        </span>
                        <div className="flex-1 h-px bg-muted-foreground/10" />
                      </div>
                    )}

                    {/* Rule card */}
                    <div className={cn("relative rounded-lg p-3", glass.overlay)}>
                      {/* Remove button */}
                      {rules.length > 1 && (
                        <button
                          onClick={() => removeRule(index)}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-muted/80 dark:bg-muted/40 flex items-center justify-center text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-all duration-200 z-10"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}

                      <div className="flex flex-wrap gap-8">
                        {/* Field */}
                        <div className="flex-1 min-w-[100px]">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/30 font-medium block mb-1">
                            Field
                          </span>
                          <select
                            value={rule.field}
                            onChange={(e) => updateRule(index, { field: e.target.value })}
                            className={selectClass}
                          >
                            {FIELDS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Operator */}
                        <div className="flex-1 min-w-[100px]">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/30 font-medium block mb-1">
                            Operator
                          </span>
                          <select
                            value={rule.op}
                            onChange={(e) => updateRule(index, { op: e.target.value })}
                            className={selectClass}
                          >
                            {ops.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Value */}
                        {!valueless && (
                          <div className="flex-1 min-w-[100px]">
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/30 font-medium block mb-1">
                              Value
                            </span>
                            {presets ? (
                              <select
                                value={String(rule.value)}
                                onChange={(e) => updateRule(index, { value: e.target.value })}
                                className={selectClass}
                              >
                                <option value="">Select...</option>
                                {presets.map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                value={String(rule.value)}
                                onChange={(e) =>
                                  updateRule(index, {
                                    value: rule.field === "content_length" ? Number(e.target.value) || "" : e.target.value,
                                  })
                                }
                                placeholder="value"
                                className="h-9 text-sm flex-1 min-w-0"
                                type={rule.field === "content_length" ? "number" : "text"}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add condition button */}
              <button
                onClick={addRule}
                className="w-full mt-2 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-dashed border-muted-foreground/15 hover:border-primary/30 text-xs text-muted-foreground/40 hover:text-primary/70 transition-all duration-200"
              >
                <Plus className="h-3.5 w-3.5" />
                Add condition
              </button>
            </div>
          </div>

          {/* Preview */}
          <TriggerPreview conditions={conditions} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {isEditMode ? "Save Changes" : "Create Trigger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
